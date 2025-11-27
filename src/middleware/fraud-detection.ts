/**
 * Global Fraud Detection Middleware
 *
 * Runs on ALL routes by default, validates any request with an 'email' field.
 * Routes can opt-out by setting: c.set('skipFraudDetection', true)
 */

import pkg from '../../package.json';
import { Context, Next } from 'hono';
import { generateFingerprint } from '../fingerprint';
import { validateEmail } from '../validators/email';
import { validateDomain, getDomainReputationScore, type DomainValidationResult } from '../validators/domain';
import {
  extractPatternFamily,
  normalizeEmail,
  analyzeTLDRisk,
  getPlusAddressingRiskScore
} from '../detectors';
import { detectSequentialPattern } from '../detectors/sequential';
import {
  loadABTestConfig,
  getAssignment as getABAssignment,
  getVariantConfig as getABVariantConfig,
  type ABTestAssignment,
  type ABTestConfig
} from '../ab-testing';
// REMOVED (2025-11-08): detectKeyboardWalk, detectKeyboardMashing, detectGibberish
// Replaced with Markov-only detection for higher accuracy (83% vs 67%) and zero false positives
import { NGramMarkovChain, type NGramMarkovResult } from '../detectors/ngram-markov';
import { ensemblePredict, type MarkovResult, OOD_CONSTANTS } from '../detectors/markov-ensemble';
import { loadDisposableDomains } from '../services/disposable-domain-updater';
import { loadTLDRiskProfiles } from '../services/tld-risk-updater';
import { writeValidationMetric } from '../utils/metrics';
import { getConfig } from '../config';
import { buildCalibrationFeatureMap, applyCalibration, type CalibrationFeatureMap } from '../utils/calibration';
import { extractLocalPartFeatureSignals, type LocalPartFeatureSignals } from '../detectors/linguistic-features';
import { logger } from '../logger';

// Cache Markov models globally per worker instance
// Ensemble approach: Use both 2-gram (robust) and 3-gram (context-aware)
let markovLegitModel2gram: NGramMarkovChain | null = null;
let markovFraudModel2gram: NGramMarkovChain | null = null;
let markovLegitModel3gram: NGramMarkovChain | null = null;
let markovFraudModel3gram: NGramMarkovChain | null = null;
let markovModelsLoaded = false;
const PATTERN_CLASSIFICATION_VERSION = '2.5.0';

// Cache AB test configuration to avoid KV reads on every request
let cachedABTestConfig: ABTestConfig | null = null;
let abConfigCacheTimestamp = 0;
const AB_CONFIG_CACHE_TTL = 60000; // 1 minute

async function getActiveABTestConfig(kv: KVNamespace | undefined): Promise<ABTestConfig | null> {
	if (!kv) {
		return null;
	}

	const now = Date.now();
	if (cachedABTestConfig && now - abConfigCacheTimestamp < AB_CONFIG_CACHE_TTL) {
		return cachedABTestConfig;
	}

	const config = await loadABTestConfig(kv);
	cachedABTestConfig = config;
	abConfigCacheTimestamp = now;
	return config;
}

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
  let consumer: string | undefined;
  let flow: string | undefined;

  // Try JSON first
  let bodyParsed = false;

  try {
    requestBody = await c.req.json();
    bodyParsed = true;
  } catch {
    try {
      const formData = await c.req.formData();
      requestBody = {} as Record<string, string>;
      formData.forEach((value, key) => {
        (requestBody as Record<string, string>)[key] = value?.toString() ?? '';
      });
      bodyParsed = true;
    } catch {
      try {
        const rawText = await c.req.text();
        requestBody = { raw: rawText };
        bodyParsed = true;
      } catch {
        bodyParsed = false;
      }
    }
  }

  if (!bodyParsed) {
    return c.json({
      error: 'Unable to parse request body. Expected JSON or form data with an email field.',
      code: 'invalid_request_body',
    }, 400);
  }

  email = requestBody.email;
  consumer = requestBody.consumer;
  flow = requestBody.flow;

  c.set('requestBody', requestBody);

  if (!email || typeof email !== 'string') {
    return c.json({
      error: 'Email is required in the request body.',
      code: 'email_required',
    }, 400);
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
  const baseConfig = await getConfig(c.env.CONFIG, {
    'X-API-KEY': c.env['X-API-KEY'],
    ORIGIN_URL: c.env.ORIGIN_URL,
  });

  // Generate fingerprint
  const fingerprint = await generateFingerprint(c.req.raw);

  // Apply active A/B experiment overrides (if any)
  let config = baseConfig;
  let abAssignment: ABTestAssignment | null = null;
  if (c.env.CONFIG) {
    const abConfig = await getActiveABTestConfig(c.env.CONFIG);
    if (abConfig) {
      abAssignment = getABAssignment(fingerprint.hash, abConfig);
      config = getABVariantConfig(abAssignment.variant, abConfig, baseConfig);
      logger.info({
        event: 'ab_variant_assigned',
        experimentId: abAssignment.experimentId,
        variant: abAssignment.variant,
        bucket: abAssignment.bucket,
      }, 'Applied A/B experiment variant overrides');
    }
  }

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

  let normalizedEmailResult = emailValidation.valid ? normalizeEmail(email) : undefined;
  let sequentialResult = normalizedEmailResult ? detectSequentialPattern(normalizedEmailResult.providerNormalized) : undefined;

  // Load Markov models EARLY (before pattern detection)
  // This allows gibberish detector to use perplexity-based detection
  if (emailValidation.valid && config.features.enableMarkovChainDetection) {
    logger.info({ event: 'markov_loading', email: email.substring(0, 3) + '***' }, 'Loading Markov models');
    const modelsLoaded = await loadMarkovModels(c.env);
    logger.info({ event: 'markov_load_result', modelsLoaded, hasLegit: !!markovLegitModel, hasFraud: !!markovFraudModel }, 'Models load result');

    // FAIL-SAFE: If Markov models are required but failed to load, return 503
    // This prevents silent failures where all emails are allowed due to zero risk scores
    if (!markovLegitModel2gram || !markovFraudModel2gram) {
      logger.error({
        event: 'markov_models_missing',
        email: email.substring(0, 3) + '***',
        hasLegit2gram: !!markovLegitModel2gram,
        hasFraud2gram: !!markovFraudModel2gram,
      }, 'CRITICAL: Markov models failed to load - fraud detection unavailable');

      return c.json({
        decision: null,
        riskScore: 0,
        message: 'Service temporarily unavailable - fraud detection models not loaded',
        signals: {
          error: 'markov_models_missing',
          formatValid: emailValidation.valid,
        }
      }, 503);
    }
  }

  // Pattern analysis
  let patternFamilyResult;
  // REMOVED (2025-11-08): keyboardWalkResult, keyboardMashingResult, gibberishResult
  // These heuristic detectors had false positives (e.g., "scottpearson" flagged as mashing)
  // Markov-only detection has 83% accuracy vs 67% with heuristics

  if (emailValidation.valid && config.features.enablePatternCheck) {
    logger.info({ event: 'pattern_detection_starting' }, 'Starting pattern detection');
    // Normalize once so we can share results between detectors
    if (!normalizedEmailResult) {
      normalizedEmailResult = normalizeEmail(email);
      sequentialResult = detectSequentialPattern(normalizedEmailResult.providerNormalized);
    }

    // Extract pattern family (for signals/observability only)
    logger.info({ event: 'pattern_family_starting' }, 'Extracting pattern family');
    patternFamilyResult = await extractPatternFamily(email, normalizedEmailResult);
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
        const [rawLocalPart] = email.split('@');
        let markovLocalPart = rawLocalPart;

        if (normalizedEmailResult?.providerNormalized) {
          const [providerLocal] = normalizedEmailResult.providerNormalized.split('@');
          if (providerLocal) {
            markovLocalPart = providerLocal;
          }
        }

        logger.info({
          event: 'markov_calculating',
          localPart: markovLocalPart.substring(0, 3) + '***',
          hasEnsemble: ensembleEnabled,
        }, 'Calculating ensemble prediction');

        // Use ensemble prediction (combines 2-gram and 3-gram if available)
        markovResult = ensemblePredict(
          markovLocalPart,
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

  // Feature extraction scaffolding (populated during algorithmic scoring)
  let providerLocalPart = '';
  let localPartFeatures: LocalPartFeatureSignals = extractLocalPartFeatureSignals('');
  let localPartLength = 0;
  let digitRatio = 0;
  let sequentialConfidenceFeature = sequentialResult?.confidence ?? 0;
  let precomputedPlusRisk = 0;
  let calibrationFeatureMap: CalibrationFeatureMap | undefined;

  // Calculate risk score using early returns for priority checks
  let riskScore = 0;
  let blockReason = '';
  let classificationRisk = 0;
  let domainRisk = 0;
  let ensembleBoost = 0;
  let plusRisk = 0;
  let sequentialRisk = 0;
  let calibratedFraudProbability: number | null = null;
  let featureClassifierRisk = 0;
  let featureClassifierScore: number | null = null;

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

    const providerNormalizedEmail = normalizedEmailResult?.providerNormalized ?? email.toLowerCase();
    const [providerLocalPartRaw] = providerNormalizedEmail.split('@');
    providerLocalPart = providerLocalPartRaw || '';
    localPartFeatures = extractLocalPartFeatureSignals(providerLocalPart);
    localPartLength = localPartFeatures.statistical.length;
    digitRatio = localPartFeatures.statistical.digitRatio;
    sequentialConfidenceFeature = sequentialResult?.confidence ?? 0;
    precomputedPlusRisk = normalizedEmailResult ? getPlusAddressingRiskScore(email) : 0;

    // Always build feature map - it's used by calibration, feature classifier, and telemetry
    if (true) {
      calibrationFeatureMap = buildCalibrationFeatureMap({
        markov: {
          ceLegit2: markovResult?.crossEntropyLegit2 ?? markovResult?.crossEntropyLegit ?? 0,
          ceFraud2: markovResult?.crossEntropyFraud2 ?? markovResult?.crossEntropyFraud ?? 0,
          ceLegit3: markovResult?.crossEntropyLegit3,
          ceFraud3: markovResult?.crossEntropyFraud3,
          minEntropy: markovResult?.minEntropy,
          abnormalityRisk: markovResult?.abnormalityRisk,
        },
        sequentialConfidence: sequentialConfidenceFeature,
        plusRisk: precomputedPlusRisk,
        localPartLength,
        digitRatio,
        providerIsFree: domainValidation?.isFreeProvider,
        providerIsDisposable: domainValidation?.isDisposable,
        tldRisk: tldRiskScore,
        linguistic: {
          pronounceability: localPartFeatures.linguistic.pronounceability,
          vowelRatio: localPartFeatures.linguistic.vowelRatio,
          maxConsonantCluster: localPartFeatures.linguistic.maxConsonantCluster,
          repeatedCharRatio: localPartFeatures.linguistic.repeatedCharRatio,
          syllableEstimate: localPartFeatures.linguistic.syllableEstimate,
          impossibleClusterCount: localPartFeatures.linguistic.impossibleClusterCount,
        },
        structure: {
          hasWordBoundaries: localPartFeatures.structure.hasWordBoundaries,
          segmentCount: localPartFeatures.structure.segmentCount,
          avgSegmentLength: localPartFeatures.structure.avgSegmentLength,
          segmentsWithoutVowelsRatio: localPartFeatures.structure.segmentsWithoutVowelsRatio,
        },
        statistical: {
          uniqueCharRatio: localPartFeatures.statistical.uniqueCharRatio,
          vowelGapRatio: localPartFeatures.statistical.vowelGapRatio,
          maxDigitRun: localPartFeatures.statistical.maxDigitRun,
        },
      });
    }

    logger.info({
      event: 'calibration_check',
      hasCalibrationFeatureMap: !!calibrationFeatureMap,
      hasConfigCalibration: !!config.calibration,
      calibrationFeatureCount: config.calibration?.features?.length,
      featureMapKeys: calibrationFeatureMap ? Object.keys(calibrationFeatureMap).length : 0,
    }, 'Checking calibration availability');

    if (calibrationFeatureMap && config.calibration) {
      calibratedFraudProbability = applyCalibration(config.calibration, calibrationFeatureMap);

      if (typeof calibratedFraudProbability !== 'number' || !Number.isFinite(calibratedFraudProbability)) {
        logger.error({
          event: 'calibration_invalid_output',
          email: email.substring(0, 3) + '***',
          calibratedProb: calibratedFraudProbability,
          hasCalibration: !!config.calibration,
          hasFeatureMap: !!calibrationFeatureMap,
        }, 'CRITICAL: Calibration returned invalid value (NaN/undefined) - falling back to Markov-only');
        calibratedFraudProbability = null;
      } else {
        logger.info({
          event: 'calibration_applied',
          email: email.substring(0, 3) + '***',
          calibratedProb: calibratedFraudProbability,
          markovConf: markovResult?.confidence,
          version: config.calibration.version,
        }, 'Calibration successfully applied');
      }
    }

    if (calibrationFeatureMap && config.featureClassifier?.coefficients) {
      featureClassifierScore = applyCalibration(config.featureClassifier.coefficients, calibrationFeatureMap);
      if (typeof featureClassifierScore !== 'number' || !Number.isFinite(featureClassifierScore)) {
        logger.warn({
          event: 'feature_classifier_invalid_output',
          email: email.substring(0, 3) + '***',
          classifierScore: featureClassifierScore,
        }, 'Feature classifier returned invalid value - ignoring');
        featureClassifierScore = null;
      } else {
        logger.info({
          event: 'feature_classifier_applied',
          email: email.substring(0, 3) + '***',
          classifierScore: featureClassifierScore,
        }, 'Feature classifier applied successfully');
      }
    }

    const riskCalculation = calculateAlgorithmicRiskScore({
      email,
      markovResult,
      patternFamilyResult,
      domainReputationScore,
      tldRiskScore,
      normalizedEmailResult,
      domainValidation,
      precomputedPlusRisk,
      calibratedProbability: calibratedFraudProbability,
      localPartLength,
      featureClassifierScore,
    });
    riskScore = riskCalculation.score;
    classificationRisk = riskCalculation.classificationRisk;
    domainRisk = riskCalculation.domainRisk;
    ensembleBoost = riskCalculation.ensembleBoost;
    plusRisk = riskCalculation.plusRisk;
    sequentialRisk = riskCalculation.sequentialRisk;
    featureClassifierRisk = riskCalculation.featureClassifierRisk;

    blockReason = determineBlockReason({
      riskScore,
      email,
      markovResult,
      patternFamilyResult,
      domainReputationScore,
      tldRiskScore,
      config,
      plusRisk,
      sequentialRisk,
      featureClassifierRisk,
    });

    logger.info({
      event: 'algorithmic_scoring_complete',
      riskScore: Math.round(riskScore * 100) / 100,
      reason: blockReason,
      markovDetected: markovResult?.isLikelyFraudulent,
      markovConfidence: markovResult?.confidence,
      calibratedFraudProbability,
      featureClassifierScore,
      featureClassifierRisk: Math.round(featureClassifierRisk * 100) / 100,
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
    domainValidation: DomainValidationResult | undefined;
    precomputedPlusRisk?: number;
    calibratedProbability?: number | null;
    localPartLength?: number;
    featureClassifierScore?: number | null;
  }): {
    score: number;
    classificationRisk: number;
    domainRisk: number;
    ensembleBoost: number;
    plusRisk: number;
    sequentialRisk: number;
    featureClassifierRisk: number;
  } {
    const {
      email,
      markovResult,
      patternFamilyResult,
      domainReputationScore,
      tldRiskScore,
      normalizedEmailResult,
      domainValidation,
    precomputedPlusRisk,
    calibratedProbability,
    localPartLength = 0,
    featureClassifierScore = null,
  } = params;

    // Check if this is a professional email
    const isProfessional = isProfessionalEmail(email);

    // Primary: Two-dimensional risk from Markov models (v2.4+)
    // Dimension 1: Classification risk (fraud vs legit)
    const baseClassificationRisk = markovResult?.isLikelyFraudulent ? markovResult.confidence : 0;
    let classificationRisk = baseClassificationRisk;
    if (typeof calibratedProbability === 'number') {
      classificationRisk = Math.max(baseClassificationRisk, calibratedProbability);
    }
    if (isProfessional && classificationRisk < 0.7) {
      classificationRisk = classificationRisk * config.adjustments.professionalEmailFactor; // v2.4.2: configurable
    }

    // Dimension 2: Abnormality risk (out-of-distribution)
    let abnormalityRisk = markovResult?.abnormalityRisk || 0;
    if (isProfessional && abnormalityRisk > 0) {
      abnormalityRisk = abnormalityRisk * config.adjustments.professionalAbnormalityFactor;
    }
    abnormalityRisk = clampAbnormalityRiskForLocalLength(abnormalityRisk, localPartLength);

    // Combined risk: Take stronger signal (independent dimensions)
    let score = Math.max(classificationRisk, abnormalityRisk);

    // Secondary: Deterministic pattern overrides
    // Keep dated pattern override as it has dynamic confidence based on age analysis

    // Dated patterns use confidence from age-aware algorithm (0.2 for birth years, 0.9 for fraud)
    if (patternFamilyResult?.patternType === 'dated') {
      score = Math.max(score, patternFamilyResult?.confidence || 0.7);
    }

    // Plus-addressing abuse contributes its own deterministic signal
    let plusRisk = 0;
    if (normalizedEmailResult) {
      if (typeof precomputedPlusRisk === 'number') {
        plusRisk = precomputedPlusRisk;
      } else {
        plusRisk = getPlusAddressingRiskScore(email);
      }
      if (plusRisk > 0) {
        score = Math.max(score, plusRisk);
      }
    }

    // Sequential patterns regain deterministic weighting to avoid Markov-only reliance
    let sequentialRisk = 0;
    if (patternFamilyResult?.patternType === 'sequential') {
      const sequentialConfidence = patternFamilyResult.confidence || 0;
      const sequentialThreshold = config.patternThresholds.sequential ?? 0.6;

      if (sequentialConfidence >= sequentialThreshold) {
        sequentialRisk = Math.min(0.45 + sequentialConfidence * 0.55, 0.95);
      } else if (sequentialConfidence >= Math.max(0.4, sequentialThreshold * 0.8)) {
        sequentialRisk = sequentialConfidence * 0.5;
      }

    if (sequentialRisk > 0) {
      score = Math.max(score, sequentialRisk);
    }
  }

    let featureClassifierRisk = 0;
    if (typeof featureClassifierScore === 'number' && config.featureClassifier) {
      const weight = config.featureClassifier.riskWeight ?? 1;
      const activationThreshold = config.featureClassifier.activationThreshold ?? 0.55;
      if (featureClassifierScore >= activationThreshold) {
        featureClassifierRisk = Math.min(1, featureClassifierScore * weight);
        score = Math.max(score, featureClassifierRisk);
      }
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
      plusRisk,
      sequentialRisk,
      featureClassifierRisk,
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
    plusRisk: number;
    sequentialRisk: number;
    featureClassifierRisk: number;
  }): string {
    const {
      riskScore,
      email,
      markovResult,
      patternFamilyResult,
      domainReputationScore,
      tldRiskScore,
      config,
      plusRisk,
      sequentialRisk,
      featureClassifierRisk,
    } = params;

    // TIER 1: HIGH CONFIDENCE DETECTIONS (any risk level)
    // These are definitive fraud signals that override risk-based messaging
    // v2.6.0: Reintroduced sequential_pattern as deterministic override
    const highConfidenceReasons = [
      {
        condition: markovResult?.isLikelyFraudulent && markovResult.confidence > config.confidenceThresholds.markovFraud,
        reason: 'markov_chain_fraud'
      },
      {
        condition: markovResult?.abnormalityScore && markovResult.abnormalityScore > 1.5,
        reason: 'out_of_distribution'
      },
      {
        condition: plusRisk >= config.patternThresholds.plusAddressing,
        reason: 'plus_addressing_abuse'
      },
      {
        condition: sequentialRisk >= config.patternThresholds.sequential,
        reason: 'sequential_pattern'
      },
      {
        condition: featureClassifierRisk >= config.featureClassifier?.activationThreshold,
        reason: 'linguistic_structure_anomaly'
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
      if (patternFamilyResult?.patternType === 'sequential') return 'sequential_pattern';
      if (plusRisk >= config.patternThresholds.plusAddressing) return 'high_risk_plus_addressing';
      if (featureClassifierRisk > 0) return 'high_risk_linguistic_structure';
      return 'high_risk_multiple_signals';
    } else if (riskScore >= config.riskThresholds.warn) {
      // MEDIUM RISK (0.3-0.6): Descriptive warnings
      if (markovResult?.abnormalityRisk && markovResult.abnormalityRisk > 0.2) return 'suspicious_abnormal_pattern';
      if (patternFamilyResult?.patternType === 'dated') return 'suspicious_dated_pattern';
      if (patternFamilyResult?.patternType === 'sequential') return 'suspicious_sequential_pattern';
      if (tldRiskScore > 0.3) return 'suspicious_tld';
      if (domainReputationScore > 0.3) return 'suspicious_domain';
      if (plusRisk >= config.patternThresholds.plusAddressing * 0.8) return 'suspicious_plus_addressing';
      if (featureClassifierRisk > 0) return 'suspicious_linguistic_structure';
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
    experimentId: abAssignment?.experimentId,
    experimentVariant: abAssignment?.variant,
    latency: Date.now() - startTime,
  }, `Decision: ${decision} (score: ${riskScore.toFixed(2)}, reason: ${blockReason})`);

  // Write metrics to D1 (Analytics Engine removed in Phase 4)
  const [localPart, domain] = email.split('@');
  const tld = domain ? domain.split('.').pop() : undefined;

  // Calculate OOD zone for tracking (v2.4.1+)
  let oodZone: string | undefined;
  if (markovResult?.minEntropy !== undefined) {
    if (markovResult.minEntropy < OOD_CONSTANTS.OOD_WARN_THRESHOLD) {
      oodZone = 'none';
    } else if (markovResult.minEntropy < OOD_CONSTANTS.OOD_BLOCK_THRESHOLD) {
      oodZone = 'warn';
    } else {
      oodZone = 'block';
    }
  }

  // Extract enhanced request.cf metadata (v2.5+)
  const cf = (c.req.raw as any).cf || {};
  const headers = c.req.raw.headers;

  // Write validation metric asynchronously (ensures completion even for RPC calls)
  c.executionCtx.waitUntil(writeValidationMetric(c.env.DB, {
    decision,
    riskScore,
    entropyScore: emailValidation.signals.entropyScore,
    botScore: fingerprint.botScore,
    country: fingerprint.country,
    asn: fingerprint.asn,
    blockReason: decision === 'block' ? blockReason : undefined,
    fingerprintHash: fingerprint.hash,
    latency: Date.now() - startTime,
    experimentId: abAssignment?.experimentId,
    variant: abAssignment?.variant,
    bucket: abAssignment?.bucket,
    clientIp: fingerprint.ip,
    userAgent: fingerprint.userAgent,
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
    patternClassificationVersion: PATTERN_CLASSIFICATION_VERSION,
    // Enhanced request.cf metadata (v2.5+) - Passed from forminator via RPC headers
    // Geographic
    region: cf.region || headers.get('cf-region') || undefined,
    city: cf.city || headers.get('cf-ipcity') || undefined,
    postalCode: cf.postalCode || headers.get('cf-postal-code') || undefined,
    timezone: cf.timezone || headers.get('cf-timezone') || undefined,
    latitude: cf.latitude || headers.get('cf-iplatitude') || undefined,
    longitude: cf.longitude || headers.get('cf-iplongitude') || undefined,
    continent: cf.continent || headers.get('cf-ipcontinent') || undefined,
    isEuCountry: cf.isEUCountry || headers.get('cf-is-eu-country') || undefined,
    // Network
    asOrganization: cf.asOrganization || headers.get('cf-as-organization') || undefined,
    colo: cf.colo || headers.get('cf-colo') || undefined,
    httpProtocol: cf.httpProtocol || headers.get('cf-http-protocol') || undefined,
    tlsVersion: cf.tlsVersion || headers.get('cf-tls-version') || undefined,
    tlsCipher: cf.tlsCipher || headers.get('cf-tls-cipher') || undefined,
    // Bot Detection (Enhanced)
    clientTrustScore: cf.clientTrustScore || (headers.get('cf-client-trust-score') ? parseInt(headers.get('cf-client-trust-score')!) : undefined),
    verifiedBot: cf.botManagement?.verifiedBot || headers.get('cf-verified-bot') === 'true',
    jsDetectionPassed: (cf.botManagement as any)?.jsDetection?.passed || headers.get('cf-js-detection-passed') === 'true',
    detectionIds: (cf.botManagement as any)?.detectionIds || (() => {
      try {
        const detectionIdsHeader = headers.get('cf-detection-ids');
        return detectionIdsHeader ? JSON.parse(detectionIdsHeader) : undefined;
      } catch { return undefined; }
    })(),
    // Fingerprints (Enhanced) - JA3/JA4 already in fingerprint.ts but add signals
    ja3Hash: cf.botManagement?.ja3Hash || headers.get('cf-ja3-hash') || undefined,
    ja4: (cf.botManagement as any)?.ja4 || headers.get('cf-ja4') || undefined,
    ja4Signals: (cf.botManagement as any)?.ja4Signals || (() => {
      try {
        const ja4SignalsHeader = headers.get('cf-ja4-signals');
        return ja4SignalsHeader ? JSON.parse(ja4SignalsHeader) : undefined;
      } catch { return undefined; }
    })(),
    // RPC Metadata (v2.5.1+)
    consumer: consumer,
    flow: flow,
  }));

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
      ...(calibratedFraudProbability !== null && {
        calibratedFraudProbability: Math.round(calibratedFraudProbability * 1000) / 1000,
      }),
      ...(abAssignment && {
        experimentId: abAssignment.experimentId,
        experimentVariant: abAssignment.variant,
        experimentBucket: abAssignment.bucket,
      }),
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
        plusAddressingRisk: Math.round(plusRisk * 100) / 100,
        sequentialPatternRisk: Math.round(sequentialRisk * 100) / 100,
      }),
      ...(featureClassifierScore !== null && {
        featureClassifierScore: Math.round(featureClassifierScore * 100) / 100,
        featureClassifierRisk: Math.round(featureClassifierRisk * 100) / 100,
      }),
      linguisticSignals: {
        pronounceability: Math.round(localPartFeatures.linguistic.pronounceability * 100) / 100,
        vowelRatio: Math.round(localPartFeatures.linguistic.vowelRatio * 100) / 100,
        maxConsonantCluster: localPartFeatures.linguistic.maxConsonantCluster,
        maxRepeatedCharRun: localPartFeatures.linguistic.maxRepeatedCharRun,
        hasImpossibleCluster: localPartFeatures.linguistic.hasImpossibleCluster,
        syllableEstimate: localPartFeatures.linguistic.syllableEstimate,
      },
      structureSignals: {
        hasWordBoundaries: localPartFeatures.structure.hasWordBoundaries,
        segmentCount: localPartFeatures.structure.segmentCount,
        avgSegmentLength: Math.round(localPartFeatures.structure.avgSegmentLength * 100) / 100,
        segmentsWithoutVowelsRatio: Math.round(localPartFeatures.structure.segmentsWithoutVowelsRatio * 100) / 100,
      },
      statisticalSignals: {
        localPartLength,
        digitRatio: Math.round(localPartFeatures.statistical.digitRatio * 100) / 100,
        uniqueCharRatio: Math.round(localPartFeatures.statistical.uniqueCharRatio * 100) / 100,
        vowelGapRatio: Math.round(localPartFeatures.statistical.vowelGapRatio * 100) / 100,
        entropy: Math.round(localPartFeatures.statistical.entropy * 100) / 100,
      },
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
    if (abAssignment) {
      c.header('X-Experiment-Id', abAssignment.experimentId);
      c.header('X-Experiment-Variant', abAssignment.variant);
    }
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
    if (abAssignment) {
      response.headers.set('X-Experiment-Id', abAssignment.experimentId);
      response.headers.set('X-Experiment-Variant', abAssignment.variant);
    }

    return response;
  }

  // ALLOW or /validate endpoint: Add fraud signals to response headers for observability
  // This allows downstream routes to see the fraud check happened
  c.header('X-Fraud-Decision', decision);
  c.header('X-Fraud-Risk-Score', riskScore.toFixed(2));
  if (abAssignment) {
    c.header('X-Experiment-Id', abAssignment.experimentId);
    c.header('X-Experiment-Variant', abAssignment.variant);
  }

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

export function clampAbnormalityRiskForLocalLength(abnormalityRisk: number, localPartLength: number): number {
  if (!abnormalityRisk || !Number.isFinite(abnormalityRisk)) {
    return abnormalityRisk;
  }

  if (!localPartLength || localPartLength <= 4) {
    return 0;
  }

  const FULL_SIGNAL_LENGTH = 12;
  if (localPartLength >= FULL_SIGNAL_LENGTH) {
    return abnormalityRisk;
  }

  const ramp = (localPartLength - 4) / (FULL_SIGNAL_LENGTH - 4);
  return abnormalityRisk * Math.max(0, Math.min(1, ramp));
}
