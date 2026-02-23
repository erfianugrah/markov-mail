import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { WorkerEntrypoint } from 'cloudflare:workers';
import { generateFingerprint, extractAllSignals } from './fingerprint';
import { logger } from './logger';
import type { ValidationResult, FraudDetectionResult } from './types';
import { updateDisposableDomains } from './services/disposable-domain-updater';
import adminRoutes from './routes/admin';
import { requireApiKey } from './middleware/auth';
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

// Enable CORS with origin restriction
app.use('/*', cors({
	origin: ['https://fraud.erfi.dev'],
	allowMethods: ['GET', 'POST', 'OPTIONS'],
	allowHeaders: ['Content-Type', 'X-API-Key', 'Authorization'],
}));

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

// Dashboard auth: cookie-based session so static assets are never exposed without auth
const DASHBOARD_COOKIE = '__dashboard_session';
const SESSION_MAX_AGE = 60 * 60 * 24; // 24 hours

async function signSession(apiKey: string, secret: string): Promise<string> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		'raw', encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
	);
	const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(apiKey));
	const expires = Date.now() + SESSION_MAX_AGE * 1000;
	const payload = btoa(String(expires));
	const sigHex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
	return `${payload}.${sigHex}`;
}

async function verifySession(cookie: string, secret: string): Promise<boolean> {
	try {
		const [payload, sigHex] = cookie.split('.');
		if (!payload || !sigHex) return false;
		const expires = Number(atob(payload));
		if (Date.now() > expires) return false;
		const encoder = new TextEncoder();
		const key = await crypto.subtle.importKey(
			'raw', encoder.encode(secret),
			{ name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
		);
		const sigBytes = new Uint8Array(sigHex.match(/.{2}/g)!.map(h => parseInt(h, 16)));
		// Verify against the API key (secret is the API key itself)
		return await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(secret));
	} catch {
		return false;
	}
}

function getCookie(req: Request, name: string): string | null {
	const header = req.headers.get('Cookie') || '';
	const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
	return match ? decodeURIComponent(match[1]) : null;
}

function loginPage(error?: string): Response {
	const errorHtml = error ? `<p style="color:#ef4444;margin-bottom:16px;font-size:14px">${error}</p>` : '';
	const html = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashboard Login</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;background:#0a0a0b;color:#e4e4e7;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#18181b;border:1px solid #27272a;border-radius:12px;padding:32px;max-width:400px;width:100%}
h1{font-size:20px;font-weight:600;margin-bottom:4px}
p.sub{color:#a1a1aa;font-size:14px;margin-bottom:24px}
label{display:block;font-size:14px;font-weight:500;margin-bottom:6px}
input{width:100%;padding:10px 12px;background:#09090b;border:1px solid #27272a;border-radius:8px;color:#e4e4e7;font-size:14px;outline:none}
input:focus{border-color:#6366f1;box-shadow:0 0 0 2px rgba(99,102,241,0.2)}
button{width:100%;margin-top:16px;padding:10px;background:#6366f1;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:500;cursor:pointer}
button:hover{background:#4f46e5}
</style>
</head>
<body>
<div class="card">
<h1>Fraud Detection Dashboard</h1>
<p class="sub">Enter your API key to continue</p>
${errorHtml}
<form method="POST" action="/dashboard/auth">
<label for="key">API Key</label>
<input type="password" id="key" name="key" placeholder="Enter your API key..." autofocus required>
<button type="submit">Sign In</button>
</form>
</div>
</body>
</html>`;
	return new Response(html, {
		status: error ? 401 : 200,
		headers: { 'Content-Type': 'text/html; charset=utf-8' },
	});
}

// Dashboard auth endpoint: validate key, set session cookie
app.post('/dashboard/auth', async (c) => {
	c.set('skipFraudDetection', true);
	const secret = c.env['X-API-KEY'];
	if (!secret) return loginPage('Dashboard authentication not configured');

	let key = '';
	const contentType = c.req.header('content-type') || '';
	if (contentType.includes('application/x-www-form-urlencoded')) {
		const body = await c.req.parseBody();
		key = String(body['key'] || '').trim();
	} else {
		const body = await c.req.json<{ key: string }>().catch(() => ({ key: '' }));
		key = String(body.key || '').trim();
	}

	if (!key) return loginPage('API key is required');

	// Timing-safe comparison
	const encoder = new TextEncoder();
	const a = encoder.encode(key);
	const b = encoder.encode(secret);
	if (a.byteLength !== b.byteLength) return loginPage('Invalid API key');

	const match = await crypto.subtle.timingSafeEqual(a, b);
	if (!match) return loginPage('Invalid API key');

	const session = await signSession(secret, secret);
	const cookie = `${DASHBOARD_COOKIE}=${encodeURIComponent(session)}; Path=/dashboard; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_MAX_AGE}`;

	return new Response(null, {
		status: 302,
		headers: {
			'Location': '/dashboard',
			'Set-Cookie': cookie,
		},
	});
});

// Dashboard logout
app.get('/dashboard/logout', (c) => {
	const cookie = `${DASHBOARD_COOKIE}=; Path=/dashboard; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
	return new Response(null, {
		status: 302,
		headers: { 'Location': '/dashboard', 'Set-Cookie': cookie },
	});
});

// Dashboard routes: require valid session cookie
async function dashboardAuth(c: AppContext): Promise<Response | undefined> {
	const secret = c.env['X-API-KEY'];
	if (!secret) return loginPage('Dashboard not configured');
	const session = getCookie(c.req.raw, DASHBOARD_COOKIE);
	if (!session || !(await verifySession(session, secret))) {
		return loginPage();
	}
	return undefined; // authenticated
}

app.get('/dashboard', async (c) => {
	const denied = await dashboardAuth(c);
	if (denied) return denied;
	return serveAsset(c, '/dashboard/index.html');
});
app.get('/dashboard/*', async (c) => {
	const denied = await dashboardAuth(c);
	if (denied) return denied;
	return serveAsset(c, c.req.path);
});
app.get('/analytics', async (c) => {
	const denied = await dashboardAuth(c);
	if (denied) return denied;
	return serveAsset(c, '/analytics.html');
});

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
  -d '{"email":"user@example.com","password":"<your-password>"}'

Monitoring Mode: Set "actionOverride": "allow" in config.json
`);
});

// Debug endpoint - Show all available fingerprinting signals (requires auth)
app.get('/debug', requireApiKey, async (c) => {
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
		userId: 'user_' + Math.random().toString(36).substring(2, 11),
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

// CATCH-ALL ROUTE - Handle ANY POST request with email field
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
