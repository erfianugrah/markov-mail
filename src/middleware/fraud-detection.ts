/**
 * Global Fraud Detection Middleware
 *
 * Runs on ALL routes by default, validates any request with an 'email' field.
 * Routes can opt-out by setting: c.set('skipFraudDetection', true)
 */

import { Context, Next } from 'hono';
import { generateFingerprint } from '../fingerprint';
import { validateEmail } from '../validators/email';
import { validateDomain, getDomainReputationScore } from '../validators/domain';
import {
  extractPatternFamily,
  getPatternRiskScore,
  normalizeEmail,
  detectKeyboardWalk,
  getKeyboardWalkRiskScore,
  getPlusAddressingRiskScore,
  getNGramRiskScore,
  detectGibberish,
  analyzeTLDRisk,
  detectMarkovPattern,
  DynamicMarkovChain,
  type MarkovResult
} from '../detectors';
import { loadDisposableDomains } from '../services/disposable-domain-updater';
import { loadTLDRiskProfiles } from '../services/tld-risk-updater';
import { writeValidationMetric } from '../utils/metrics';
import { getConfig } from '../config';
import { logger } from '../logger';

// Cache Markov models globally per worker instance
let markovLegitModel: DynamicMarkovChain | null = null;
let markovFraudModel: DynamicMarkovChain | null = null;
let markovModelsLoaded = false;

/**
 * Load Markov Chain models from KV storage
 */
async function loadMarkovModels(env: Env): Promise<boolean> {
  if (markovModelsLoaded) return true;

  try {
    if (!env.MARKOV_MODEL) {
      logger.warn('MARKOV_MODEL namespace not configured');
      return false;
    }

    const legitData = await env.MARKOV_MODEL.get('MM_legit_production', 'json');
    const fraudData = await env.MARKOV_MODEL.get('MM_fraud_production', 'json');

    if (legitData && fraudData) {
      markovLegitModel = DynamicMarkovChain.fromJSON(legitData);
      markovFraudModel = DynamicMarkovChain.fromJSON(fraudData);
      markovModelsLoaded = true;
      logger.info('Markov Chain models loaded successfully');
      return true;
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

  // Pattern analysis
  let patternFamilyResult;
  let normalizedEmailResult;
  let keyboardWalkResult;
  let gibberishResult;
  let patternRiskScore = 0;

  if (emailValidation.valid && config.features.enablePatternCheck) {
    // Extract pattern family
    patternFamilyResult = await extractPatternFamily(email);
    patternRiskScore = getPatternRiskScore(patternFamilyResult);

    // Normalize email (plus-addressing detection)
    normalizedEmailResult = normalizeEmail(email);
    const plusAddressingRisk = getPlusAddressingRiskScore(email);

    // Keyboard walk detection
    keyboardWalkResult = detectKeyboardWalk(email);
    const keyboardWalkRisk = getKeyboardWalkRiskScore(keyboardWalkResult);

    // N-Gram gibberish detection
    const [localPart] = email.split('@');
    const ngramRisk = getNGramRiskScore(localPart);
    gibberishResult = detectGibberish(email);

    // Combine pattern risks
    patternRiskScore = Math.max(
      patternRiskScore,
      plusAddressingRisk,
      keyboardWalkRisk,
      ngramRisk
    );
  }

  // Markov Chain detection
  let markovResult: MarkovResult | undefined;
  let markovRiskScore = 0;

  if (emailValidation.valid && config.features.enableMarkovChainDetection) {
    await loadMarkovModels(c.env);

    if (markovLegitModel && markovFraudModel) {
      markovResult = detectMarkovPattern(
        email,
        markovLegitModel,
        markovFraudModel
      );

      // Use Markov risk only if confidence is high enough (configurable)
      if (markovResult.isLikelyFraudulent && markovResult.confidence > config.confidenceThresholds.markovFraud) {
        markovRiskScore = markovResult.confidence;
      }
    }
  }

  // Calculate risk score
  let riskScore = 0;
  let blockReason = '';

  if (!emailValidation.valid) {
    riskScore = config.baseRiskScores.invalidFormat;
    blockReason = emailValidation.reason || 'invalid_format';
  } else if (domainValidation && domainValidation.isDisposable) {
    riskScore = config.baseRiskScores.disposableDomain;
    blockReason = 'disposable_domain';
  } else if (emailValidation.signals.entropyScore > config.baseRiskScores.highEntropy) {
    riskScore = emailValidation.signals.entropyScore;
    blockReason = 'high_entropy';
  } else {
    // Enhanced risk scoring with domain and pattern signals
    // Domain signals (independent) - additive
    const domainRisk = domainReputationScore * config.riskWeights.domainReputation;
    const tldRisk = tldRiskScore * config.riskWeights.tldRisk;
    const domainBasedRisk = domainRisk + tldRisk;

    // Local part signals (overlapping) - use max to prevent double counting
    const entropyRisk = emailValidation.signals.entropyScore * config.riskWeights.entropy;
    const combinedPatternRisk = patternRiskScore * config.riskWeights.patternDetection;
    const markovRisk = markovRiskScore * config.riskWeights.markovChain;

    const localPartRisk = Math.max(entropyRisk, combinedPatternRisk, markovRisk);

    // Combine domain and local part risks
    riskScore = Math.min(domainBasedRisk + localPartRisk, 1.0);

    // Set block reason based on highest risk factor
    if (localPartRisk > domainBasedRisk) {
      if (markovRisk === localPartRisk && markovRiskScore > config.confidenceThresholds.markovRisk && markovResult && markovResult.confidence > config.confidenceThresholds.markovFraud) {
        blockReason = 'markov_chain_fraud';
      } else if (combinedPatternRisk === localPartRisk && patternRiskScore > config.confidenceThresholds.patternRisk) {
        if (gibberishResult?.isGibberish) {
          blockReason = 'gibberish_detected';
        } else if (patternFamilyResult?.patternType === 'sequential') {
          blockReason = 'sequential_pattern';
        } else if (patternFamilyResult?.patternType === 'dated') {
          blockReason = 'dated_pattern';
        } else if (normalizedEmailResult?.hasPlus) {
          blockReason = 'plus_addressing_abuse';
        } else if (keyboardWalkResult?.hasKeyboardWalk) {
          blockReason = 'keyboard_walk';
        } else {
          blockReason = 'suspicious_pattern';
        }
      } else if (entropyRisk === localPartRisk) {
        blockReason = 'high_entropy';
      } else {
        blockReason = 'suspicious_local_part';
      }
    } else {
      if (tldRisk > domainRisk) {
        blockReason = 'high_risk_tld';
      } else {
        blockReason = 'domain_reputation';
      }
    }
  }

  // Get thresholds from configuration
  const blockThreshold = config.riskThresholds.block;
  const warnThreshold = config.riskThresholds.warn;

  // Determine decision
  let decision: 'allow' | 'warn' | 'block' = 'allow';
  if (riskScore > blockThreshold) {
    decision = 'block';
  } else if (riskScore > warnThreshold) {
    decision = 'warn';
  }

  // Apply action override if configured
  if (config.actionOverride !== 'allow') {
    if (config.actionOverride === 'block' && decision === 'warn') {
      decision = 'block'; // Escalate warnings to blocks
    }
  }

  // Write metrics to Analytics Engine
  const [localPart, domain] = email.split('@');
  const tld = domain ? domain.split('.').pop() : undefined;

  writeValidationMetric(c.env.ANALYTICS, {
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
    hasKeyboardWalk: keyboardWalkResult?.hasKeyboardWalk,
    isGibberish: gibberishResult?.isGibberish,
    tldRiskScore: tldRiskScore,
    domainReputationScore: domainReputationScore,
    patternConfidence: patternFamilyResult?.confidence,
    markovDetected: markovResult?.isLikelyFraudulent,
    markovConfidence: markovResult?.confidence,
    markovCrossEntropyLegit: markovResult?.crossEntropyLegit,
    markovCrossEntropyFraud: markovResult?.crossEntropyFraud,
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
        patternRiskScore: Math.round(patternRiskScore * 100) / 100,
        normalizedEmail: normalizedEmailResult?.normalized,
        hasPlusAddressing: normalizedEmailResult?.hasPlus || false,
        hasKeyboardWalk: keyboardWalkResult?.hasKeyboardWalk || false,
        keyboardWalkType: keyboardWalkResult?.walkType,
        isGibberish: gibberishResult?.isGibberish || false,
        gibberishConfidence: gibberishResult ? Math.round(gibberishResult.confidence * 100) / 100 : undefined,
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
  if (decision === 'block') {
    return c.json({
      error: 'Email validation failed',
      reason: blockReason,
      riskScore: Math.round(riskScore * 100) / 100
    }, 400);
  }

  // Continue to next handler
  return next();
}
