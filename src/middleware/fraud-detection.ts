/**
 * Global Fraud Detection Middleware
 *
 * Runs on ALL routes by default, validates any request with an 'email' field.
 * Routes can opt-out by setting: c.set('skipFraudDetection', true)
 */

/**
 * Pattern Classification Algorithm Version
 *
 * v2.0: Original entropy-based pattern detection
 * v2.1: Multi-factor detection (n-grams + vowel density + entropy) + dynamic messages
 * v2.2: Markov-only detection (removed keyboard-walk, keyboard-mashing, gibberish heuristics)
 *       83% accuracy vs 67% with heuristics, zero false positives on legitimate names
 */
export const PATTERN_CLASSIFICATION_VERSION = '2.2.0';

// Local type for Markov result in middleware (combines results from legit and fraud models)
interface MarkovResult {
  isLikelyFraudulent: boolean;
  crossEntropyLegit: number;
  crossEntropyFraud: number;
  confidence: number;
  differenceRatio: number;
}

import { Context, Next } from 'hono';
import { generateFingerprint } from '../fingerprint';
import { validateEmail, calculateEntropy } from '../validators/email';
import { validateDomain, getDomainReputationScore } from '../validators/domain';
import {
  extractPatternFamily,
  normalizeEmail,
  analyzeTLDRisk
} from '../detectors';
// REMOVED (2025-11-08): detectKeyboardWalk, detectKeyboardMashing, detectGibberish
// Replaced with Markov-only detection for higher accuracy (83% vs 67%) and zero false positives
import { NGramMarkovChain, type NGramMarkovResult } from '../detectors/ngram-markov';
import { loadDisposableDomains } from '../services/disposable-domain-updater';
import { loadTLDRiskProfiles } from '../services/tld-risk-updater';
import { writeValidationMetric } from '../utils/metrics';
import { getConfig } from '../config';
import { logger } from '../logger';

// Cache Markov models globally per worker instance
let markovLegitModel: NGramMarkovChain | null = null;
let markovFraudModel: NGramMarkovChain | null = null;
let markovModelsLoaded = false;

/**
 * Load Markov Chain models from KV storage
 * Now using NGramMarkovChain (trained with 111k legit + 105k fraud samples)
 */
async function loadMarkovModels(env: Env): Promise<boolean> {
  if (markovModelsLoaded) return true;

  try {
    if (!env.MARKOV_MODEL) {
      logger.warn('MARKOV_MODEL namespace not configured');
      return false;
    }

    // Use 3-gram models for better context (trained with 111k+ samples)
    const legitData = await env.MARKOV_MODEL.get('MM_legit_3gram', 'json');
    const fraudData = await env.MARKOV_MODEL.get('MM_fraud_3gram', 'json');

    logger.info({
      event: 'markov_kv_fetch_result',
      hasLegitData: !!legitData,
      hasFraudData: !!fraudData,
      legitOrder: legitData ? (legitData as any).order : null,
      fraudOrder: fraudData ? (fraudData as any).order : null,
    }, 'KV fetch result');

    if (legitData && fraudData) {
      markovLegitModel = NGramMarkovChain.fromJSON(legitData);
      markovFraudModel = NGramMarkovChain.fromJSON(fraudData);
      markovModelsLoaded = true;
      logger.info({
        event: 'ngram_markov_models_loaded',
        legitSamples: (legitData as any).trainingCount || 'unknown',
        fraudSamples: (fraudData as any).trainingCount || 'unknown',
      }, 'NGram Markov Chain models loaded successfully');
      return true;
    } else {
      logger.warn({
        event: 'markov_data_missing',
        hasLegitData: !!legitData,
        hasFraudData: !!fraudData,
      }, 'Missing Markov model data from KV');
    }
  } catch (error) {
    logger.error({
      event: 'markov_load_failed',
      error: error instanceof Error ? error.message : String(error),
    }, 'Failed to load Markov models');
  }

  return false;
}

/**
 * Global Fraud Detection Middleware
 */
export async function fraudDetectionMiddleware(c: Context, next: Next) {
  const startTime = Date.now();

  // Check if route opted out
  if (c.get('skipFraudDetection') === true) {
    return next();
  }

  // Skip specific paths
  const path = c.req.path;
  if (
    path.startsWith('/admin') ||
    path === '/debug' ||
    path === '/' ||
    path.startsWith('/dashboard') ||
    path.startsWith('/assets') ||
    c.req.method !== 'POST'  // Only validate POST requests
  ) {
    return next();
  }

  // Try to extract email from request body
  let email: string | undefined;
  let requestBody: any;

  try {
    requestBody = await c.req.json();
    email = requestBody.email;

    // Store body for downstream handlers
    c.set('requestBody', requestBody);

    // If no email field, skip validation
    if (!email || typeof email !== 'string') {
      return next();
    }
  } catch {
    // Not JSON or no body - skip validation
    return next();
  }

  // Wrap entire fraud detection logic in try-catch
  try {
    logger.info({
      event: 'fraud_detection_started',
      email: email.substring(0, 3) + '***',
      path,
    }, 'Starting fraud detection');
  } catch (logError) {
    // Continue even if logging fails
  }

  try {

  // Load configuration
  const config = await getConfig(c.env.CONFIG, {
    ADMIN_API_KEY: c.env.ADMIN_API_KEY,
    ORIGIN_URL: c.env.ORIGIN_URL,
  });

  // Generate fingerprint
  const fingerprint = await generateFingerprint(c.req.raw);

  // Validate email format and entropy
  const emailValidation = validateEmail(email);

  // Load disposable domains
  let disposableDomains: Set<string> | undefined;
  if (c.env.DISPOSABLE_DOMAINS_LIST && config.features.enableDisposableCheck) {
    try {
      disposableDomains = await loadDisposableDomains(c.env.DISPOSABLE_DOMAINS_LIST);
    } catch (error) {
      logger.warn({
        event: 'disposable_domains_load_failed',
        error: error instanceof Error ? error.message : String(error)
      }, 'Failed to load disposable domains, using fallback');
    }
  }

  // Load TLD risk profiles
  let tldRiskProfiles: Map<string, any> | undefined;
  if (c.env.TLD_LIST && config.features.enableTLDRiskProfiling) {
    try {
      tldRiskProfiles = await loadTLDRiskProfiles(c.env.TLD_LIST);
    } catch (error) {
      logger.warn({
        event: 'tld_profiles_load_failed',
        error: error instanceof Error ? error.message : String(error)
      }, 'Failed to load TLD profiles, using fallback');
    }
  }

  // Validate domain
  let domainValidation;
  let domainReputationScore = 0;
  let tldRiskScore = 0;

  if (emailValidation.valid) {
    const [, domain] = email.split('@');
    if (domain && config.features.enableDisposableCheck) {
      domainValidation = validateDomain(domain, disposableDomains);
      domainReputationScore = getDomainReputationScore(domain, disposableDomains);

      // TLD risk profiling
      if (config.features.enableTLDRiskProfiling) {
        const tldAnalysis = analyzeTLDRisk(domain, tldRiskProfiles);
        tldRiskScore = tldAnalysis.riskScore;
      }
    }
  }

  // Load Markov models EARLY (before pattern detection)
  // This allows gibberish detector to use perplexity-based detection
  if (emailValidation.valid && config.features.enableMarkovChainDetection) {
    logger.info({ event: 'markov_loading', email: email.substring(0, 3) + '***' }, 'Loading Markov models');
    const modelsLoaded = await loadMarkovModels(c.env);
    logger.info({ event: 'markov_load_result', modelsLoaded, hasLegit: !!markovLegitModel, hasFraud: !!markovFraudModel }, 'Models load result');
  }

  // Pattern analysis
  let patternFamilyResult;
  let normalizedEmailResult;
  // REMOVED (2025-11-08): keyboardWalkResult, keyboardMashingResult, gibberishResult
  // These heuristic detectors had false positives (e.g., "scottpearson" flagged as mashing)
  // Markov-only detection has 83% accuracy vs 67% with heuristics

  if (emailValidation.valid && config.features.enablePatternCheck) {
    logger.info({ event: 'pattern_detection_starting' }, 'Starting pattern detection');
    // Normalize email FIRST (plus-addressing detection)
    // This ensures pattern detectors don't flag john+test1@ as sequential
    normalizedEmailResult = normalizeEmail(email);
    const emailForPatternDetection = normalizedEmailResult.normalized;

    // Extract pattern family (for signals/observability only)
    // Use normalized email to avoid false positives on plus-addressed emails
    logger.info({ event: 'pattern_family_starting' }, 'Extracting pattern family');
    patternFamilyResult = await extractPatternFamily(emailForPatternDetection);
    logger.info({ event: 'pattern_family_done', family: patternFamilyResult?.family }, 'Pattern family extracted');

    // REMOVED (2025-11-08): Keyboard walk, keyboard mashing, gibberish detectors
    // Replaced with Markov-only detection (see calculateAlgorithmicRiskScore)
    logger.info({ event: 'pattern_detection_done' }, 'Pattern detection complete');
  }

  // Markov Chain detection (NGram implementation) - PRIMARY SCORING METHOD
  let markovResult: MarkovResult | undefined;

  if (emailValidation.valid && config.features.enableMarkovChainDetection) {
    logger.info({ event: 'markov_starting', email: email.substring(0, 3) + '***' }, 'Starting Markov detection');

    if (markovLegitModel && markovFraudModel) {
      try {
        const [localPart] = email.split('@');
        logger.info({ event: 'markov_calculating', localPart: localPart.substring(0, 3) + '***' }, 'Calculating cross-entropy');

        // Calculate cross-entropy for both models
        const H_legit = markovLegitModel.crossEntropy(localPart);
        logger.info({ event: 'markov_legit_done', H_legit }, 'Legit cross-entropy calculated');

        const H_fraud = markovFraudModel.crossEntropy(localPart);
        logger.info({ event: 'markov_fraud_done', H_fraud }, 'Fraud cross-entropy calculated');

        // Lower cross-entropy = better fit to that model
        const isLikelyFraudulent = H_fraud < H_legit;

        // Calculate confidence based on difference
        const diff = Math.abs(H_legit - H_fraud);
        const maxH = Math.max(H_legit, H_fraud);
        const differenceRatio = maxH > 0 ? diff / maxH : 0;

        // Confidence scales with difference ratio
        const confidence = Math.min(differenceRatio * 2, 1.0);

        markovResult = {
          isLikelyFraudulent,
          crossEntropyLegit: H_legit,
          crossEntropyFraud: H_fraud,
          confidence,
          differenceRatio,
        };
      } catch (crossEntropyError) {
        logger.error({
          event: 'markov_crossentropy_failed',
          error: crossEntropyError instanceof Error ? crossEntropyError.message : String(crossEntropyError),
        }, 'Failed to calculate cross-entropy');
      }
    }
  }

  // Calculate risk score using early returns for priority checks
  let riskScore = 0;
  let blockReason = '';

  // Priority 1: Hard blockers (immediate block)
  if (!emailValidation.valid) {
    riskScore = config.baseRiskScores.invalidFormat;
    blockReason = emailValidation.reason || 'invalid_format';
    logger.info({
      event: 'hard_blocker_invalid_format',
      riskScore,
      reason: blockReason,
    }, 'Email failed format validation');
  } else if (domainValidation && domainValidation.isDisposable) {
    riskScore = config.baseRiskScores.disposableDomain;
    blockReason = 'disposable_domain';
    const [, emailDomain] = email.split('@');
    logger.info({
      event: 'hard_blocker_disposable',
      riskScore,
      domain: emailDomain,
    }, 'Disposable domain detected');
  } else {
    // Priority 2: Algorithmic scoring pipeline
    logger.info({
      event: 'algorithmic_scoring_starting',
      email: email.substring(0, 3) + '***',
    }, 'Starting algorithmic risk calculation');

    riskScore = calculateAlgorithmicRiskScore({
      email,
      markovResult,
      patternFamilyResult,
      domainReputationScore,
      tldRiskScore,
      normalizedEmailResult
    });

    blockReason = determineBlockReason({
      riskScore,
      email,
      markovResult,
      patternFamilyResult,
      domainReputationScore,
      tldRiskScore,
      config
    });

    logger.info({
      event: 'algorithmic_scoring_complete',
      riskScore: Math.round(riskScore * 100) / 100,
      reason: blockReason,
      markovDetected: markovResult?.isLikelyFraudulent,
      markovConfidence: markovResult?.confidence,
    }, 'Risk score calculated');
  }

  /**
   * Detect professional/business email patterns
   * contact@, info@, support@, admin@, sales@, etc.
   */
  function isProfessionalEmail(email: string): boolean {
    const [localPart] = email.toLowerCase().split('@');

    // Common professional email prefixes
    const professionalPrefixes = [
      'contact', 'info', 'support', 'help', 'sales', 'admin',
      'hello', 'team', 'service', 'inquiry', 'business', 'office',
      'hr', 'jobs', 'careers', 'marketing', 'press', 'media',
      'billing', 'accounts', 'legal', 'privacy'
    ];

    return professionalPrefixes.includes(localPart);
  }

  /**
   * Calculate risk score using Markov-only approach
   *
   * ALGORITHM CHANGE (2025-11-08):
   * - Removed heuristic detectors (keyboard-walk, keyboard-mashing, gibberish)
   * - Markov-only has 83% accuracy vs 67% with heuristics
   * - Zero false positives on legitimate names (e.g., "scottpearson")
   * - Trained on 111K+ legitimate + 105K fraud emails
   */
  function calculateAlgorithmicRiskScore(params: {
    email: string;
    markovResult: MarkovResult | null | undefined;
    patternFamilyResult: any;
    domainReputationScore: number;
    tldRiskScore: number;
    normalizedEmailResult: any;
  }): number {
    const { email, markovResult, patternFamilyResult, domainReputationScore, tldRiskScore, normalizedEmailResult } = params;

    // Check if this is a professional email
    const isProfessional = isProfessionalEmail(email);

    // Primary: Markov Chain cross-entropy (trained model)
    // Reduce Markov weight for professional emails (they may have unusual patterns)
    let score = markovResult?.isLikelyFraudulent ? markovResult.confidence : 0;
    if (isProfessional && score < 0.7) {
      score = score * 0.5; // Reduce Markov confidence for professional emails (contact@, info@, etc.)
    }

    // Secondary: Deterministic pattern overrides
    // These are high-confidence fraud signals that Markov should already detect,
    // but we keep them as fallbacks in case Markov models aren't loaded
    if (patternFamilyResult?.patternType === 'sequential') {
      score = Math.max(score, 0.8); // Sequential patterns (abc123, 123456)
    }

    // Plus-addressing abuse (deterministic pattern)
    if (normalizedEmailResult?.hasPlus) {
      score = Math.max(score, 0.6);
    }

    // Dated patterns use confidence from age-aware algorithm (0.2 for birth years, 0.9 for fraud)
    if (patternFamilyResult?.patternType === 'dated') {
      score = Math.max(score, patternFamilyResult?.confidence || 0.7);
    }

    // Tertiary: Domain signals (disposable domains, TLD risk)
    let domainRisk = domainReputationScore * 0.2 + tldRiskScore * 0.3;
    if (isProfessional) {
      domainRisk = domainRisk * 0.5; // Halve domain risk for professional emails
    }

    // Ensemble boost: When Markov and TLD risk agree, increase confidence
    if (markovResult?.isLikelyFraudulent && tldRiskScore > 0.5) {
      const ensembleBoost = Math.min(markovResult.confidence * tldRiskScore * 0.3, 0.3);
      score += ensembleBoost;
      logger.info({
        event: 'ensemble_boost_applied',
        markovConfidence: markovResult.confidence,
        tldRiskScore,
        boost: ensembleBoost,
      }, 'Ensemble boost: Markov + TLD risk agreement');
    }

    return Math.min(score + domainRisk, 1.0);
  }

  /**
   * Determine the primary reason/message for the validation result
   * Returns risk-appropriate message based on detection signals
   *
   * ALGORITHM CHANGE (v2.2.0 - 2025-11-08):
   * - Removed heuristic detectors (keyboard-walk, keyboard-mashing, gibberish)
   * - Markov-only detection with risk-tiered messaging
   * - High risk (≥0.6): Specific fraud reasons
   * - Medium risk (0.3-0.6): Descriptive warnings
   * - Low risk (<0.3): Legitimate pattern descriptions or "low_risk"
   */
  function determineBlockReason(params: {
    riskScore: number;
    email: string;
    markovResult: MarkovResult | null | undefined;
    patternFamilyResult: any;
    domainReputationScore: number;
    tldRiskScore: number;
    config: any;
  }): string {
    const { riskScore, email, markovResult, patternFamilyResult, domainReputationScore, tldRiskScore, config } = params;

    // TIER 1: HIGH CONFIDENCE DETECTIONS (any risk level)
    // These are definitive fraud signals that override risk-based messaging
    const highConfidenceReasons = [
      {
        condition: markovResult?.isLikelyFraudulent && markovResult.confidence > config.confidenceThresholds.markovFraud,
        reason: 'markov_chain_fraud'
      },
      {
        condition: patternFamilyResult?.patternType === 'sequential',
        reason: 'sequential_pattern'
      },
    ];

    // Check high-confidence detections first
    const highConfidence = highConfidenceReasons.find(r => r.condition);
    if (highConfidence) {
      return highConfidence.reason;
    }

    // TIER 2: RISK-BASED MESSAGING
    // Provide contextual messages based on actual risk level

    if (riskScore >= config.riskThresholds.block) {
      // HIGH RISK (≥0.6): Return strongest weak signal
      if (tldRiskScore > 0.5) return 'high_risk_tld';
      if (domainReputationScore > 0.5) return 'domain_reputation';
      if (patternFamilyResult?.patternType === 'dated') return 'dated_pattern';
      return 'high_risk_multiple_signals';
    } else if (riskScore >= config.riskThresholds.warn) {
      // MEDIUM RISK (0.3-0.6): Descriptive warnings
      if (patternFamilyResult?.patternType === 'dated') return 'suspicious_dated_pattern';
      if (tldRiskScore > 0.3) return 'suspicious_tld';
      if (domainReputationScore > 0.3) return 'suspicious_domain';
      return 'medium_risk';
    } else {
      // LOW RISK (<0.3): Legitimate descriptions
      // Return a descriptive status that reflects the actual pattern type
      if (patternFamilyResult?.patternType &&
          patternFamilyResult.patternType !== 'unknown' &&
          patternFamilyResult.patternType !== 'random') {
        return `legitimate_${patternFamilyResult.patternType}`;
      }
      return 'low_risk';
    }
  }

  // Get thresholds from configuration
  const blockThreshold = config.riskThresholds.block;
  const warnThreshold = config.riskThresholds.warn;

  // Determine base decision based on risk score
  let decision: 'allow' | 'warn' | 'block' = 'allow';
  const originalDecision: 'allow' | 'warn' | 'block' =
    riskScore > blockThreshold ? 'block' :
    riskScore > warnThreshold ? 'warn' :
    'allow';

  decision = originalDecision;

  // Apply action override if configured (with detailed logging)
  if (config.actionOverride && config.actionOverride !== originalDecision) {
    logger.info({
      event: 'decision_override_applied',
      originalDecision,
      overrideTo: config.actionOverride,
      riskScore: Math.round(riskScore * 100) / 100,
      email: email.substring(0, 3) + '***',
      reason: blockReason,
    }, `Override: ${originalDecision} → ${config.actionOverride}`);

    // Apply override based on mode
    if (config.actionOverride === 'allow') {
      // Monitoring mode: allow everything
      decision = 'allow';
    } else if (config.actionOverride === 'block') {
      // Strict mode: escalate warnings to blocks, keep blocks
      if (originalDecision === 'warn' || originalDecision === 'block') {
        decision = 'block';
      }
    } else if (config.actionOverride === 'warn') {
      // Warning mode: downgrade blocks to warns, keep warns
      if (originalDecision === 'block') {
        decision = 'warn';
      } else if (originalDecision === 'warn') {
        decision = 'warn';
      }
    }
  }

  // Log final decision
  logger.info({
    event: 'fraud_detection_decision',
    decision,
    originalDecision: config.actionOverride ? originalDecision : decision,
    riskScore: Math.round(riskScore * 100) / 100,
    blockReason,
    overrideApplied: config.actionOverride ? true : false,
    override: config.actionOverride,
    email: email.substring(0, 3) + '***',
    latency: Date.now() - startTime,
  }, `Decision: ${decision} (score: ${riskScore.toFixed(2)}, reason: ${blockReason})`);

  // Write metrics to D1 (Analytics Engine removed in Phase 4)
  const [localPart, domain] = email.split('@');
  const tld = domain ? domain.split('.').pop() : undefined;

  writeValidationMetric(c.env.DB, {
    decision,
    riskScore,
    entropyScore: emailValidation.signals.entropyScore,
    botScore: fingerprint.botScore,
    country: fingerprint.country,
    asn: fingerprint.asn,
    blockReason: decision === 'block' ? blockReason : undefined,
    fingerprintHash: fingerprint.hash,
    latency: Date.now() - startTime,
    emailLocalPart: localPart,
    domain: domain,
    tld: tld,
    patternType: patternFamilyResult?.patternType,
    patternFamily: patternFamilyResult?.family,
    isDisposable: domainValidation?.isDisposable,
    isFreeProvider: domainValidation?.isFreeProvider,
    hasPlusAddressing: normalizedEmailResult?.hasPlus,
    // REMOVED (2025-11-08): hasKeyboardWalk, hasKeyboardMashing, isGibberish
    // Deprecated - using Markov-only detection
    tldRiskScore: tldRiskScore,
    domainReputationScore: domainReputationScore,
    patternConfidence: patternFamilyResult?.confidence,
    markovDetected: markovResult?.isLikelyFraudulent,
    markovConfidence: markovResult?.confidence,
    markovCrossEntropyLegit: markovResult?.crossEntropyLegit,
    markovCrossEntropyFraud: markovResult?.crossEntropyFraud,
    patternClassificationVersion: '2.2.0', // v2.2: Markov-only detection (removed heuristics)
  });

  // Store validation result in context for downstream handlers
  c.set('fraudDetection', {
    decision,
    riskScore: Math.round(riskScore * 100) / 100,
    blockReason,
    valid: emailValidation.valid && (!domainValidation || !domainValidation.isDisposable),
    signals: {
      formatValid: emailValidation.signals.formatValid,
      entropyScore: Math.round(emailValidation.signals.entropyScore * 100) / 100,
      localPartLength: emailValidation.signals.localPartLength,
      isDisposableDomain: domainValidation?.isDisposable || false,
      isFreeProvider: domainValidation?.isFreeProvider || false,
      domainReputationScore: Math.round(domainReputationScore * 100) / 100,
      ...(config.features.enablePatternCheck && patternFamilyResult && {
        patternFamily: patternFamilyResult.family,
        patternType: patternFamilyResult.patternType,
        patternConfidence: Math.round(patternFamilyResult.confidence * 100) / 100,
        normalizedEmail: normalizedEmailResult?.normalized,
        hasPlusAddressing: normalizedEmailResult?.hasPlus || false,
        // REMOVED (2025-11-08): hasKeyboardWalk, keyboardWalkType, hasKeyboardMashing,
        // keyboardMashingConfidence, keyboardMashingRegion, isGibberish, gibberishConfidence
        // Using Markov-only detection for higher accuracy
        tldRiskScore: Math.round(tldRiskScore * 100) / 100,
      }),
      ...(config.features.enableMarkovChainDetection && markovResult && {
        markovDetected: markovResult.isLikelyFraudulent,
        markovConfidence: Math.round(markovResult.confidence * 100) / 100,
        markovCrossEntropyLegit: Math.round(markovResult.crossEntropyLegit * 100) / 100,
        markovCrossEntropyFraud: Math.round(markovResult.crossEntropyFraud * 100) / 100,
      }),
    },
  });

  // MONITORING MODE: Log but don't block
  if (config.actionOverride === 'allow') {
    logger.info({
      event: 'fraud_detection_monitor',
      path: c.req.path,
      email: localPart.substring(0, 3) + '***@' + domain,  // Masked for privacy
      decision,
      riskScore: Math.round(riskScore * 100) / 100,
      blockReason,
      latency: Date.now() - startTime,
    }, `[MONITOR] Fraud detection: ${decision} (risk: ${riskScore.toFixed(2)})`);
    return next(); // Always continue
  }

  // ENFORCEMENT MODE: Block if needed
  // Exception: /validate endpoint always passes through for full analysis response
  const isValidateEndpoint = path === '/validate';

  if (decision === 'block' && !isValidateEndpoint) {
    // Minimal response for all routes, with fraud signals in headers
    const response = new Response('Forbidden', { status: 403 });

    // Add fraud detection signals as response headers for observability
    response.headers.set('X-Fraud-Decision', decision);
    response.headers.set('X-Fraud-Reason', blockReason);
    response.headers.set('X-Fraud-Risk-Score', riskScore.toFixed(2));
    response.headers.set('X-Fraud-Fingerprint', fingerprint.hash.substring(0, 16)); // First 16 chars

    return response;
  }

  // ALLOW or /validate endpoint: Add fraud signals to response headers for observability
  // This allows downstream routes to see the fraud check happened
  c.header('X-Fraud-Decision', decision);
  c.header('X-Fraud-Risk-Score', riskScore.toFixed(2));

  // Continue to next handler
  return next();

  } catch (error) {
    // Log the error with full details
    logger.error({
      event: 'fraud_detection_error',
      email: email.substring(0, 3) + '***',
      path,
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name,
      } : String(error),
      latency: Date.now() - startTime,
    }, 'Fraud detection middleware error');

    // Set fallback fraudDetection context
    c.set('fraudDetection', {
      decision: null,
      riskScore: 0,
      blockReason: 'error',
      valid: null,
      signals: {},
    });

    // Continue to next handler (fail open for better debugging)
    return next();
  }
}
