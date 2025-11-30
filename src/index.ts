import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { WorkerEntrypoint } from 'cloudflare:workers';
import { generateFingerprint, extractAllSignals } from './fingerprint';
import { logger } from './logger';
import type { ValidationResult, FraudDetectionResult } from './types';
import { updateDisposableDomains } from './services/disposable-domain-updater';
import adminRoutes from './routes/admin';
import { fraudDetectionMiddleware } from './middleware/fraud-detection';
import pkg from '../package.json';

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
 * - Pattern detection (sequential, dated, plus-addressing)
 * - Domain reputation & TLD risk scoring
 * - Lightweight linguistic heuristics (n-gram analysis for telemetry)
 * - KV-backed decision tree scoring (JSON model loaded at runtime)
 * - Structured logging with Pino
 * - Metrics collection with D1 database
 */

type AppContext = Context<{ Bindings: Env; Variables: ContextVariables }>;

const app = new Hono<{ Bindings: Env; Variables: ContextVariables }>();

// Enable CORS for all routes
app.use('/*', cors());

// 🆕 GLOBAL FRAUD DETECTION - Runs on ALL POST routes by default!
// Routes can opt-out by setting: c.set('skipFraudDetection', true)
app.use('/*', fraudDetectionMiddleware);

async function serveAsset(c: AppContext, path: string) {
	if (!c.env.ASSETS) {
		return c.notFound();
	}

	const url = new URL(c.req.url);
	url.pathname = path;
	return c.env.ASSETS.fetch(new Request(url, c.req.raw));
}

// Mount admin routes (protected by API key)
app.route('/admin', adminRoutes);

app.get('/dashboard', (c) => serveAsset(c, '/dashboard/index.html'));
app.get('/dashboard/*', (c) => serveAsset(c, c.req.path));
app.get('/analytics', (c) => serveAsset(c, '/analytics.html'));

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

	const metadata: Record<string, any> = {
		version: pkg.version,
		modelVersion: fraud?.signals?.decisionTreeVersion || 'unavailable',
	};

	if (fraud?.signals?.experimentId) {
		metadata.experimentId = fraud.signals.experimentId;
		metadata.experimentVariant = fraud.signals.experimentVariant;
		metadata.experimentBucket = fraud.signals.experimentBucket;
	}

	// Return validation result with version metadata
	const response = c.json({
		valid: fraud.valid,
		riskScore: fraud.riskScore,
		signals: fraud.signals,
		decision: fraud.decision,
		message: fraud.blockReason || 'Email validation completed',
		latency_ms: fraud.latencyMs,
		latency: fraud.latencyMs,
		fingerprint: {
			hash: fingerprint.hash,
			country: fingerprint.country,
			asn: fingerprint.asn,
			botScore: fingerprint.botScore,
		},
		metadata,
	});

	// Add version headers
	response.headers.set('X-Worker-Version', pkg.version);
	response.headers.set('X-Model-Version', metadata.modelVersion);
	if (fraud?.signals?.experimentId) {
		response.headers.set('X-Experiment-Id', fraud.signals.experimentId);
		if (fraud.signals.experimentVariant) {
			response.headers.set('X-Experiment-Variant', fraud.signals.experimentVariant);
		}
	}

	return response;
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
 *     "service": "markov-mail",
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
 *     "service": "markov-mail",
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

		// Future work: trigger decision-tree dataset exports or analytics snapshots here.
	}
};

export { FraudDetectionService };
