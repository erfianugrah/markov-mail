import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { WorkerEntrypoint } from 'cloudflare:workers';
import { validateEmail } from './validators/email';
import { validateDomain, getDomainReputationScore } from './validators/domain';
import { generateFingerprint, extractAllSignals } from './fingerprint';
import { logger, logValidation, logBlock, logError } from './logger';
import { writeValidationMetric } from './utils/metrics';
import type { ValidationResult, FraudDetectionResult } from './types';
import { loadDisposableDomains, updateDisposableDomains } from './services/disposable-domain-updater';
import { loadTLDRiskProfiles } from './services/tld-risk-updater';
import {
	extractPatternFamily,
	normalizeEmail,
	detectKeyboardWalk,
	detectGibberish,
	analyzeTLDRisk,
	isHighRiskTLD,
	type MarkovResult
} from './detectors/index';
import { NGramMarkovChain } from './detectors/ngram-markov';
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
import { fraudDetectionMiddleware } from './middleware/fraud-detection';

// Extend Hono context with middleware variables
type ContextVariables = {
	fraudDetection?: FraudDetectionResult;
	requestBody?: any;
	skipFraudDetection?: boolean;
};

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
let markovLegitModel: NGramMarkovChain | null = null;
let markovFraudModel: NGramMarkovChain | null = null;
let markovModelsLoaded = false;

// Global Ensemble Markov model cache
let ensembleDetector: MarkovEnsembleDetector | null = null;
let ensembleModelsLoaded = false;

/**
 * Load Markov Chain models from KV storage
 * Models are cached globally for the lifetime of the worker instance
 * Loads from MARKOV_MODEL namespace with 2-gram trained models (MM_legit_2gram, MM_fraud_2gram)
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

		// Load from MARKOV_MODEL namespace (using 2-gram trained models)
		const legitData = await env.MARKOV_MODEL.get('MM_legit_2gram', 'json');
		const fraudData = await env.MARKOV_MODEL.get('MM_fraud_2gram', 'json');

		if (legitData && fraudData) {
			markovLegitModel = NGramMarkovChain.fromJSON(legitData);
			markovFraudModel = NGramMarkovChain.fromJSON(fraudData);
			markovModelsLoaded = true;
			logger.info({
				event: 'markov_models_loaded',
				model_type: '2gram',
				namespace: 'MARKOV_MODEL',
				keys: ['MM_legit_2gram', 'MM_fraud_2gram'],
			}, 'Markov Chain models loaded successfully');
			return true;
		} else {
			logger.warn({
				event: 'markov_models_not_found',
				expected_keys: ['MM_legit_2gram', 'MM_fraud_2gram'],
			}, 'No 2-gram Markov models found');
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

const app = new Hono<{ Bindings: Env; Variables: ContextVariables }>();

// Enable CORS for all routes
app.use('/*', cors());

// 🆕 GLOBAL FRAUD DETECTION - Runs on ALL POST routes by default!
// Routes can opt-out by setting: c.set('skipFraudDetection', true)
app.use('/*', fraudDetectionMiddleware);

// Mount admin routes (protected by API key)
app.route('/admin', adminRoutes);

// Root endpoint - Welcome message
app.get('/', (c) => {
	return c.text(`Bogus Email Pattern Recognition API

🔒 Fraud Detection Status: ACTIVE on all POST routes with 'email' field

Endpoints:
- POST /* (any route with email field gets validated automatically!)
- POST /validate { "email": "test@example.com" } (backward compatible)
- GET /debug (shows all request signals)
- /admin/* (requires X-API-Key header)

Examples:
# Legacy endpoint (still works)
curl -X POST https://your-worker.dev/validate \\
  -H "Content-Type: application/json" \\
  -d '{"email":"test@example.com"}'

# New: Any POST endpoint with email gets validated
curl -X POST https://your-worker.dev/signup \\
  -H "Content-Type: application/json" \\
  -d '{"email":"user@example.com","password":"secret"}'

Monitoring Mode: Set "actionOverride": "allow" in config.json
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

// Main validation endpoint (backward compatible)
// Note: Middleware already ran validation, we just return the result
app.post('/validate', async (c) => {
	const fraud = c.get('fraudDetection');
	const body = c.get('requestBody');
	const fingerprint = await generateFingerprint(c.req.raw);

	// If no fraud detection ran (no email in body), return error
	if (!fraud) {
		return c.json({ error: 'Email is required' }, 400);
	}

	// Get model version metadata
	let modelVersion = 'unknown';
	let modelTrainingCount = 0;
	try {
		if (c.env.MARKOV_MODEL) {
			const modelData = await c.env.MARKOV_MODEL.get('MM_legit_2gram', 'json') as any;
			if (modelData?.trainingCount) {
				modelTrainingCount = modelData.trainingCount;
			}
			// Try to get versioned model info
			const versionKey = await c.env.MARKOV_MODEL.get('production_model_version', 'text');
			modelVersion = versionKey || `trained_${modelTrainingCount}`;
		}
	} catch (e) {
		// Fail silently - version metadata is non-critical
	}

	// Return validation result with version metadata
	const response = c.json({
		valid: fraud.valid,
		riskScore: fraud.riskScore,
		signals: fraud.signals,
		decision: fraud.decision,
		message: fraud.blockReason || 'Email validation completed',
		fingerprint: {
			hash: fingerprint.hash,
			country: fingerprint.country,
			asn: fingerprint.asn,
			botScore: fingerprint.botScore,
		},
		metadata: {
			version: '2.0.4',
			modelVersion,
			modelTrainingCount,
		},
	});

	// Add version headers
	response.headers.set('X-Worker-Version', '2.0.4');
	response.headers.set('X-Model-Version', modelVersion);
	response.headers.set('X-Model-Training-Count', modelTrainingCount.toString());

	return response;
});

// Example application route: /signup
// Demonstrates minimal response headers on fraud block
app.post('/signup', async (c) => {
	const body = c.get('requestBody');

	// If we got here, fraud detection passed!
	// (Middleware would have blocked if fraud was detected)
	return c.json({
		success: true,
		message: 'Signup successful',
		email: body.email
	}, 201);
});

// 🆕 EXAMPLE ROUTES - Demonstrate automatic fraud detection
// These routes show that ANY endpoint with 'email' field gets automatic validation

app.post('/signup', async (c) => {
	const fraud = c.get('fraudDetection');
	const body = c.get('requestBody');

	// Middleware already validated the email!
	// In enforcement mode, bad emails are already blocked
	// In monitoring mode, this logs but continues

	return c.json({
		success: true,
		message: 'User account created',
		userId: 'user_' + Math.random().toString(36).substr(2, 9),
		riskScore: fraud?.riskScore,
		decision: fraud?.decision,
	});
});

app.post('/newsletter', async (c) => {
	const fraud = c.get('fraudDetection');
	const body = c.get('requestBody');

	return c.json({
		success: true,
		message: 'Subscribed to newsletter',
		riskScore: fraud?.riskScore,
		decision: fraud?.decision,
	});
});

app.post('/login', async (c) => {
	const fraud = c.get('fraudDetection');
	const body = c.get('requestBody');

	return c.json({
		success: true,
		message: 'Login successful',
		riskScore: fraud?.riskScore,
		decision: fraud?.decision,
	});
});

/**
 * RPC Entrypoint for Service Bindings
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

// 🆕 CATCH-ALL ROUTE - Handle ANY POST request with email field
// MUST be LAST to not interfere with specific routes above
// This ensures fraud detection runs on ALL endpoints, even undefined ones
app.post('/*', async (c) => {
	const fraud = c.get('fraudDetection');
	const body = c.get('requestBody');

	// If fraud detection ran, return the validation result
	if (fraud) {
		return c.json({
			success: true,
			message: 'Request processed with fraud detection',
			path: c.req.path,
			riskScore: fraud.riskScore,
			decision: fraud.decision,
			blockReason: fraud.blockReason,
		});
	}

	// No email in body, return generic 404
	return c.notFound();
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

		// Task 1: Update disposable domain list from external sources
		if (env.DISPOSABLE_DOMAINS_LIST) {
			logger.info({
				event: 'disposable_domains_update_started',
				trigger_type: 'scheduled',
			}, 'Starting automated disposable domain list update');

			ctx.waitUntil(updateDisposableDomains(env.DISPOSABLE_DOMAINS_LIST));
		} else {
			logger.warn('DISPOSABLE_DOMAINS_LIST KV namespace not configured, skipping update');
		}

		// Task 2: Train N-gram ensemble models
		logger.info({
			event: 'training_started',
			trigger_type: 'scheduled',
		}, 'Starting automated N-gram model training');

		// Use direct Analytics Engine training (no KV extraction step needed)
		ctx.waitUntil(retrainLegacyModels(env));

		// Optional: Use KV-based training worker (requires manual extraction step)
		// if (env.MARKOV_MODEL) {
		// 	ctx.waitUntil(trainingWorkerScheduled(event, env as any, ctx));
		// } else {
		// 	logger.warn('MARKOV_MODEL KV namespace not configured, skipping training');
		// }
	}
};

export { FraudDetectionService };
