/**
 * Global Fraud Detection Middleware (Decision Tree Edition)
 *
 * Runs on ALL routes by default and validates any request with an `email` field.
 * Routes can opt-out by setting: c.set('skipFraudDetection', true)
 */

import pkg from '../../package.json';
import { Context, Next } from 'hono';
import { generateFingerprint } from '../fingerprint';
import { validateEmail } from '../validators/email';
import { validateDomain, getDomainReputationScore } from '../validators/domain';
import {
	extractPatternFamily,
	normalizeEmail,
	analyzeTLDRisk,
	getPlusAddressingRiskScore,
} from '../detectors';
import { detectSequentialPattern } from '../detectors/sequential';
import {
	loadABTestConfig,
	getAssignment as getABAssignment,
	getVariantConfig as getABVariantConfig,
	type ABTestAssignment,
	type ABTestConfig,
} from '../ab-testing';
import { loadDisposableDomains } from '../services/disposable-domain-updater';
import { loadTLDRiskProfiles } from '../services/tld-risk-updater';
import { writeValidationMetric } from '../utils/metrics';
import { getConfig } from '../config';
import { buildFeatureVector, type FeatureVector } from '../utils/feature-vector';
import { extractLocalPartFeatureSignals, type LocalPartFeatureSignals } from '../detectors/linguistic-features';
import { logger } from '../logger';
import {
	evaluateDecisionTree,
	loadDecisionTreeModel,
	getDecisionTreeVersion,
	type DecisionTreeEvaluation,
} from '../models/decision-tree';

const PATTERN_CLASSIFICATION_VERSION = '2.5.0';
const AB_CONFIG_CACHE_TTL = 60000; // 1 minute

let cachedABTestConfig: ABTestConfig | null = null;
let abConfigCacheTimestamp = 0;

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

export async function fraudDetectionMiddleware(c: Context, next: Next) {
	const startTime = Date.now();

	if (c.get('skipFraudDetection') === true) {
		return next();
	}

	const path = c.req.path;
	if (
		path.startsWith('/admin') ||
		path === '/debug' ||
		path === '/' ||
		path.startsWith('/dashboard') ||
		path.startsWith('/assets') ||
		c.req.method !== 'POST'
	) {
		return next();
	}

	let requestBody: any;
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

	const email = requestBody.email;
	const consumer = requestBody.consumer;
	const flow = requestBody.flow;

	c.set('requestBody', requestBody);

	if (!email || typeof email !== 'string') {
		return c.json({
			error: 'Email is required in the request body.',
			code: 'email_required',
		}, 400);
	}

	logger.info({
		event: 'fraud_detection_started',
		email: email.substring(0, 3) + '***',
		path,
	}, 'Starting fraud detection');

	try {
		const baseConfig = await getConfig(c.env.CONFIG, {
			'X-API-KEY': c.env['X-API-KEY'],
			ORIGIN_URL: c.env.ORIGIN_URL,
		});

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

		const emailValidation = validateEmail(email);

		let disposableDomains: Set<string> | undefined;
		if (c.env.DISPOSABLE_DOMAINS_LIST && config.features.enableDisposableCheck) {
			try {
				disposableDomains = await loadDisposableDomains(c.env.DISPOSABLE_DOMAINS_LIST);
			} catch (error) {
				logger.warn({
					event: 'disposable_domains_load_failed',
					error: error instanceof Error ? error.message : String(error),
				}, 'Failed to load disposable domains, using fallback');
			}
		}

		let tldRiskProfiles: Map<string, any> | undefined;
		if (c.env.TLD_LIST && config.features.enableTLDRiskProfiling) {
			try {
				tldRiskProfiles = await loadTLDRiskProfiles(c.env.TLD_LIST);
			} catch (error) {
				logger.warn({
					event: 'tld_profiles_load_failed',
					error: error instanceof Error ? error.message : String(error),
				}, 'Failed to load TLD profiles, using fallback');
			}
		}

		let domainValidation;
		let domainReputationScore = 0;
		let tldRiskScore = 0;

		if (emailValidation.valid) {
			const [, domain] = email.split('@');
			if (domain && config.features.enableDisposableCheck) {
				domainValidation = validateDomain(domain, disposableDomains);
				domainReputationScore = getDomainReputationScore(domain, disposableDomains);

				if (config.features.enableTLDRiskProfiling) {
					const tldAnalysis = analyzeTLDRisk(domain, tldRiskProfiles);
					tldRiskScore = tldAnalysis.riskScore;
				}
			}
		}

		let normalizedEmailResult = emailValidation.valid ? normalizeEmail(email) : undefined;
		let sequentialResult = normalizedEmailResult
			? detectSequentialPattern(normalizedEmailResult.providerNormalized)
			: undefined;

		let patternFamilyResult;
		if (emailValidation.valid && config.features.enablePatternCheck) {
			if (!normalizedEmailResult) {
				normalizedEmailResult = normalizeEmail(email);
			}

			logger.info({ event: 'pattern_detection_starting' }, 'Starting pattern detection');
			patternFamilyResult = await extractPatternFamily(email, normalizedEmailResult);
			logger.info({
				event: 'pattern_detection_complete',
				patternType: patternFamilyResult?.patternType,
			}, 'Pattern detection complete');
		}

		let providerLocalPart = '';
		let localPartFeatures: LocalPartFeatureSignals = extractLocalPartFeatureSignals('');
		let localPartLength = 0;
		let digitRatio = 0;
		let sequentialConfidence = sequentialResult?.confidence ?? 0;
		let plusRisk = 0;
		let featureVector: FeatureVector | undefined;
		let decisionTreeResult: DecisionTreeEvaluation | null = null;
		let decisionTreeVersion = 'unavailable';

		let riskScore = 0;
		let blockReason = '';

		if (!emailValidation.valid) {
			riskScore = config.baseRiskScores.invalidFormat;
			blockReason = emailValidation.reason || 'invalid_format';
		} else if (domainValidation && domainValidation.isDisposable) {
			riskScore = config.baseRiskScores.disposableDomain;
			blockReason = 'disposable_domain';
		} else {
			logger.info({
				event: 'decision_tree_scoring_starting',
				email: email.substring(0, 3) + '***',
			}, 'Building feature vector for decision tree');

			const providerNormalizedEmail = normalizedEmailResult?.providerNormalized ?? email.toLowerCase();
			const [providerLocalPartRaw] = providerNormalizedEmail.split('@');
			providerLocalPart = providerLocalPartRaw || '';
			localPartFeatures = extractLocalPartFeatureSignals(providerLocalPart);
			localPartLength = localPartFeatures.statistical.length;
			digitRatio = localPartFeatures.statistical.digitRatio;
			sequentialConfidence = sequentialResult?.confidence ?? 0;
			plusRisk = normalizedEmailResult ? getPlusAddressingRiskScore(email) : 0;

			featureVector = buildFeatureVector({
				sequentialConfidence,
				plusRisk,
				localPartLength,
				digitRatio,
				providerIsFree: domainValidation?.isFreeProvider,
				providerIsDisposable: domainValidation?.isDisposable,
				tldRisk: tldRiskScore,
				domainReputationScore: domainReputationScore,
				entropyScore: emailValidation.signals.entropyScore,
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

			const modelLoaded = await loadDecisionTreeModel(c.env);
			decisionTreeVersion = getDecisionTreeVersion();

			if (modelLoaded && featureVector) {
				decisionTreeResult = evaluateDecisionTree(featureVector);
			}

			if (decisionTreeResult) {
				riskScore = decisionTreeResult.score;
				blockReason = decisionTreeResult.reason || 'decision_tree';
				logger.info({
					event: 'decision_tree_result',
					reason: blockReason,
					score: Math.round(riskScore * 100) / 100,
					treeVersion: decisionTreeVersion,
				}, 'Decision tree evaluation complete');
			} else {
				riskScore = 0;
				blockReason = modelLoaded ? 'tree_evaluation_failed' : 'model_unavailable';
				logger.warn({
					event: 'decision_tree_missing',
					treeVersion: decisionTreeVersion,
					modelLoaded,
				}, 'Decision tree unavailable, defaulting to 0 risk');
			}
		}

		const blockThreshold = config.riskThresholds.block;
		const warnThreshold = config.riskThresholds.warn;

		let decision: 'allow' | 'warn' | 'block' =
			riskScore > blockThreshold ? 'block' :
			riskScore > warnThreshold ? 'warn' :
			'allow';

		const originalDecision = decision;

		if (config.actionOverride && config.actionOverride !== originalDecision) {
			logger.info({
				event: 'decision_override_applied',
				originalDecision,
				overrideTo: config.actionOverride,
				riskScore: Math.round(riskScore * 100) / 100,
				email: email.substring(0, 3) + '***',
				reason: blockReason,
			}, `Override: ${originalDecision} → ${config.actionOverride}`);

			decision = config.actionOverride;
		}

		logger.info({
			event: 'fraud_detection_decision',
			decision,
			originalDecision,
			riskScore: Math.round(riskScore * 100) / 100,
			blockReason,
			overrideApplied: config.actionOverride ? true : false,
			override: config.actionOverride,
			email: email.substring(0, 3) + '***',
			experimentId: abAssignment?.experimentId,
			experimentVariant: abAssignment?.variant,
			latency: Date.now() - startTime,
		}, `Decision: ${decision} (score: ${riskScore.toFixed(2)}, reason: ${blockReason})`);

		const [localPart, domain] = email.split('@');
		const tld = domain ? domain.split('.').pop() : undefined;
		const cf = (c.req.raw as any).cf || {};
		const headers = c.req.raw.headers;

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
			domain,
			tld,
			patternType: patternFamilyResult?.patternType,
			patternFamily: patternFamilyResult?.family,
			isDisposable: domainValidation?.isDisposable,
			isFreeProvider: domainValidation?.isFreeProvider,
			hasPlusAddressing: normalizedEmailResult?.hasPlus,
			tldRiskScore,
			domainReputationScore,
			patternConfidence: patternFamilyResult?.confidence,
			decisionTreeReason: decisionTreeResult?.reason,
			decisionTreePath: decisionTreeResult?.path?.join(' -> '),
			modelVersion: decisionTreeVersion,
			clientTrustScore: cf.clientTrustScore || (headers.get('cf-client-trust-score') ? parseInt(headers.get('cf-client-trust-score')!) : undefined),
			region: cf.region || headers.get('cf-region') || undefined,
			city: cf.city || headers.get('cf-ipcity') || undefined,
			postalCode: cf.postalCode || headers.get('cf-postal-code') || undefined,
			timezone: cf.timezone || headers.get('cf-timezone') || undefined,
			latitude: cf.latitude || headers.get('cf-iplatitude') || undefined,
			longitude: cf.longitude || headers.get('cf-iplongitude') || undefined,
			continent: cf.continent || headers.get('cf-ipcontinent') || undefined,
			isEuCountry: cf.isEUCountry || headers.get('cf-is-eu-country') || undefined,
			asOrganization: cf.asOrganization || headers.get('cf-as-organization') || undefined,
			colo: cf.colo || headers.get('cf-colo') || undefined,
			httpProtocol: cf.httpProtocol || headers.get('cf-http-protocol') || undefined,
			tlsVersion: cf.tlsVersion || headers.get('cf-tls-version') || undefined,
			tlsCipher: cf.tlsCipher || headers.get('cf-tls-cipher') || undefined,
			verifiedBot: cf.botManagement?.verifiedBot || headers.get('cf-verified-bot') === 'true',
			jsDetectionPassed: (cf.botManagement as any)?.jsDetection?.passed || headers.get('cf-js-detection-passed') === 'true',
			detectionIds: (cf.botManagement as any)?.detectionIds || (() => {
				try {
					const detectionIdsHeader = headers.get('cf-detection-ids');
					return detectionIdsHeader ? JSON.parse(detectionIdsHeader) : undefined;
				} catch {
					return undefined;
				}
			})(),
			ja3Hash: cf.botManagement?.ja3Hash || headers.get('cf-ja3-hash') || undefined,
			ja4: (cf.botManagement as any)?.ja4 || headers.get('cf-ja4') || undefined,
			ja4Signals: (cf.botManagement as any)?.ja4Signals || (() => {
				try {
					const ja4SignalsHeader = headers.get('cf-ja4-signals');
					return ja4SignalsHeader ? JSON.parse(ja4SignalsHeader) : undefined;
				} catch {
					return undefined;
				}
			})(),
			consumer,
			flow,
			patternClassificationVersion: PATTERN_CLASSIFICATION_VERSION,
		}));

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
				patternFamily: patternFamilyResult?.family,
				patternType: patternFamilyResult?.patternType,
				patternConfidence: patternFamilyResult?.confidence,
				normalizedEmail: normalizedEmailResult?.normalized,
				hasPlusAddressing: normalizedEmailResult?.hasPlus || false,
				tldRiskScore: Math.round(tldRiskScore * 100) / 100,
				plusAddressingRisk: Math.round(plusRisk * 100) / 100,
				sequentialPatternRisk: Math.round(sequentialConfidence * 100) / 100,
				...(abAssignment && {
					experimentId: abAssignment.experimentId,
					experimentVariant: abAssignment.variant,
					experimentBucket: abAssignment.bucket,
				}),
				decisionTreeReason: decisionTreeResult?.reason,
				decisionTreePath: decisionTreeResult?.path,
				decisionTreeVersion,
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

		if (config.actionOverride === 'allow') {
			logger.info({
				event: 'fraud_detection_monitor',
				path: c.req.path,
				email: localPart.substring(0, 3) + '***@' + domain,
				decision,
				riskScore: Math.round(riskScore * 100) / 100,
				blockReason,
				latency: Date.now() - startTime,
			}, `[MONITOR] Fraud detection: ${decision} (risk: ${riskScore.toFixed(2)})`);
			if (abAssignment) {
				c.header('X-Experiment-Id', abAssignment.experimentId);
				c.header('X-Experiment-Variant', abAssignment.variant);
			}
			return next();
		}

		const isValidateEndpoint = path === '/validate';

		if (decision === 'block' && !isValidateEndpoint) {
			const response = new Response('Forbidden', { status: 403 });
			response.headers.set('X-Fraud-Decision', decision);
			response.headers.set('X-Fraud-Reason', blockReason);
			response.headers.set('X-Fraud-Risk-Score', riskScore.toFixed(2));
			response.headers.set('X-Fraud-Fingerprint', fingerprint.hash.substring(0, 16));
			if (abAssignment) {
				response.headers.set('X-Experiment-Id', abAssignment.experimentId);
				response.headers.set('X-Experiment-Variant', abAssignment.variant);
			}
			return response;
		}

		c.header('X-Fraud-Decision', decision);
		c.header('X-Fraud-Risk-Score', riskScore.toFixed(2));
		if (abAssignment) {
			c.header('X-Experiment-Id', abAssignment.experimentId);
			c.header('X-Experiment-Variant', abAssignment.variant);
		}

		return next();
	} catch (error) {
		logger.error({
			event: 'fraud_detection_error',
			error: error instanceof Error ? {
				message: error.message,
				stack: error.stack,
			} : String(error),
		}, 'Fraud detection middleware failed');

		return c.json({
			error: 'Fraud detection failed',
			message: error instanceof Error ? error.message : 'Unknown error',
		}, 500);
	}
}
