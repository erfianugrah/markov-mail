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
	analyzeNGramNaturalness,
	getNGramRiskScore,
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
import { loadRiskHeuristics, type HeuristicRule } from '../services/risk-heuristics';
import { writeValidationMetric } from '../utils/metrics';
import { getConfig } from '../config';
import { buildFeatureVector, type FeatureVector } from '../utils/feature-vector';
import { computeIdentitySignals } from '../utils/identity-signals';
import { computeGeoSignals } from '../utils/geo-signals';
import { resolveMXRecords, getCachedMXRecords } from '../services/mx-resolver';
import { getWellKnownMX } from '../utils/known-mx-providers';
import { sendAnomalyAlert } from '../services/alerting';
import { extractLocalPartFeatureSignals, type LocalPartFeatureSignals } from '../detectors/linguistic-features';
import { logger } from '../logger';
import {
	evaluateDecisionTree,
	loadDecisionTreeModel,
	getDecisionTreeVersion,
	type DecisionTreeEvaluation,
} from '../models/decision-tree';
import {
	evaluateRandomForest,
	loadRandomForestModel,
	getRandomForestVersion,
	type RandomForestEvaluation,
} from '../models/random-forest';

const PATTERN_CLASSIFICATION_VERSION = '2.5.0';
const AB_CONFIG_CACHE_TTL = 60000; // 1 minute
const MX_LOOKUP_TIMEOUT_MS = 1500; // Increased from 350ms to 1.5s to improve MX lookup success rate

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
	const rawRequest = c.req.raw;
	const headers = rawRequest.headers;
	const cf = (rawRequest as any).cf || {};

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
	const displayName = typeof requestBody.name === 'string' ? requestBody.name : undefined;

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
		const heuristicsConfig = await loadRiskHeuristics(c.env.CONFIG);

		const fingerprint = await generateFingerprint(rawRequest);
		const geoSignals = computeGeoSignals({
			ipCountry: headers.get('cf-ipcountry') || cf.country,
			acceptLanguage: headers.get('accept-language'),
			clientTimezone: headers.get('sec-ch-ua-timezone') || headers.get('timezone') || headers.get('x-timezone'),
			edgeTimezone: cf.timezone || headers.get('cf-timezone'),
		});
		let identitySignals = computeIdentitySignals(displayName, '');

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
		let mxAnalysis = null as Awaited<ReturnType<typeof resolveMXRecords>> | null;

		if (emailValidation.valid) {
			const [, domain] = email.split('@');
			if (domain && config.features.enableDisposableCheck) {
				domainValidation = validateDomain(domain, disposableDomains);
				domainReputationScore = getDomainReputationScore(domain, disposableDomains);

				if (config.features.enableTLDRiskProfiling) {
					const tldAnalysis = analyzeTLDRisk(domain, tldRiskProfiles);
					tldRiskScore = tldAnalysis.riskScore;
				}

				if (config.features.enableMXCheck && domainValidation && !domainValidation.isDisposable) {
					// Check well-known providers first (instant lookup for Gmail, Outlook, etc.)
					const wellKnownMx = getWellKnownMX(domain);
					if (wellKnownMx) {
						mxAnalysis = wellKnownMx;
						logger.info({ event: 'mx_well_known_hit', domain }, 'Using well-known MX records');
					} else {
						// Check cache second
						const cachedMx = getCachedMXRecords(domain);
						if (cachedMx) {
							mxAnalysis = cachedMx;
						} else {
							// Fallback to DNS lookup with timeout
							const mxPromise = resolveMXRecords(domain);
							try {
								let timeoutId: ReturnType<typeof setTimeout> | undefined;
								const timeoutPromise = new Promise<null>((resolve) => {
									timeoutId = setTimeout(() => {
										timeoutId = undefined;
										resolve(null);
									}, MX_LOOKUP_TIMEOUT_MS);
								});
								const lookupResult = await Promise.race([mxPromise, timeoutPromise]);
								if (timeoutId) {
									clearTimeout(timeoutId);
								}
								if (lookupResult) {
									mxAnalysis = lookupResult;
								} else {
									logger.warn({
										event: 'mx_lookup_timeout',
										domain,
										timeoutMs: MX_LOOKUP_TIMEOUT_MS,
									}, 'MX lookup timed out, deferring to background');
									c.executionCtx.waitUntil(
										mxPromise.catch((error) => {
											logger.warn({
												event: 'mx_lookup_failed',
												domain,
												error: error instanceof Error ? error.message : String(error),
											}, 'MX lookup failed');
										})
									);
								}
							} catch (error) {
								logger.warn({
									event: 'mx_lookup_failed',
									domain,
									error: error instanceof Error ? error.message : String(error),
								}, 'MX lookup failed');
							}
						}
					}
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
		let randomForestResult: RandomForestEvaluation | null = null;
		let randomForestVersion = 'unavailable';

		let riskScore = 0;
		let blockReason = '';
		const heuristicsApplied: string[] = [];

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
			const ngramAnalysis = analyzeNGramNaturalness(providerLocalPart);
			const ngramRiskScore = getNGramRiskScore(providerLocalPart);

			identitySignals = computeIdentitySignals(displayName, providerLocalPart);

			const providerHits = mxAnalysis?.providerHits;

			featureVector = buildFeatureVector({
				sequentialConfidence,
				plusRisk,
				localPartLength,
				digitRatio,
				nameSimilarityScore: identitySignals.similarityScore,
				nameTokenOverlap: identitySignals.tokenOverlap,
				nameInEmail: identitySignals.nameInEmail,
				geoLanguageMismatch: geoSignals.languageMismatch,
				geoTimezoneMismatch: geoSignals.timezoneMismatch,
				geoAnomalyScore: geoSignals.anomalyScore,
				mxHasRecords: mxAnalysis?.hasRecords,
				mxRecordCount: mxAnalysis?.recordCount,
				mxProviderGoogle: providerHits ? providerHits.google > 0 : false,
				mxProviderMicrosoft: providerHits ? providerHits.microsoft > 0 : false,
				mxProviderIcloud: providerHits ? providerHits.icloud > 0 : false,
				mxProviderYahoo: providerHits ? providerHits.yahoo > 0 : false,
				mxProviderZoho: providerHits ? providerHits.zoho > 0 : false,
				mxProviderProton: providerHits ? providerHits.proton > 0 : false,
				mxProviderSelfHosted: providerHits ? providerHits.self_hosted > 0 : false,
				mxProviderOther: providerHits ? providerHits.other > 0 : false,
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
					bigramEntropy: localPartFeatures.statistical.bigramEntropy,
				},
				ngram: {
					bigramScore: ngramAnalysis.bigramScore,
					trigramScore: ngramAnalysis.trigramScore,
					overallScore: ngramAnalysis.overallScore,
					confidence: ngramAnalysis.confidence,
					riskScore: ngramRiskScore,
					isNatural: ngramAnalysis.isNatural,
				},
			});

			// Try Random Forest first (better high-entropy pattern detection)
			const forestLoaded = await loadRandomForestModel(c.env);
			randomForestVersion = getRandomForestVersion();

			if (forestLoaded && featureVector) {
				randomForestResult = evaluateRandomForest(featureVector);
			}

			// Fall back to Decision Tree if Random Forest unavailable
			const treeLoaded = await loadDecisionTreeModel(c.env);
			decisionTreeVersion = getDecisionTreeVersion();

			if (treeLoaded && featureVector) {
				decisionTreeResult = evaluateDecisionTree(featureVector);
			}

			// Use Random Forest score if available, otherwise Decision Tree
			if (randomForestResult) {
				riskScore = randomForestResult.score;
				blockReason = randomForestResult.reason || 'random_forest';
				logger.info({
					event: 'random_forest_result',
					reason: blockReason,
					score: Math.round(riskScore * 100) / 100,
					forestVersion: randomForestVersion,
				}, 'Random Forest evaluation complete');
			} else if (decisionTreeResult) {
				riskScore = decisionTreeResult.score;
				blockReason = decisionTreeResult.reason || 'decision_tree';
				logger.info({
					event: 'decision_tree_result',
					reason: blockReason,
					score: Math.round(riskScore * 100) / 100,
					treeVersion: decisionTreeVersion,
				}, 'Decision tree evaluation complete (forest unavailable)');
			} else {
				riskScore = 0;
				blockReason = (forestLoaded || treeLoaded) ? 'evaluation_failed' : 'model_unavailable';
				logger.warn({
					event: 'model_unavailable',
					forestVersion: randomForestVersion,
					treeVersion: decisionTreeVersion,
					forestLoaded,
					treeLoaded,
				}, 'No models available, defaulting to 0 risk');
			}
		}

		const blockThreshold = config.riskThresholds.block;
		const warnThreshold = config.riskThresholds.warn;

		const heuristicsEligible = blockReason !== 'invalid_format' && blockReason !== 'disposable_domain';
		const scoreBeforeHeuristics = riskScore;

		const elevateRisk = (target: 'warn' | 'block', reason: string, minScore?: number) => {
			const baseline = target === 'block' ? blockThreshold : warnThreshold;
			const bump = target === 'block' ? 0.05 : 0.03;
			const requestedScore = Math.min(1, minScore ?? baseline + bump);
			if (riskScore >= requestedScore) {
				return;
			}

			riskScore = requestedScore;
			heuristicsApplied.push(reason);
		};

		if (heuristicsEligible) {
			const applyRules = (value: number | undefined, rules: HeuristicRule[]) => {
				if (value === undefined || value === null || Number.isNaN(value)) {
					return;
				}
				for (const rule of rules) {
					const direction = rule.direction ?? 'gte';
					const matches = direction === 'lte' ? value <= rule.threshold : value >= rule.threshold;
					if (matches) {
						const baseline = rule.decision === 'block' ? blockThreshold : warnThreshold;
						const offset = rule.minScoreOffset ?? (rule.decision === 'block' ? 0.05 : 0.03);
						elevateRisk(rule.decision, rule.reason, baseline + offset);
						break;
					}
				}
			};

			applyRules(tldRiskScore, heuristicsConfig.tldRisk);
			applyRules(domainReputationScore, heuristicsConfig.domainReputation);
			applyRules(sequentialConfidence, heuristicsConfig.sequentialConfidence);
			applyRules(digitRatio, heuristicsConfig.digitRatio);
			applyRules(plusRisk, heuristicsConfig.plusAddressing);
			applyRules(fingerprint.botScore, heuristicsConfig.botScore);

			if (heuristicsApplied.length > 0) {
				logger.info({
					event: 'heuristic_risk_adjustment',
					heuristicsApplied,
					previousScore: Math.round(scoreBeforeHeuristics * 100) / 100,
					adjustedScore: Math.round(riskScore * 100) / 100,
				}, 'Applied heuristic risk adjustments');
			}
		}

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

		const elapsedMs = Date.now() - startTime;

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
			latency: elapsedMs,
			heuristicsApplied,
			heuristicsCount: heuristicsApplied.length,
			scoreBeforeHeuristics: Math.round(scoreBeforeHeuristics * 100) / 100,
		}, `Decision: ${decision} (score: ${riskScore.toFixed(2)}, reason: ${blockReason})`);

		const alertReasons: string[] = [];
		if (identitySignals.name && identitySignals.similarityScore < 0.2) {
			alertReasons.push('low_identity_similarity');
		}
		if (geoSignals.languageMismatch) {
			alertReasons.push('geo_language_mismatch');
		}
		if (geoSignals.timezoneMismatch) {
			alertReasons.push('geo_timezone_mismatch');
		}
		if (mxAnalysis && !mxAnalysis.hasRecords) {
			alertReasons.push('missing_mx_records');
		}

		const shouldAlert =
			c.env.ALERT_WEBHOOK_URL &&
			alertReasons.length > 0 &&
			riskScore >= config.riskThresholds.warn;

		if (shouldAlert) {
			const maskedEmail = email.replace(/^(.{3}).+(@.+)$/, (_, start, end) => `${start}***${end}`);
			c.executionCtx.waitUntil(sendAnomalyAlert(c.env, {
				email: maskedEmail,
				riskScore,
				decision,
				reasons: alertReasons,
				identitySimilarity: identitySignals.similarityScore,
				geoLanguageMismatch: geoSignals.languageMismatch,
				geoTimezoneMismatch: geoSignals.timezoneMismatch,
				mxProvider: mxAnalysis?.primaryProvider ?? null,
				timestamp: new Date().toISOString(),
			}));
		}

		const [localPart, domain] = email.split('@');
		const tld = domain ? domain.split('.').pop() : undefined;
		c.executionCtx.waitUntil(writeValidationMetric(c.env.DB, {
			decision,
			riskScore,
			entropyScore: emailValidation.signals.entropyScore,
			botScore: fingerprint.botScore,
			country: fingerprint.country,
			asn: fingerprint.asn,
			blockReason: decision === 'block' ? blockReason : undefined,
			fingerprintHash: fingerprint.hash,
			latency: elapsedMs,
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
			identitySimilarity: identitySignals.similarityScore,
			identityTokenOverlap: identitySignals.tokenOverlap,
			identityNameInEmail: identitySignals.nameInEmail,
			geoLanguageMismatch: geoSignals.languageMismatch,
			geoTimezoneMismatch: geoSignals.timezoneMismatch,
			geoAnomalyScore: geoSignals.anomalyScore,
			mxHasRecords: mxAnalysis?.hasRecords,
			mxRecordCount: mxAnalysis?.recordCount,
			mxPrimaryProvider: mxAnalysis?.primaryProvider ?? null,
			mxProviderHits: mxAnalysis?.providerHits,
			mxLookupFailure: mxAnalysis?.failure,
			mxTTL: mxAnalysis?.ttl,
			patternClassificationVersion: PATTERN_CLASSIFICATION_VERSION,
		}));

		c.set('fraudDetection', {
			decision,
			riskScore: Math.round(riskScore * 100) / 100,
			blockReason,
			valid: emailValidation.valid && (!domainValidation || !domainValidation.isDisposable),
			latencyMs: elapsedMs,
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
				identitySignals: {
					name: identitySignals.name,
					nameInEmail: identitySignals.nameInEmail,
					tokenOverlap: Math.round(identitySignals.tokenOverlap * 100) / 100,
					similarityScore: Math.round(identitySignals.similarityScore * 100) / 100,
				},
				geoSignals: {
					ipCountry: geoSignals.ipCountry,
					acceptLanguageCountry: geoSignals.acceptLanguageCountry,
					languageMismatch: geoSignals.languageMismatch,
					timezoneMismatch: geoSignals.timezoneMismatch,
					anomalyScore: Math.round(geoSignals.anomalyScore * 100) / 100,
				},
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
				mxSignals: {
					hasRecords: mxAnalysis?.hasRecords ?? false,
					recordCount: mxAnalysis?.recordCount ?? 0,
					primaryProvider: mxAnalysis?.primaryProvider ?? null,
					ttl: mxAnalysis?.ttl ?? null,
					failure: mxAnalysis?.failure,
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
				latency: elapsedMs,
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
