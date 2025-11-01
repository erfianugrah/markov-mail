import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { WorkerEntrypoint } from 'cloudflare:workers';
import { validateEmail } from './validators/email';
import { validateDomain, getDomainReputationScore } from './validators/domain';
import { generateFingerprint, extractAllSignals } from './fingerprint';
import { logValidation, logBlock, logError } from './logger';
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
	isHighRiskTLD
} from './detectors/index';
import { getConfig } from './config';
import adminRoutes from './routes/admin';

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
 * - Structured logging with Pino
 * - Metrics collection with Analytics Engine
 */

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
	const config = await getConfig(env.CONFIG, {
		ADMIN_API_KEY: env.ADMIN_API_KEY,
		ORIGIN_URL: env.ORIGIN_URL,
	});

	try {
		const body = await c.req.json<{ email?: string }>();

		if (!body.email) {
			return c.json({ error: 'Email is required' }, 400);
		}

		// Generate fingerprint
		const fingerprint = await generateFingerprint(c.req.raw);

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
			// Enhanced risk scoring with pattern analysis (Phase 6A updated)
			// Use configurable risk weights from KV configuration

			const entropyRisk = emailValidation.signals.entropyScore * config.riskWeights.entropy;
			const domainRisk = domainReputationScore * config.riskWeights.domainReputation;
			const tldRisk = tldRiskScore * config.riskWeights.tldRisk;
			const combinedPatternRisk = patternRiskScore * config.riskWeights.patternDetection;

			riskScore = Math.min(entropyRisk + domainRisk + tldRisk + combinedPatternRisk, 1.0);

			// Set block reason based on highest risk factor
			if (patternRiskScore > 0.6) {
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
			} else if (tldRisk > Math.max(domainRisk, entropyRisk)) {
				blockReason = 'high_risk_tld';
			} else if (domainRisk > entropyRisk) {
				blockReason = 'domain_reputation';
			} else {
				blockReason = 'entropy_threshold';
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

		// Write metrics to Analytics Engine
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
				console.error('Failed to forward to origin:', error);
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
export class FraudDetectionService extends WorkerEntrypoint<Env> {
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

// Export Hono app as default for HTTP (required for tests and standard HTTP usage)
// Export FraudDetectionService as named export for RPC (Service Bindings)
export default app;
