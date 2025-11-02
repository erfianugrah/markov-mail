import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { WorkerEntrypoint } from 'cloudflare:workers';
import { validateEmail } from './validators/email';
import { validateDomain, getDomainReputationScore } from './validators/domain';
import { generateFingerprint, extractAllSignals } from './fingerprint';
import { logger, logValidation, logBlock, logError } from './logger';
import { writeValidationMetric } from './utils/metrics';
import type { ValidationResult } from './types';
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
	isHighRiskTLD,
	detectMarkovPattern,
	DynamicMarkovChain,
	type MarkovResult,
	checkWhitelist,
	loadWhitelistConfig,
	type WhitelistResult
} from './detectors/index';
import { MarkovEnsembleDetector, type EnsembleResult } from './detectors/markov-ensemble';
import { getConfig } from './config';
import adminRoutes from './routes/admin';
import { scheduled as trainingWorkerScheduled } from './workers/training-worker';
import { retrainMarkovModels as retrainLegacyModels } from './training/online-learning';
import {
	loadABTestConfig,
	getAssignment,
	getVariantConfig,
	type ABTestConfig,
	type ABTestAssignment
} from './ab-testing';

/**
 * Bogus Email Pattern Recognition Worker
 *
 * Validates email addresses to prevent fake signups using:
 * - Format validation (RFC 5322)
 * - Entropy analysis (random string detection)
 * - Disposable domain detection (170+ known services)
 * - Advanced fingerprinting (IP + JA4 + Bot Score)
 * - Pattern detection (sequential, dated, plus-addressing, keyboard walks)
 * - Domain reputation scoring
 * - N-Gram analysis (gibberish detection) - Phase 6A
 * - TLD risk profiling (40+ TLD categories) - Phase 6A
 * - Markov Chain detection (Phase 7) - Dynamic character transition models
 * - Structured logging with Pino
 * - Metrics collection with Analytics Engine
 */

// Global Markov Chain model cache (loaded once per worker instance)
let markovLegitModel: DynamicMarkovChain | null = null;
let markovFraudModel: DynamicMarkovChain | null = null;
let markovModelsLoaded = false;

// Global Ensemble Markov model cache
let ensembleDetector: MarkovEnsembleDetector | null = null;
let ensembleModelsLoaded = false;

/**
 * Load Markov Chain models from KV storage
 * Models are cached globally for the lifetime of the worker instance
 * Loads from MARKOV_MODEL namespace with simple keys (MM_legit_production, MM_fraud_production)
 */
async function loadMarkovModels(env: Env): Promise<boolean> {
	if (markovModelsLoaded) return true;

	try {
		// Check if MARKOV_MODEL namespace is configured
		if (!env.MARKOV_MODEL) {
			logger.warn({
				event: 'markov_namespace_missing',
				namespace: 'MARKOV_MODEL',
			}, 'MARKOV_MODEL namespace not configured');
			return false;
		}

		// Load from MARKOV_MODEL namespace (not CONFIG)
		const legitData = await env.MARKOV_MODEL.get('MM_legit_production', 'json');
		const fraudData = await env.MARKOV_MODEL.get('MM_fraud_production', 'json');

		if (legitData && fraudData) {
			markovLegitModel = DynamicMarkovChain.fromJSON(legitData);
			markovFraudModel = DynamicMarkovChain.fromJSON(fraudData);
			markovModelsLoaded = true;
			logger.info({
				event: 'markov_models_loaded',
				model_type: 'production',
				namespace: 'MARKOV_MODEL',
				keys: ['MM_legit_production', 'MM_fraud_production'],
			}, 'Markov Chain models loaded successfully');
			return true;
		} else {
			logger.warn({
				event: 'markov_models_not_found',
				expected_keys: ['MM_legit_production', 'MM_fraud_production'],
			}, 'No production Markov models found');
		}
	} catch (error) {
		logger.error({
			event: 'markov_load_failed',
			error: error instanceof Error ? {
				message: error.message,
				stack: error.stack,
			} : String(error),
		}, 'Failed to load Markov models');
	}

	return false;
}

/**
 * Load Ensemble Markov models from KV storage
 * Loads 6 models: 1-gram, 2-gram, 3-gram × legit/fraud
 */
async function loadEnsembleModels(env: Env): Promise<boolean> {
	if (ensembleModelsLoaded) return true;

	try {
		if (!env.MARKOV_MODEL) {
			logger.warn({
				event: 'ensemble_namespace_missing',
				namespace: 'MARKOV_MODEL',
			}, 'MARKOV_MODEL namespace not configured for ensemble');
			return false;
		}

		// Load ensemble using the static method
		ensembleDetector = await MarkovEnsembleDetector.loadFromKV(env.MARKOV_MODEL);
		ensembleModelsLoaded = true;
		logger.info({
			event: 'ensemble_models_loaded',
			model_types: ['1-gram', '2-gram', '3-gram'],
			namespace: 'MARKOV_MODEL',
		}, 'Ensemble Markov models loaded successfully');
		return true;
	} catch (error) {
		logger.error({
			event: 'ensemble_load_failed',
			error: error instanceof Error ? {
				message: error.message,
				stack: error.stack,
			} : String(error),
		}, 'Failed to load ensemble models');
		return false;
	}
}

/**
 * Convert EnsembleResult to MarkovResult format for backward compatibility
 */
function ensembleToMarkovResult(ensemble: EnsembleResult): MarkovResult {
	// Use bigram model's cross-entropies as representative values
	const isLikelyFraudulent = ensemble.prediction === 'fraud';

	// For cross-entropy values, we use the individual model results
	// If fraud is predicted, fraud entropy should be lower than legit
	const crossEntropyLegit = ensemble.models.bigram.crossEntropy;
	const crossEntropyFraud = ensemble.models.bigram.crossEntropy;

	// Calculate difference ratio (similar to original)
	const minEntropy = Math.min(crossEntropyLegit, crossEntropyFraud);
	const maxEntropy = Math.max(crossEntropyLegit, crossEntropyFraud);
	const differenceRatio = minEntropy / (maxEntropy + 0.001);

	return {
		isLikelyFraudulent,
		crossEntropyLegit,
		crossEntropyFraud,
		confidence: ensemble.confidence,
		differenceRatio,
	};
}

const app = new Hono<{ Bindings: Env }>();

// Enable CORS for all routes
app.use('/*', cors());

// Mount admin routes (protected by API key)
app.route('/admin', adminRoutes);

// Root endpoint - Welcome message
app.get('/', (c) => {
	return c.text(`Bogus Email Pattern Recognition API

Endpoints:
- POST /validate { "email": "test@example.com" }
- GET /debug (shows all request signals)
- /admin/* (requires X-API-Key header)

Example:
curl -X POST https://your-worker.dev/validate \\
  -H "Content-Type: application/json" \\
  -d '{"email":"test@example.com"}'
`);
});

// Debug endpoint - Show all available fingerprinting signals
app.get('/debug', async (c) => {
	const signals = extractAllSignals(c.req.raw);
	const fingerprint = await generateFingerprint(c.req.raw);

	return c.json({
		fingerprint,
		allSignals: signals,
	});
});

// Main validation endpoint
app.post('/validate', async (c) => {
	const startTime = Date.now();
	const env = c.env;

	// Load configuration from KV (with caching)
	let config = await getConfig(env.CONFIG, {
		ADMIN_API_KEY: env.ADMIN_API_KEY,
		ORIGIN_URL: env.ORIGIN_URL,
	});

	// A/B Testing: Load experiment config and assign variant
	let abTestConfig: ABTestConfig | null = null;
	let abAssignment: ABTestAssignment | null = null;

	try {
		const body = await c.req.json<{ email?: string }>();

		if (!body.email) {
			return c.json({ error: 'Email is required' }, 400);
		}

		// Generate fingerprint
		const fingerprint = await generateFingerprint(c.req.raw);

		// A/B Testing: Check for active experiment and assign variant
		try {
			abTestConfig = await loadABTestConfig(env.CONFIG);
			if (abTestConfig) {
				abAssignment = getAssignment(fingerprint.hash, abTestConfig);
				// Merge variant-specific config overrides with base config
				config = getVariantConfig(abAssignment.variant, abTestConfig, config);

				if (config.logging.logAllValidations) {
					logger.info({
						event: 'ab_test_assignment',
						experiment_id: abTestConfig.experimentId,
						variant: abAssignment.variant,
						bucket: abAssignment.bucket,
					}, 'A/B test variant assigned');
				}
			}
		} catch (abError) {
			// Don't fail validation if A/B test loading fails
			logger.error({
				event: 'ab_test_load_failed',
				error: abError instanceof Error ? {
					message: abError.message,
					stack: abError.stack,
				} : String(abError),
			}, 'Failed to load A/B test config');
		}

		// Validate email format
		const emailValidation = validateEmail(body.email);

		// Validate domain (if format is valid)
		let domainValidation;
		let domainReputationScore = 0;
		let tldRiskScore = 0;

		if (emailValidation.valid) {
			const [, domain] = body.email.split('@');
			if (domain && config.features.enableDisposableCheck) {
				domainValidation = validateDomain(domain);
				domainReputationScore = getDomainReputationScore(domain);

				// TLD risk profiling (Phase 6A)
				if (config.features.enableTLDRiskProfiling) {
					const tldAnalysis = analyzeTLDRisk(domain);
					tldRiskScore = tldAnalysis.riskScore;
				}
			}
		}

		// Pattern analysis (if enabled and format is valid)
		let patternFamilyResult;
		let normalizedEmailResult;
		let keyboardWalkResult;
		let gibberishResult;
		let patternRiskScore = 0;

		if (emailValidation.valid && config.features.enablePatternCheck) {
			// Extract pattern family (sequential, dated, etc.)
			patternFamilyResult = await extractPatternFamily(body.email);
			patternRiskScore = getPatternRiskScore(patternFamilyResult);

			// Normalize email (plus-addressing detection)
			normalizedEmailResult = normalizeEmail(body.email);
			const plusAddressingRisk = getPlusAddressingRiskScore(body.email);

			// Keyboard walk detection
			keyboardWalkResult = detectKeyboardWalk(body.email);
			const keyboardWalkRisk = getKeyboardWalkRiskScore(keyboardWalkResult);

			// N-Gram gibberish detection (Phase 6A)
			const [localPart] = body.email.split('@');
			const ngramRisk = getNGramRiskScore(localPart);
			gibberishResult = detectGibberish(body.email);

			// Combine pattern risks
			patternRiskScore = Math.max(
				patternRiskScore,
				plusAddressingRisk,
				keyboardWalkRisk,
				ngramRisk
			);
		}

		// Markov Chain detection (Phase 7)
		let markovResult: MarkovResult | undefined;
		let markovRiskScore = 0;
		let markovDetectorType = 'none'; // 'bigram' or 'ensemble'

		if (emailValidation.valid && config.features.enableMarkovChainDetection) {
			const [localPart] = body.email.split('@');

			// A/B Test: Use ensemble for treatment variant, current 2-gram for control
			const useEnsemble = abAssignment?.variant === 'treatment';

			if (useEnsemble) {
				// Treatment: Use Ensemble Markov (1-gram + 2-gram + 3-gram)
				await loadEnsembleModels(env);

				if (ensembleDetector) {
					const ensembleResult = ensembleDetector.detect(localPart);

					// Convert to MarkovResult format for backward compatibility
					markovResult = ensembleToMarkovResult(ensembleResult);
					markovDetectorType = 'ensemble';

					// Use confidence threshold (0.7)
					if (ensembleResult.prediction === 'fraud' && ensembleResult.confidence > 0.7) {
						markovRiskScore = ensembleResult.confidence;
					}
				}
			} else {
				// Control: Use current 2-gram Markov Chain
				await loadMarkovModels(env);

				if (markovLegitModel && markovFraudModel) {
					markovResult = detectMarkovPattern(
						body.email,
						markovLegitModel,
						markovFraudModel
					);
					markovDetectorType = 'bigram';

					// Use Markov risk only if confidence is high enough (>0.7)
					// This reduces false positives from ambiguous patterns
					// Confidence threshold: 0.7 = high-confidence fraud signals only
					if (markovResult.isLikelyFraudulent && markovResult.confidence > 0.7) {
						markovRiskScore = markovResult.confidence;
					}
				}
			}
		}

		// Calculate risk score with domain and pattern signals
		let riskScore = 0;
		let blockReason = '';

		if (!emailValidation.valid) {
			riskScore = 0.8;
			blockReason = emailValidation.reason || 'invalid_format';
		} else if (domainValidation && domainValidation.isDisposable) {
			// Disposable domains are high risk
			riskScore = 0.95;
			blockReason = 'disposable_domain';
		} else if (emailValidation.signals.entropyScore > 0.7) {
			riskScore = emailValidation.signals.entropyScore;
			blockReason = 'high_entropy';
		} else {
			// Enhanced risk scoring with pattern analysis (Phase 7 updated)
			// Use configurable risk weights from KV configuration
			//
			// Scoring strategy:
			// 1. Domain signals (domain + TLD) are independent → additive
			// 2. Local part signals (entropy, pattern, markov) can overlap → use max
			//    - Prevents double-counting same fraud signal
			//    - Example: Sequential pattern detected by both pattern detector AND markov

			// Domain-based risks (independent signals)
			const domainRisk = domainReputationScore * config.riskWeights.domainReputation;
			const tldRisk = tldRiskScore * config.riskWeights.tldRisk;
			const domainBasedRisk = domainRisk + tldRisk;

			// Local part risks (overlapping signals - use max to prevent double counting)
			const entropyRisk = emailValidation.signals.entropyScore * config.riskWeights.entropy;
			const combinedPatternRisk = patternRiskScore * config.riskWeights.patternDetection;
			const markovRisk = markovRiskScore * config.riskWeights.markovChain;

			// Take max of local part signals to avoid scoring same pattern multiple times
			const localPartRisk = Math.max(entropyRisk, combinedPatternRisk, markovRisk);

			// Combine domain and local part risks
			riskScore = Math.min(domainBasedRisk + localPartRisk, 1.0);

			// Set block reason based on highest risk factor
			// Determine which signal contributed most to the final risk score

			// Check if local part risk is dominant
			if (localPartRisk > domainBasedRisk) {
				// Local part is the issue - determine which detector triggered
				if (markovRisk === localPartRisk && markovRiskScore > 0.6 && markovResult && markovResult.confidence > 0.7) {
					blockReason = 'markov_chain_fraud';
				} else if (combinedPatternRisk === localPartRisk && patternRiskScore > 0.5) {
					// Pattern detection was highest - identify specific pattern
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
				// Domain-based risk is dominant
				if (tldRisk > domainRisk) {
					blockReason = 'high_risk_tld';
				} else {
					blockReason = 'domain_reputation';
				}
			}
		}

		// Pattern Whitelisting (Priority 2 improvement)
		// Check if email matches known-good patterns and reduce risk score
		let whitelistResult: WhitelistResult | undefined;
		const originalRiskScore = riskScore;

		if (emailValidation.valid) {
			// Load whitelist configuration from KV
			const whitelistConfig = await loadWhitelistConfig(env.CONFIG);

			// Check whitelist with pattern family context
			whitelistResult = checkWhitelist(
				body.email,
				whitelistConfig,
				patternFamilyResult?.family
			);

			// Apply risk reduction if matched
			if (whitelistResult.matched && whitelistResult.riskReduction > 0) {
				const reducedRisk = riskScore * (1 - whitelistResult.riskReduction);
				riskScore = Math.max(reducedRisk, 0); // Never go negative

				if (config.logging.logAllValidations) {
					logger.info({
						event: 'whitelist_matched',
						original_risk: originalRiskScore,
						reduced_risk: riskScore,
						reduction_percent: whitelistResult.riskReduction,
						reason: whitelistResult.reason,
					}, 'Email matched whitelist');
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
			// Note: 'warn' override would escalate 'allow' to 'warn' (future feature)
		}

		const result: ValidationResult = {
			valid: emailValidation.valid && (!domainValidation || !domainValidation.isDisposable),
			riskScore: Math.round(riskScore * 100) / 100,
			signals: {
				formatValid: emailValidation.signals.formatValid,
				entropyScore: Math.round(emailValidation.signals.entropyScore * 100) / 100,
				localPartLength: emailValidation.signals.localPartLength,
				isDisposableDomain: domainValidation?.isDisposable || false,
				isFreeProvider: domainValidation?.isFreeProvider || false,
				domainReputationScore: Math.round(domainReputationScore * 100) / 100,
				// Pattern detection signals
				...(config.features.enablePatternCheck && patternFamilyResult && {
					patternFamily: patternFamilyResult.family,
					patternType: patternFamilyResult.patternType,
					patternConfidence: Math.round(patternFamilyResult.confidence * 100) / 100,
					patternRiskScore: Math.round(patternRiskScore * 100) / 100,
					normalizedEmail: normalizedEmailResult?.normalized,
					hasPlusAddressing: normalizedEmailResult?.hasPlus || false,
					hasKeyboardWalk: keyboardWalkResult?.hasKeyboardWalk || false,
					keyboardWalkType: keyboardWalkResult?.walkType,
					// Phase 6A signals
					isGibberish: gibberishResult?.isGibberish || false,
					gibberishConfidence: gibberishResult ? Math.round(gibberishResult.confidence * 100) / 100 : undefined,
					tldRiskScore: Math.round(tldRiskScore * 100) / 100,
				}),
				// Phase 7: Markov Chain signals
				...(config.features.enableMarkovChainDetection && markovResult && {
					markovDetected: markovResult.isLikelyFraudulent,
					markovConfidence: Math.round(markovResult.confidence * 100) / 100,
					markovCrossEntropyLegit: Math.round(markovResult.crossEntropyLegit * 100) / 100,
					markovCrossEntropyFraud: Math.round(markovResult.crossEntropyFraud * 100) / 100,
				}),
				// Priority 2: Whitelist signals
				...(whitelistResult && whitelistResult.matched && {
					whitelistMatched: true,
					whitelistRiskReduction: Math.round(whitelistResult.riskReduction * 100) / 100,
					whitelistReason: whitelistResult.reason,
					originalRiskScore: Math.round(originalRiskScore * 100) / 100,
				})
			},
			decision,
			message: domainValidation?.reason || emailValidation.reason || 'Email validation completed',
		};

		// Calculate latency
		const latency = Date.now() - startTime;

		// Log validation event (if enabled)
		if (config.logging.logAllValidations) {
			await logValidation({
				email: body.email,
				fingerprint: fingerprint.hash,
				riskScore: result.riskScore,
				decision: result.decision,
				signals: result.signals,
				latency,
			});
		}

		// Log blocks separately for alerting (if enabled)
		if (decision === 'block' && config.logging.logBlocks) {
			await logBlock({
				email: body.email,
				fingerprint: fingerprint.hash,
				riskScore: result.riskScore,
				reason: blockReason,
				signals: result.signals,
			});
		}

		// Write metrics to Analytics Engine (with enhanced data)
		const [localPart, domain] = body.email.split('@');
		const tld = domain ? domain.split('.').pop() : undefined;

		writeValidationMetric(env.ANALYTICS, {
			decision: result.decision,
			riskScore: result.riskScore,
			entropyScore: result.signals.entropyScore,
			botScore: fingerprint.botScore,
			country: fingerprint.country,
			asn: fingerprint.asn,
			blockReason: decision === 'block' ? blockReason : undefined,
			fingerprintHash: fingerprint.hash,
			latency,
			// Enhanced data
			emailLocalPart: localPart,
			domain: domain,
			tld: tld,
			patternType: result.signals.patternType,
			patternFamily: result.signals.patternFamily,
			isDisposable: result.signals.isDisposableDomain,
			isFreeProvider: result.signals.isFreeProvider,
			hasPlusAddressing: result.signals.hasPlusAddressing,
			hasKeyboardWalk: result.signals.hasKeyboardWalk,
			isGibberish: result.signals.isGibberish,
			tldRiskScore: result.signals.tldRiskScore,
			domainReputationScore: result.signals.domainReputationScore,
			patternConfidence: result.signals.patternConfidence,
			// Phase 7: Markov Chain data
			markovDetected: result.signals.markovDetected,
			markovConfidence: result.signals.markovConfidence,
			markovCrossEntropyLegit: result.signals.markovCrossEntropyLegit,
			markovCrossEntropyFraud: result.signals.markovCrossEntropyFraud,
			// Phase 8: Online Learning data
			clientIp: fingerprint.ip,               // For fraud pattern analysis
			userAgent: fingerprint.userAgent,       // For bot detection
			modelVersion: 'production',             // A/B testing: will be dynamic later
			excludeFromTraining: false,             // Security: will check IP reputation later
			ipReputationScore: 0,                   // Will implement IP reputation checks later
			// A/B Testing data
			experimentId: abAssignment?.experimentId,
			variant: abAssignment?.variant,
			bucket: abAssignment?.bucket,
		});

		// Build response
		const response = c.json(
			{
				...result,
				fingerprint: {
					hash: fingerprint.hash,
					country: fingerprint.country,
					asn: fingerprint.asn,
					botScore: fingerprint.botScore,
				},
				latency_ms: latency,
			},
			result.valid ? 200 : 400
		);

		// Add custom response headers if enabled
		if (config.headers.enableResponseHeaders) {
			response.headers.set('X-Risk-Score', result.riskScore.toString());
			response.headers.set('X-Fraud-Decision', result.decision);
			response.headers.set('X-Fraud-Reason', blockReason || 'none');
			response.headers.set('X-Fingerprint-Hash', fingerprint.hash);
			response.headers.set('X-Bot-Score', (fingerprint.botScore ?? 0).toString());
			response.headers.set('X-Country', fingerprint.country || 'unknown');
			response.headers.set('X-Detection-Latency-Ms', latency.toString());

			// Pattern detection headers (if available)
			if (patternFamilyResult) {
				response.headers.set('X-Pattern-Type', patternFamilyResult.patternType || 'none');
				response.headers.set('X-Pattern-Confidence', patternFamilyResult.confidence.toFixed(2));
			}
			if (gibberishResult?.isGibberish) {
				response.headers.set('X-Has-Gibberish', 'true');
			}
		}

		// Forward request to origin if configured
		if (config.headers.enableOriginHeaders && config.headers.originUrl) {
			try {
				const originHeaders = new Headers(c.req.raw.headers);

				// Add fraud detection headers to origin request
				originHeaders.set('X-Fraud-Risk-Score', result.riskScore.toString());
				originHeaders.set('X-Fraud-Decision', result.decision);
				originHeaders.set('X-Fraud-Reason', blockReason || 'none');
				originHeaders.set('X-Fraud-Fingerprint', fingerprint.hash);
				originHeaders.set('X-Fraud-Bot-Score', (fingerprint.botScore ?? 0).toString());
				originHeaders.set('X-Fraud-Country', fingerprint.country || 'unknown');
				originHeaders.set('X-Fraud-ASN', (fingerprint.asn ?? 0).toString());

				if (patternFamilyResult) {
					originHeaders.set('X-Fraud-Pattern-Type', patternFamilyResult.patternType || 'none');
					originHeaders.set('X-Fraud-Pattern-Confidence', patternFamilyResult.confidence.toFixed(2));
				}
				if (gibberishResult?.isGibberish) {
					originHeaders.set('X-Fraud-Has-Gibberish', 'true');
				}

				// Forward to origin (fire and forget - don't wait for response)
				c.executionCtx.waitUntil(
					fetch(config.headers.originUrl, {
						method: c.req.method,
						headers: originHeaders,
						body: c.req.raw.body,
					})
				);
			} catch (error) {
				// Log error but don't fail the request
				logger.error({
					event: 'origin_forward_failed',
					origin_url: config.headers.originUrl,
					error: error instanceof Error ? {
						message: error.message,
						stack: error.stack,
					} : String(error),
				}, 'Failed to forward request to origin');
			}
		}

		return response;
	} catch (error) {
		logError(error as Error, { endpoint: '/validate' });
		return c.json({ error: 'Invalid request body' }, 400);
	}
});

/**
 * RPC Entrypoint for Service Bindings
 *
 * Allows other Workers to call fraud detection directly without HTTP overhead.
 *
 * Example usage from another worker:
 *
 * // wrangler.jsonc of consuming worker:
 * {
 *   "services": [{
 *     "binding": "FRAUD_DETECTOR",
 *     "service": "bogus-email-pattern-recognition",
 *     "entrypoint": "FraudDetectionService"
 *   }]
 * }
 *
 * // In consuming worker code:
 * const result = await env.FRAUD_DETECTOR.validate({
 *   email: "user123@gmail.com",
 *   consumer: "MY_APP",
 *   flow: "SIGNUP_EMAIL_VERIFY"
 * });
 *
 * if (result.decision === 'block') {
 *   return new Response('Email rejected', { status: 400 });
 * }
 */
class FraudDetectionService extends WorkerEntrypoint<Env> {
	/**
	 * RPC method: Validate an email address for fraud patterns
	 * @param request Email validation request with optional headers for fingerprinting
	 * @returns Validation result with risk score and decision
	 */
	async validate(request: {
		email: string;
		consumer?: string;
		flow?: string;
		/**
		 * Optional: Pass original request headers to preserve fingerprinting signals.
		 * Recommended headers: 'cf-connecting-ip', 'user-agent', 'cf-ipcountry',
		 * 'cf-connecting-ipv6', 'x-real-ip', etc.
		 *
		 * Example:
		 * headers: {
		 *   'cf-connecting-ip': originalRequest.headers.get('cf-connecting-ip'),
		 *   'user-agent': originalRequest.headers.get('user-agent'),
		 *   'cf-ipcountry': originalRequest.headers.get('cf-ipcountry')
		 * }
		 */
		headers?: Record<string, string | null>;
	}): Promise<ValidationResult> {
		// Create request headers with fingerprinting data
		const requestHeaders = new Headers({
			'Content-Type': 'application/json'
		});

		// Add provided headers for fingerprinting (if any)
		if (request.headers) {
			for (const [key, value] of Object.entries(request.headers)) {
				if (value) {
					requestHeaders.set(key, value);
				}
			}
		}

		// Create HTTP request to reuse existing validation logic
		const httpRequest = new Request('http://localhost/validate', {
			method: 'POST',
			headers: requestHeaders,
			body: JSON.stringify({
				email: request.email,
				consumer: request.consumer,
				flow: request.flow
			}),
		});

		// Call the existing HTTP handler
		const response = await app.fetch(httpRequest, this.env, this.ctx);
		const result = await response.json() as ValidationResult;

		return result;
	}

	/**
	 * HTTP fetch handler (supports both HTTP and RPC)
	 */
	async fetch(request: Request): Promise<Response> {
		return app.fetch(request, this.env, this.ctx);
	}
}

// Export module with fetch handler (HTTP) and scheduled handler (Cron)
// Also export FraudDetectionService for RPC (Service Bindings)
export default {
	fetch: app.fetch.bind(app),
	scheduled: async (event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
		logger.info({
			event: 'cron_triggered',
			cron_schedule: event.cron,
		}, 'Cron trigger fired');

		logger.info({
			event: 'training_started',
			trigger_type: 'scheduled',
		}, 'Starting automated N-gram model training');

		// Use new training worker for N-gram ensemble models
		ctx.waitUntil(trainingWorkerScheduled(event, env, ctx));

		// Optional: Keep legacy training for backward compatibility
		// ctx.waitUntil(retrainLegacyModels(env));
	}
};

export { FraudDetectionService };
