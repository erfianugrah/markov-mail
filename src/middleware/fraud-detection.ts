/**
 * Global Fraud Detection Middleware
 *
 * Runs on ALL routes by default, validates any request with an 'email' field.
 * Routes can opt-out by setting: c.set('skipFraudDetection', true)
 */

import pkg from '../../package.json';

/**
 * Pattern Classification Algorithm Version
 *
 * v2.0: Original entropy-based pattern detection
 * v2.1: Multi-factor detection (n-grams + vowel density + entropy) + dynamic messages
 * v2.2: Markov-only detection (removed keyboard-walk, keyboard-mashing, gibberish heuristics)
 *       83% accuracy vs 67% with heuristics, zero false positives on legitimate names
 * v2.3: Markov ensemble (2-gram + 3-gram) with confidence-weighted voting
 *       Combines 2-gram robustness with 3-gram context awareness
 * v2.4: Two-dimensional risk model with OOD (Out-of-Distribution) detection
 *       Classification risk (fraud vs legit) + Abnormality risk (novel patterns)
 *       Catches anagrams, shuffles, and patterns outside training distribution
 */
export const PATTERN_CLASSIFICATION_VERSION = pkg.version;

// Local type for Markov result in middleware (combines results from legit and fraud models)
interface MarkovResult {
  isLikelyFraudulent: boolean;
  crossEntropyLegit: number;
  crossEntropyFraud: number;
  confidence: number;
  differenceRatio: number;
  ensembleReasoning?: string; // Why ensemble chose this prediction
  model2gramPrediction?: string; // 2-gram prediction (if ensemble)
  model3gramPrediction?: string; // 3-gram prediction (if ensemble)
  // OOD Detection (v2.4+)
  minEntropy?: number;          // min(H_legit, H_fraud) - measures abnormality
  abnormalityScore?: number;    // How far above OOD threshold (0 if below)
  abnormalityRisk?: number;     // Risk contribution from abnormality (0.0-0.6)
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
// Ensemble approach: Use both 2-gram (robust) and 3-gram (context-aware)
let markovLegitModel2gram: NGramMarkovChain | null = null;
let markovFraudModel2gram: NGramMarkovChain | null = null;
let markovLegitModel3gram: NGramMarkovChain | null = null;
let markovFraudModel3gram: NGramMarkovChain | null = null;
let markovModelsLoaded = false;

// Ensemble configuration thresholds
const ENSEMBLE_THRESHOLDS = {
  both_agree_min: 0.3,        // Minimum confidence when both agree
  override_3gram_min: 0.5,    // 3-gram needs this to override
  override_ratio: 1.5,        // 3-gram must be 1.5x more confident
  gibberish_entropy: 6.0,     // Cross-entropy threshold for gibberish
  gibberish_2gram_min: 0.2,   // Min 2-gram confidence for gibberish
};

// OOD (Out-of-Distribution) Detection Thresholds (v2.4.1+)
// Research-backed constants for anomaly detection via cross-entropy
// v2.4.1: Piecewise threshold system with dead zone, warn zone, and block zone
// v2.4.2: MAX_OOD_RISK moved to config for tunability
const OOD_DETECTION = {
  BASELINE_ENTROPY: 0.69,       // Random guessing baseline (log 2 in nats) - IMMUTABLE
  OOD_WARN_THRESHOLD: 3.8,      // Patterns above this enter warn zone - RESEARCH-BACKED
  OOD_BLOCK_THRESHOLD: 5.5,     // Patterns above this enter block zone - RESEARCH-BACKED
  // MAX_OOD_RISK moved to config.ood.maxRisk (v2.4.2+) - now tunable
};

// For backwards compatibility (points to 2-gram by default)
let markovLegitModel: NGramMarkovChain | null = null;
let markovFraudModel: NGramMarkovChain | null = null;

/**
 * Load Markov Chain models from KV storage
 * Ensemble approach: Load both 2-gram and 3-gram models
 * - 2-gram: Robust gibberish detection, good generalization
 * - 3-gram: Context-aware, high confidence on well-trained patterns
 */
async function loadMarkovModels(env: Env): Promise<boolean> {
  if (markovModelsLoaded) return true;

  try {
    if (!env.MARKOV_MODEL) {
      logger.warn('MARKOV_MODEL namespace not configured');
      return false;
    }

    // Load both 2-gram and 3-gram models for ensemble
    const legit2Data = await env.MARKOV_MODEL.get('MM_legit_2gram', 'json');
    const fraud2Data = await env.MARKOV_MODEL.get('MM_fraud_2gram', 'json');
    const legit3Data = await env.MARKOV_MODEL.get('MM_legit_3gram', 'json');
    const fraud3Data = await env.MARKOV_MODEL.get('MM_fraud_3gram', 'json');

    logger.info({
      event: 'markov_kv_fetch_result',
      has2gramLegit: !!legit2Data,
      has2gramFraud: !!fraud2Data,
      has3gramLegit: !!legit3Data,
      has3gramFraud: !!fraud3Data,
    }, 'KV fetch result');

    // Load 2-gram models (primary)
    if (legit2Data && fraud2Data) {
      markovLegitModel2gram = NGramMarkovChain.fromJSON(legit2Data);
      markovFraudModel2gram = NGramMarkovChain.fromJSON(fraud2Data);

      // Set backwards compatible pointers
      markovLegitModel = markovLegitModel2gram;
      markovFraudModel = markovFraudModel2gram;

      logger.info({
        event: '2gram_markov_models_loaded',
        legitSamples: (legit2Data as any).trainingCount || 'unknown',
        fraudSamples: (fraud2Data as any).trainingCount || 'unknown',
      }, '2-gram models loaded');
    }

    // Load 3-gram models (for ensemble)
    if (legit3Data && fraud3Data) {
      markovLegitModel3gram = NGramMarkovChain.fromJSON(legit3Data);
      markovFraudModel3gram = NGramMarkovChain.fromJSON(fraud3Data);

      logger.info({
        event: '3gram_markov_models_loaded',
        legitSamples: (legit3Data as any).trainingCount || 'unknown',
        fraudSamples: (fraud3Data as any).trainingCount || 'unknown',
      }, '3-gram models loaded');
    }

    // Mark as loaded if we have at least 2-gram
    if (markovLegitModel2gram && markovFraudModel2gram) {
      markovModelsLoaded = true;
      const ensembleEnabled = !!(markovLegitModel3gram && markovFraudModel3gram);
      logger.info({
        event: 'markov_models_ready',
        has2gram: true,
        has3gram: ensembleEnabled,
        ensembleEnabled,
      }, 'Markov models ready');
      return true;
    } else {
      logger.warn({
        event: 'markov_data_missing',
        has2gram: !!(legit2Data && fraud2Data),
        has3gram: !!(legit3Data && fraud3Data),
      }, 'Missing required Markov model data');
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
 * Ensemble prediction combining 2-gram and 3-gram models
 * Uses confidence-weighted voting with intelligent fallback logic
 *
 * Strategy:
 * 1. Both models agree with high confidence → use agreed prediction
 * 2. 3-gram has very high confidence → trust 3-gram
 * 3. 2-gram detects gibberish (high entropy) → trust 2-gram
 * 4. Models disagree → default to 2-gram (more robust)
 * 5. Otherwise → use higher confidence model
 */
function ensemblePredict(
  localPart: string,
  legit2: NGramMarkovChain,
  fraud2: NGramMarkovChain,
  legit3: NGramMarkovChain | null,
  fraud3: NGramMarkovChain | null,
  config: any // FraudDetectionConfig - v2.4.2: needed for OOD tunable parameters
): MarkovResult {
  // Calculate 2-gram results (always available)
  const H_legit2 = legit2.crossEntropy(localPart);
  const H_fraud2 = fraud2.crossEntropy(localPart);

  const isLikelyFraud2 = H_fraud2 < H_legit2;
  const diff2 = Math.abs(H_legit2 - H_fraud2);
  const maxH2 = Math.max(H_legit2, H_fraud2);
  const diffRatio2 = maxH2 > 0 ? diff2 / maxH2 : 0;
  const confidence2 = Math.min(diffRatio2 * 2, 1.0);

  const prediction2 = isLikelyFraud2 ? 'fraud' : 'legit';

  // If no 3-gram models, return 2-gram results
  if (!legit3 || !fraud3) {
    // OOD Detection (v2.4.1+) - Piecewise Linear Threshold
    const minEntropy = Math.min(H_legit2, H_fraud2);
    let abnormalityScore: number;
    let abnormalityRisk: number;

    if (minEntropy < OOD_DETECTION.OOD_WARN_THRESHOLD) {
      // Below warn threshold: familiar patterns, no OOD risk
      abnormalityScore = 0;
      abnormalityRisk = 0;
    } else if (minEntropy < OOD_DETECTION.OOD_BLOCK_THRESHOLD) {
      // Warn zone: linear interpolation from warnZoneMin to maxRisk (v2.4.2: configurable)
      abnormalityScore = minEntropy - OOD_DETECTION.OOD_WARN_THRESHOLD;
      const range = OOD_DETECTION.OOD_BLOCK_THRESHOLD - OOD_DETECTION.OOD_WARN_THRESHOLD;
      const progress = abnormalityScore / range;
      abnormalityRisk = config.ood.warnZoneMin + progress * (config.ood.maxRisk - config.ood.warnZoneMin);
    } else {
      // Block zone: maximum OOD risk (v2.4.2: configurable)
      abnormalityScore = minEntropy - OOD_DETECTION.OOD_WARN_THRESHOLD;
      abnormalityRisk = config.ood.maxRisk;
    }

    return {
      isLikelyFraudulent: isLikelyFraud2,
      crossEntropyLegit: H_legit2,
      crossEntropyFraud: H_fraud2,
      confidence: confidence2,
      differenceRatio: diffRatio2,
      ensembleReasoning: '2gram_only',
      model2gramPrediction: prediction2,
      // OOD metrics (v2.4.1+)
      minEntropy,
      abnormalityScore,
      abnormalityRisk,
    };
  }

  // Calculate 3-gram results
  const H_legit3 = legit3.crossEntropy(localPart);
  const H_fraud3 = fraud3.crossEntropy(localPart);

  const isLikelyFraud3 = H_fraud3 < H_legit3;
  const diff3 = Math.abs(H_legit3 - H_fraud3);
  const maxH3 = Math.max(H_legit3, H_fraud3);
  const diffRatio3 = maxH3 > 0 ? diff3 / maxH3 : 0;
  const confidence3 = Math.min(diffRatio3 * 2, 1.0);

  const prediction3 = isLikelyFraud3 ? 'fraud' : 'legit';

  // Ensemble decision logic
  let finalPrediction: 'fraud' | 'legit';
  let finalConfidence: number;
  let finalCrossEntropyLegit: number;
  let finalCrossEntropyFraud: number;
  let reasoning: string;

  // Case 1: Both agree with high confidence (>0.3)
  if (prediction2 === prediction3 && Math.min(confidence2, confidence3) > ENSEMBLE_THRESHOLDS.both_agree_min) {
    finalPrediction = prediction2;
    finalConfidence = Math.max(confidence2, confidence3);
    finalCrossEntropyLegit = prediction2 === prediction3 ?
      (confidence2 >= confidence3 ? H_legit2 : H_legit3) : H_legit2;
    finalCrossEntropyFraud = prediction2 === prediction3 ?
      (confidence2 >= confidence3 ? H_fraud2 : H_fraud3) : H_fraud2;
    reasoning = 'both_agree_high_confidence';
  }
  // Case 2: 3-gram has VERY high confidence (>0.5) - trust it
  else if (confidence3 > ENSEMBLE_THRESHOLDS.override_3gram_min &&
           confidence3 > confidence2 * ENSEMBLE_THRESHOLDS.override_ratio) {
    finalPrediction = prediction3;
    finalConfidence = confidence3;
    finalCrossEntropyLegit = H_legit3;
    finalCrossEntropyFraud = H_fraud3;
    reasoning = '3gram_high_confidence_override';
  }
  // Case 3: 2-gram detects gibberish (high cross-entropy for fraud)
  else if (prediction2 === 'fraud' &&
           confidence2 > ENSEMBLE_THRESHOLDS.gibberish_2gram_min &&
           H_fraud2 > ENSEMBLE_THRESHOLDS.gibberish_entropy) {
    finalPrediction = 'fraud';
    finalConfidence = confidence2;
    finalCrossEntropyLegit = H_legit2;
    finalCrossEntropyFraud = H_fraud2;
    reasoning = '2gram_gibberish_detection';
  }
  // Case 4: Disagree - default to 2-gram (more robust)
  else if (prediction2 !== prediction3) {
    finalPrediction = prediction2;
    finalConfidence = confidence2;
    finalCrossEntropyLegit = H_legit2;
    finalCrossEntropyFraud = H_fraud2;
    reasoning = 'disagree_default_to_2gram';
  }
  // Case 5: Use higher confidence model
  else {
    if (confidence2 >= confidence3) {
      finalPrediction = prediction2;
      finalConfidence = confidence2;
      finalCrossEntropyLegit = H_legit2;
      finalCrossEntropyFraud = H_fraud2;
      reasoning = '2gram_higher_confidence';
    } else {
      finalPrediction = prediction3;
      finalConfidence = confidence3;
      finalCrossEntropyLegit = H_legit3;
      finalCrossEntropyFraud = H_fraud3;
      reasoning = '3gram_higher_confidence';
    }
  }

  const finalDiff = Math.abs(finalCrossEntropyLegit - finalCrossEntropyFraud);
  const finalMaxH = Math.max(finalCrossEntropyLegit, finalCrossEntropyFraud);
  const finalDiffRatio = finalMaxH > 0 ? finalDiff / finalMaxH : 0;

  // OOD Detection (v2.4.1+) - Piecewise Linear Threshold
  // When BOTH models have high cross-entropy, the pattern is out-of-distribution
  const minEntropy = Math.min(finalCrossEntropyLegit, finalCrossEntropyFraud);
  let abnormalityScore: number;
  let abnormalityRisk: number;

  if (minEntropy < OOD_DETECTION.OOD_WARN_THRESHOLD) {
    // Below warn threshold: familiar patterns, no OOD risk
    abnormalityScore = 0;
    abnormalityRisk = 0;
  } else if (minEntropy < OOD_DETECTION.OOD_BLOCK_THRESHOLD) {
    // Warn zone: linear interpolation from warnZoneMin to maxRisk (v2.4.2: configurable)
    abnormalityScore = minEntropy - OOD_DETECTION.OOD_WARN_THRESHOLD;
    const range = OOD_DETECTION.OOD_BLOCK_THRESHOLD - OOD_DETECTION.OOD_WARN_THRESHOLD;
    const progress = abnormalityScore / range;
    abnormalityRisk = config.ood.warnZoneMin + progress * (config.ood.maxRisk - config.ood.warnZoneMin);
  } else {
    // Block zone: maximum OOD risk (v2.4.2: configurable)
    abnormalityScore = minEntropy - OOD_DETECTION.OOD_WARN_THRESHOLD;
    abnormalityRisk = config.ood.maxRisk;
  }

  return {
    isLikelyFraudulent: finalPrediction === 'fraud',
    crossEntropyLegit: finalCrossEntropyLegit,
    crossEntropyFraud: finalCrossEntropyFraud,
    confidence: finalConfidence,
    differenceRatio: finalDiffRatio,
    ensembleReasoning: reasoning,
    model2gramPrediction: prediction2,
    model3gramPrediction: prediction3,
    // OOD metrics (v2.4.1+)
    minEntropy,
    abnormalityScore,
    abnormalityRisk,
  };
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
  // Uses ensemble approach combining 2-gram and 3-gram models
  let markovResult: MarkovResult | undefined;

  if (emailValidation.valid && config.features.enableMarkovChainDetection) {
    const ensembleEnabled = !!(markovLegitModel2gram && markovFraudModel2gram && markovLegitModel3gram && markovFraudModel3gram);
    logger.info({
      event: 'markov_starting',
      email: email.substring(0, 3) + '***',
      ensembleEnabled,
    }, 'Starting Markov detection');

    if (markovLegitModel2gram && markovFraudModel2gram) {
      try {
        const [localPart] = email.split('@');
        logger.info({
          event: 'markov_calculating',
          localPart: localPart.substring(0, 3) + '***',
          hasEnsemble: ensembleEnabled,
        }, 'Calculating ensemble prediction');

        // Use ensemble prediction (combines 2-gram and 3-gram if available)
        markovResult = ensemblePredict(
          localPart,
          markovLegitModel2gram,
          markovFraudModel2gram,
          markovLegitModel3gram,
          markovFraudModel3gram,
          config // v2.4.2: pass config for OOD tunable parameters
        );

        logger.info({
          event: 'markov_prediction_complete',
          isLikelyFraudulent: markovResult.isLikelyFraudulent,
          confidence: markovResult.confidence,
          ensembleReasoning: markovResult.ensembleReasoning,
          model2gramPrediction: markovResult.model2gramPrediction,
          model3gramPrediction: markovResult.model3gramPrediction,
        }, 'Ensemble prediction complete');
      } catch (crossEntropyError) {
        logger.error({
          event: 'markov_prediction_failed',
          error: crossEntropyError instanceof Error ? crossEntropyError.message : String(crossEntropyError),
        }, 'Failed to calculate ensemble prediction');
      }
    }
  }

  // Calculate risk score using early returns for priority checks
  let riskScore = 0;
  let blockReason = '';
  let classificationRisk = 0;
  let domainRisk = 0;
  let ensembleBoost = 0;

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

    const riskCalculation = calculateAlgorithmicRiskScore({
      email,
      markovResult,
      patternFamilyResult,
      domainReputationScore,
      tldRiskScore,
      normalizedEmailResult
    });
    riskScore = riskCalculation.score;
    classificationRisk = riskCalculation.classificationRisk;
    domainRisk = riskCalculation.domainRisk;
    ensembleBoost = riskCalculation.ensembleBoost;

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
   * Calculate risk score using two-dimensional approach
   *
   * ALGORITHM CHANGES:
   * v2.2 (2025-11-08): Removed heuristic detectors, Markov-only (83% accuracy vs 67%)
   * v2.3 (2025-11-10): Ensemble (2-gram + 3-gram) with confidence-weighted voting
   * v2.4 (2025-11-10): Two-dimensional risk model
   *   - Classification risk: Is this fraud or legit? (differential signal)
   *   - Abnormality risk: Is this out-of-distribution? (consensus signal)
   *   - Final risk: max(classification, abnormality) + domain signals
   * v2.4.2 (2025-11-12): Return risk breakdown for transparency
   */
  function calculateAlgorithmicRiskScore(params: {
    email: string;
    markovResult: MarkovResult | null | undefined;
    patternFamilyResult: any;
    domainReputationScore: number;
    tldRiskScore: number;
    normalizedEmailResult: any;
  }): { score: number; classificationRisk: number; domainRisk: number; ensembleBoost: number } {
    const { email, markovResult, patternFamilyResult, domainReputationScore, tldRiskScore, normalizedEmailResult } = params;

    // Check if this is a professional email
    const isProfessional = isProfessionalEmail(email);

    // Primary: Two-dimensional risk from Markov models (v2.4+)
    // Dimension 1: Classification risk (fraud vs legit)
    let classificationRisk = markovResult?.isLikelyFraudulent ? markovResult.confidence : 0;
    if (isProfessional && classificationRisk < 0.7) {
      classificationRisk = classificationRisk * config.adjustments.professionalEmailFactor; // v2.4.2: configurable
    }

    // Dimension 2: Abnormality risk (out-of-distribution)
    const abnormalityRisk = markovResult?.abnormalityRisk || 0;

    // Combined risk: Take stronger signal (independent dimensions)
    let score = Math.max(classificationRisk, abnormalityRisk);

    // Secondary: Deterministic pattern overrides
    // v2.4.2: Removed sequential and plus-addressing overrides - Markov handles these
    // Keep dated pattern override as it has dynamic confidence based on age analysis

    // Dated patterns use confidence from age-aware algorithm (0.2 for birth years, 0.9 for fraud)
    if (patternFamilyResult?.patternType === 'dated') {
      score = Math.max(score, patternFamilyResult?.confidence || 0.7);
    }

    // Tertiary: Domain signals (disposable domains, TLD risk)
    // v2.4.2: weights now configurable
    let domainRisk = domainReputationScore * config.riskWeights.domainReputation
                   + tldRiskScore * config.riskWeights.tldRisk;
    if (isProfessional) {
      domainRisk = domainRisk * config.adjustments.professionalDomainFactor; // v2.4.2: configurable
    }

    // Ensemble boost: When Markov classification and TLD risk agree, increase confidence
    // v2.4.2: boost multiplier, max, and threshold now configurable
    let ensembleBoost = 0;
    if (markovResult?.isLikelyFraudulent && tldRiskScore > config.ensemble.tldAgreementThreshold) {
      ensembleBoost = Math.min(
        classificationRisk * tldRiskScore * config.ensemble.boostMultiplier,
        config.ensemble.maxBoost
      );
      score += ensembleBoost;
      logger.info({
        event: 'ensemble_boost_applied',
        classificationRisk,
        abnormalityRisk,
        tldRiskScore,
        boost: ensembleBoost,
      }, 'Ensemble boost: Classification + TLD risk agreement');
    }

    return {
      score: Math.min(score + domainRisk, 1.0),
      classificationRisk,
      domainRisk,
      ensembleBoost,
    };
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
    // v2.4.2: Removed sequential_pattern - now handled by Markov models
    const highConfidenceReasons = [
      {
        condition: markovResult?.isLikelyFraudulent && markovResult.confidence > config.confidenceThresholds.markovFraud,
        reason: 'markov_chain_fraud'
      },
      {
        condition: markovResult?.abnormalityScore && markovResult.abnormalityScore > 1.5,
        reason: 'out_of_distribution'
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
      if (markovResult?.abnormalityRisk && markovResult.abnormalityRisk > 0.4) return 'high_abnormality';
      if (tldRiskScore > 0.5) return 'high_risk_tld';
      if (domainReputationScore > 0.5) return 'domain_reputation';
      if (patternFamilyResult?.patternType === 'dated') return 'dated_pattern';
      return 'high_risk_multiple_signals';
    } else if (riskScore >= config.riskThresholds.warn) {
      // MEDIUM RISK (0.3-0.6): Descriptive warnings
      if (markovResult?.abnormalityRisk && markovResult.abnormalityRisk > 0.2) return 'suspicious_abnormal_pattern';
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

  // Calculate OOD zone for tracking (v2.4.1+)
  let oodZone: string | undefined;
  if (markovResult?.minEntropy !== undefined) {
    if (markovResult.minEntropy < OOD_DETECTION.OOD_WARN_THRESHOLD) {
      oodZone = 'none';
    } else if (markovResult.minEntropy < OOD_DETECTION.OOD_BLOCK_THRESHOLD) {
      oodZone = 'warn';
    } else {
      oodZone = 'block';
    }
  }

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
    ensembleReasoning: markovResult?.ensembleReasoning,
    model2gramPrediction: markovResult?.model2gramPrediction,
    model3gramPrediction: markovResult?.model3gramPrediction,
    // OOD Detection (v2.4+)
    minEntropy: markovResult?.minEntropy,
    abnormalityScore: markovResult?.abnormalityScore,
    abnormalityRisk: markovResult?.abnormalityRisk,
    oodDetected: markovResult?.abnormalityScore ? markovResult.abnormalityScore > 0 : false,
    // OOD Zone (v2.4.1+)
    oodZone: oodZone,
    patternClassificationVersion: PATTERN_CLASSIFICATION_VERSION
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
        ...(markovResult.ensembleReasoning && {
          ensembleReasoning: markovResult.ensembleReasoning,
          model2gramPrediction: markovResult.model2gramPrediction,
          model3gramPrediction: markovResult.model3gramPrediction,
        }),
        // OOD Detection (v2.4+)
        ...(markovResult.minEntropy !== undefined && {
          minEntropy: Math.round(markovResult.minEntropy * 100) / 100,
          abnormalityScore: Math.round((markovResult.abnormalityScore || 0) * 100) / 100,
          abnormalityRisk: Math.round((markovResult.abnormalityRisk || 0) * 100) / 100,
          oodDetected: (markovResult.abnormalityScore || 0) > 0,
        }),
      }),
      // Risk Breakdown (v2.4.2+) - Transparency into risk scoring components
      ...(config.features.enableMarkovChainDetection && markovResult && {
        classificationRisk: Math.round(classificationRisk * 100) / 100,
        domainRisk: Math.round(domainRisk * 100) / 100,
        ensembleBoost: Math.round(ensembleBoost * 100) / 100,
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
