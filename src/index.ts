import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { WorkerEntrypoint } from 'cloudflare:workers';
import { generateFingerprint, extractAllSignals } from './fingerprint';
import { logger } from './logger';
import type { ValidationResult, FraudDetectionResult } from './types';
import { updateDisposableDomains } from './services/disposable-domain-updater';
import { pruneTrainingSamples } from './services/training-samples';
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

// S6 fix: in-memory rate limiter for dashboard login brute-force protection
const LOGIN_ATTEMPTS = new Map<string, { count: number; resetAt: number }>();
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 60_000; // 1 minute

function checkLoginRateLimit(ip: string): boolean {
	const now = Date.now();
	const entry = LOGIN_ATTEMPTS.get(ip);
	if (!entry || now > entry.resetAt) {
		LOGIN_ATTEMPTS.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
		return true; // allowed
	}
	entry.count++;
	if (entry.count > MAX_LOGIN_ATTEMPTS) {
		return false; // rate-limited
	}
	return true;
}

// S9 fix: derive a separate HMAC signing key from the API key so the raw
// credential is never used directly as cryptographic key material
async function deriveSigningKey(apiKey: string): Promise<string> {
	const encoder = new TextEncoder();
	const hash = await crypto.subtle.digest('SHA-256', encoder.encode('dashboard-session-key:' + apiKey));
	return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function signSession(apiKey: string, secret: string): Promise<string> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		'raw', encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
	);
	const expires = Date.now() + SESSION_MAX_AGE * 1000;
	const payload = btoa(String(expires));
	const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
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
		// Verify HMAC over the expiry payload to ensure it hasn't been tampered with
		return await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(payload));
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

	// S6 fix: rate-limit login attempts per IP
	const clientIp = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
	if (!checkLoginRateLimit(clientIp)) {
		return loginPage('Too many login attempts. Please try again in a minute.');
	}

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

	// S5 fix: hash both keys to fixed-length digests to avoid leaking key length
	const encoder = new TextEncoder();
	const [aHash, bHash] = await Promise.all([
		crypto.subtle.digest('SHA-256', encoder.encode(key)),
		crypto.subtle.digest('SHA-256', encoder.encode(secret)),
	]);
	const match = crypto.subtle.timingSafeEqual(aHash, bHash);
	if (!match) return loginPage('Invalid API key');

	// S9 fix: derive signing key from API key instead of using it directly
	const signingKey = await deriveSigningKey(secret);
	const session = await signSession(secret, signingKey);
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
	// S9 fix: verify with derived signing key
	const signingKey = await deriveSigningKey(secret);
	if (!session || !(await verifySession(session, signingKey))) {
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

// Root endpoint - API documentation page
app.get('/', (c) => {
	const h = c.req.header('host') || 'fraud.erfi.dev';
	// Accept header check: if the client wants JSON, return a machine-readable schema
	const accept = c.req.header('accept') || '';
	if (accept.includes('application/json') && !accept.includes('text/html')) {
		return c.json({
			name: 'markov-mail',
			version: pkg.version,
			description: 'Email fraud detection API powered by Random Forest classification',
			base: `https://${h}`,
			docs: `https://${h}/`,
			dashboard: `https://${h}/dashboard`,
			endpoints: {
				validation: { method: 'POST', path: '/validate', auth: 'none' },
				debug: { method: 'GET', path: '/debug', auth: 'api-key' },
				config: { method: 'GET', path: '/admin/config', auth: 'api-key' },
				analytics: { method: 'GET', path: '/admin/analytics', auth: 'api-key' },
				health: { method: 'GET', path: '/admin/health', auth: 'api-key' },
			},
		});
	}

	const E = (m: string, c: string, p: string, d: string, auth = '') =>
		`<div class="ep"><span class="m m-${m.toLowerCase()}">${m}</span><code class="p">${p}</code><span class="d">${d}</span>${auth ? `<span class="auth">${auth}</span>` : ''}</div>`;

	const S = (title: string, id: string, body: string) =>
		`<section id="${id}"><div class="sh" onclick="toggle('${id}')"><h2>${title}</h2><svg class="chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></div><div class="sb">${body}</div></section>`;

	const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Markov Mail API Reference</title>
<meta name="robots" content="noindex">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:#0c0d14;color:#b8b8c8;font-family:system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
.gl{position:fixed;inset:0;background:radial-gradient(ellipse 800px 400px at 50% 0%,rgba(99,102,241,0.06) 0%,transparent 70%);pointer-events:none}
.wrap{max-width:860px;margin:0 auto;padding:2rem 1.5rem;position:relative;z-index:1}
.hdr{display:flex;align-items:center;gap:14px;margin-bottom:.5rem}
.hdr svg{flex-shrink:0}
.bg{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:9999px;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;background:rgba(74,222,128,0.1);color:#4ade80;border:1px solid rgba(74,222,128,0.18)}
h1{font-size:1.6rem;font-weight:700;color:#f0f0f5;margin:.75rem 0 .25rem;letter-spacing:-.02em}
.sub{color:#6b6b80;font-size:.85rem;margin-bottom:1.75rem}
.sub a{color:#818cf8;text-decoration:none}.sub a:hover{text-decoration:underline}
.nav{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:1.75rem}
.nav a{padding:5px 12px;border-radius:6px;font-size:12px;font-weight:500;color:#8b8b9e;background:#16171f;border:1px solid #22232f;text-decoration:none;transition:all .15s}
.nav a:hover{color:#c8c8d0;border-color:#3a3b4a;background:#1c1d27}
section{background:#14151e;border:1px solid #22232f;border-radius:10px;margin-bottom:10px;overflow:hidden}
.sh{padding:12px 18px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;user-select:none}
.sh:hover{background:#18192280}
.sh h2{font-size:.75rem;font-weight:600;color:#d0d0d8;text-transform:uppercase;letter-spacing:.06em}
.chev{transition:transform .2s;color:#5a5a6e}
section.open .chev{transform:rotate(180deg)}
.sb{display:none;border-top:1px solid #22232f}
section.open .sb{display:block}
.ep{display:flex;align-items:center;gap:10px;padding:9px 18px;border-bottom:1px solid #1a1b24;font-size:13px;flex-wrap:wrap}
.ep:last-child{border-bottom:none}
.m{font-family:'SF Mono',Monaco,Consolas,monospace;font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;flex-shrink:0;letter-spacing:.03em}
.m-get{background:rgba(96,165,250,0.12);color:#60a5fa}
.m-post{background:rgba(74,222,128,0.12);color:#4ade80}
.m-put{background:rgba(251,191,36,0.12);color:#fbbf24}
.m-patch{background:rgba(192,132,252,0.12);color:#c084fc}
.m-delete{background:rgba(248,113,113,0.12);color:#f87171}
.p{font-family:'SF Mono',Monaco,Consolas,monospace;font-size:12.5px;color:#e0e0e8;flex-shrink:0}
.d{font-size:12px;color:#5a5a6e;margin-left:auto;text-align:right}
.auth{font-size:9px;font-weight:600;padding:2px 6px;border-radius:3px;background:rgba(251,191,36,0.1);color:#fbbf24;border:1px solid rgba(251,191,36,0.15);flex-shrink:0;text-transform:uppercase;letter-spacing:.04em}
.ex{background:#0a0b12;border:1px solid #1e1f2a;border-radius:8px;margin:12px 18px 16px;overflow-x:auto}
.ex pre{padding:14px 16px;font-family:'SF Mono',Monaco,Consolas,monospace;font-size:12px;line-height:1.7;color:#b8b8c8;margin:0;white-space:pre;tab-size:2}
.ex .lab{display:block;padding:8px 16px 0;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#5a5a6e}
.cm{color:#3e3f52}.s{color:#a5d6ff}.k{color:#c4a7e7}.n{color:#f0f0f5}.v{color:#4ade80}
.note{margin:0 18px 16px;padding:10px 14px;border-radius:6px;font-size:12px;line-height:1.6;background:rgba(99,102,241,0.06);border:1px solid rgba(99,102,241,0.12);color:#9b9bae}
.note strong{color:#c8c8d0}
.tbl{width:100%;font-size:12px;border-collapse:collapse}
.tbl th{text-align:left;padding:6px 18px;font-weight:600;color:#8b8b9e;font-size:10px;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #22232f}
.tbl td{padding:6px 18px;border-bottom:1px solid #1a1b24;color:#b8b8c8}
.tbl td code{color:#e0e0e8;font-size:11px}
.tbl tr:last-child td{border-bottom:none}
.foot{text-align:center;padding:2rem 0 1rem;font-size:11px;color:#3e3f52}
.foot a{color:#6366f1;text-decoration:none}
.foot a:hover{text-decoration:underline}
.acts{display:flex;gap:8px;margin:1rem 18px 16px;flex-wrap:wrap}
.acts a{display:inline-flex;align-items:center;gap:6px;padding:8px 18px;border-radius:7px;font-size:12px;font-weight:600;text-decoration:none;transition:all .15s;border:1px solid}
.btn-p{background:rgba(99,102,241,0.12);color:#818cf8;border-color:rgba(99,102,241,0.2)}.btn-p:hover{background:rgba(99,102,241,0.2)}
.btn-s{background:rgba(74,222,128,0.08);color:#4ade80;border-color:rgba(74,222,128,0.15)}.btn-s:hover{background:rgba(74,222,128,0.15)}
@media(max-width:640px){.d{display:none}.ep{gap:6px}}
</style>
</head>
<body>
<div class="gl"></div>
<div class="wrap">

<div class="hdr">
<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="1.6" stroke-linejoin="round"><path d="M12 2 L3 6.5 L3 12 C3 18.5 6.8 23 12 24.5 C17.2 23 21 18.5 21 12 L21 6.5 Z"/><circle cx="12" cy="11" r="2.5" fill="#6366f1"/><rect x="11" y="13" width="2" height="4" rx="0.8" fill="#6366f1"/></svg>
<span class="bg"><svg width="7" height="7" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="currentColor"/></svg>Active</span>
</div>
<h1>Markov Mail API</h1>
<p class="sub">v${pkg.version} &middot; Email fraud detection at the edge &middot; <a href="https://github.com/erfianugrah/markov-mail">GitHub</a></p>

<nav class="nav">
<a href="#validation">Validation</a>
<a href="#config">Config</a>
<a href="#analytics">Analytics</a>
<a href="#domains">Domains</a>
<a href="#tld">TLD Profiles</a>
<a href="#training">Training</a>
<a href="#cache">Cache</a>
<a href="#auth">Auth</a>
</nav>

${S('Email Validation', 'validation', `
${E('POST', 'post', '/validate', 'Score an email address')}
<div class="ex">
<span class="lab">Request</span>
<pre>curl -s -X POST https://${h}/validate \\
  -H <span class="s">"Content-Type: application/json"</span> \\
  -d <span class="s">'{"email":"user@example.com","name":"Jane Doe"}'</span></pre>
</div>
<div class="note"><strong>Request fields:</strong> <code>email</code> (required), <code>name</code> (optional — improves identity signals), <code>consumer</code> (optional), <code>flow</code> (optional)</div>
<div class="ex">
<span class="lab">Response</span>
<pre>{
  <span class="k">"valid"</span>: <span class="v">true</span>,
  <span class="k">"riskScore"</span>: <span class="n">0.12</span>,
  <span class="k">"decision"</span>: <span class="s">"allow"</span>,
  <span class="k">"signals"</span>: {
    <span class="k">"entropyScore"</span>: <span class="n">0.34</span>,
    <span class="k">"formatValid"</span>: <span class="v">true</span>,
    <span class="k">"isDisposableDomain"</span>: <span class="v">false</span>,
    <span class="k">"randomForestScore"</span>: <span class="n">0.12</span>,
    <span class="k">"patternType"</span>: <span class="s">"natural"</span>,
    <span class="k">"mxSignals"</span>: { <span class="k">"hasRecords"</span>: <span class="v">true</span>, <span class="k">"primaryProvider"</span>: <span class="s">"google"</span> }
  },
  <span class="k">"fingerprint"</span>: { <span class="k">"hash"</span>: <span class="s">"a1b2c3..."</span>, <span class="k">"country"</span>: <span class="s">"US"</span> },
  <span class="k">"latency_ms"</span>: <span class="n">8</span>
}</pre>
</div>
<div class="note"><strong>Decisions:</strong> <code>allow</code> (score &lt; 0.35), <code>warn</code> (0.35–0.64), <code>block</code> (&ge; 0.65). Blocked non-/validate POSTs return <code>403</code>.</div>
${E('POST', 'post', '/*', 'Auto-validates any POST with email field')}
${E('POST', 'post', '/signup', 'Example: signup with fraud detection')}
${E('POST', 'post', '/login', 'Example: login with fraud detection')}
${E('POST', 'post', '/newsletter', 'Example: newsletter with fraud detection')}
`)}

${S('Configuration', 'config', `
${E('GET', 'get', '/admin/config', 'Get current merged config', 'API Key')}
${E('GET', 'get', '/admin/config/defaults', 'Get default config values', 'API Key')}
${E('PUT', 'put', '/admin/config', 'Replace full config', 'API Key')}
${E('PATCH', 'patch', '/admin/config', 'Deep-merge partial config', 'API Key')}
${E('POST', 'post', '/admin/config/reset', 'Reset to defaults', 'API Key')}
${E('POST', 'post', '/admin/config/validate', 'Validate without saving', 'API Key')}
<div class="ex">
<span class="lab">Example: Update thresholds</span>
<pre>curl -X PATCH https://${h}/admin/config \\
  -H <span class="s">"X-API-Key: \$KEY"</span> -H <span class="s">"Content-Type: application/json"</span> \\
  -d <span class="s">'{"riskThresholds":{"block":0.70,"warn":0.40}}'</span></pre>
</div>
<div class="note"><strong>Config fields:</strong> <code>riskThresholds</code>, <code>baseRiskScores</code>, <code>features</code>, <code>logging</code>, <code>headers</code>, <code>actionOverride</code>, <code>riskWeights</code>, <code>rateLimiting</code>, <code>adjustments</code>, <code>ood</code></div>
`)}

${S('Analytics &amp; Data', 'analytics', `
${E('GET', 'get', '/admin/analytics?type=summary', 'Pre-built query (13 types)', 'API Key')}
${E('POST', 'post', '/admin/analytics', 'Custom SQL query', 'API Key')}
${E('GET', 'get', '/admin/analytics/queries', 'List all query types', 'API Key')}
${E('GET', 'get', '/admin/analytics/info', 'Database info &amp; guidance', 'API Key')}
${E('POST', 'post', '/admin/analytics/truncate', 'Delete old validation data', 'API Key')}
${E('DELETE', 'delete', '/admin/analytics/test-data', 'Remove test patterns', 'API Key')}
<div class="ex">
<span class="lab">Example: Query block reasons</span>
<pre>curl https://${h}/admin/analytics?type=blockReasons&hours=48 \\
  -H <span class="s">"X-API-Key: \$KEY"</span></pre>
</div>
<div class="note"><strong>Query types:</strong> summary, blockReasons, riskDistribution, topCountries, highRisk, performance, timeline, fingerprints, disposableDomains, patternFamilies, identitySignals, geoSignals, mxProviders</div>
`)}

${S('Disposable Domains', 'domains', `
${E('GET', 'get', '/admin/disposable-domains/metadata', 'Domain list stats', 'API Key')}
${E('POST', 'post', '/admin/disposable-domains/update', 'Refresh from GitHub sources', 'API Key')}
${E('DELETE', 'delete', '/admin/disposable-domains/cache', 'Clear domain cache', 'API Key')}
<div class="note"><strong>71,000+</strong> disposable email domains tracked. Auto-refreshed every 6 hours via cron.</div>
`)}

${S('TLD Risk Profiles', 'tld', `
${E('GET', 'get', '/admin/tld-profiles/metadata', 'Profile stats &amp; risk tiers', 'API Key')}
${E('GET', 'get', '/admin/tld-profiles/:tld', 'Get single TLD profile', 'API Key')}
${E('PUT', 'put', '/admin/tld-profiles/:tld', 'Update TLD risk profile', 'API Key')}
${E('POST', 'post', '/admin/tld-profiles/sync', 'Sync hardcoded profiles to KV', 'API Key')}
${E('DELETE', 'delete', '/admin/tld-profiles/cache', 'Clear TLD cache', 'API Key')}
<div class="ex">
<span class="lab">Example: Adjust TLD risk</span>
<pre>curl -X PUT https://${h}/admin/tld-profiles/xyz \\
  -H <span class="s">"X-API-Key: \$KEY"</span> -H <span class="s">"Content-Type: application/json"</span> \\
  -d <span class="s">'{"riskScore":0.8,"riskTier":"high","notes":"abuse reports"}'</span></pre>
</div>
<div class="note"><strong>Allowed fields:</strong> <code>riskScore</code> (0-1), <code>riskTier</code>, <code>category</code>, <code>notes</code>, <code>registrationVolume</code>, <code>abuseRate</code></div>
`)}

${S('Model Training', 'training', `
${E('GET', 'get', '/admin/training/dataset', 'Dataset stats (counts, labels)', 'API Key')}
${E('GET', 'get', '/admin/training/dataset/download', 'Download full training dataset', 'API Key')}
${E('DELETE', 'delete', '/admin/training/dataset', 'Prune old samples', 'API Key')}
${E('POST', 'post', '/admin/training/trigger', 'Start container retraining', 'API Key')}
${E('GET', 'get', '/admin/training/status', 'Training history &amp; status', 'API Key')}
${E('POST', 'post', '/admin/training/model', 'Upload &amp; deploy trained model', 'API Key')}
<div class="ex">
<span class="lab">Example: Trigger retraining</span>
<pre>curl -X POST https://${h}/admin/training/trigger \\
  -H <span class="s">"X-API-Key: \$KEY"</span> -H <span class="s">"Content-Type: application/json"</span> \\
  -d <span class="s">'{"nTrees":20,"maxDepth":6}'</span></pre>
</div>
<div class="note"><strong>Pipeline:</strong> Feature vectors collected from live traffic &rarr; Container trains RF model &rarr; Platt calibration &rarr; Guardrails &rarr; Auto-deploy to KV</div>
`)}

${S('Cache Management', 'cache', `
${E('DELETE', 'delete', '/admin/cache/all', 'Clear all caches', 'API Key')}
${E('DELETE', 'delete', '/admin/cache/models', 'Clear model caches only', 'API Key')}
${E('DELETE', 'delete', '/admin/cache/heuristics', 'Clear heuristics cache', 'API Key')}
${E('DELETE', 'delete', '/admin/config/cache', 'Clear config cache', 'API Key')}
<div class="note"><strong>Cache TTLs:</strong> Config 60s, Heuristics 60s, Models 5min, MX DNS 15min (10k entry LRU), TLD profiles 24h</div>
`)}

${S('Authentication &amp; System', 'auth', `
${E('GET', 'get', '/admin/health', 'Health check', 'API Key')}
${E('GET', 'get', '/debug', 'Request signals &amp; fingerprint', 'API Key')}
${E('GET', 'get', '/admin/ab-test/status', 'A/B experiment status', 'API Key')}
${E('POST', 'post', '/dashboard/auth', 'Dashboard login (rate-limited)')}
${E('GET', 'get', '/dashboard', 'Analytics dashboard', 'Session')}
<div class="note"><strong>Auth methods:</strong> <code>X-API-Key</code> header or <code>Authorization: Bearer &lt;key&gt;</code> for admin endpoints. Dashboard uses HttpOnly session cookies (24h TTL). Login rate-limited to 5 attempts/min/IP.</div>
<table class="tbl">
<tr><th>Decision</th><th>Score Range</th><th>HTTP Response</th></tr>
<tr><td><code>allow</code></td><td>&lt; 0.35</td><td>200 OK</td></tr>
<tr><td><code>warn</code></td><td>0.35 – 0.64</td><td>200 OK + headers</td></tr>
<tr><td><code>block</code></td><td>&ge; 0.65</td><td>403 Forbidden (non-/validate)</td></tr>
</table>
`)}

<div class="acts">
<a class="btn-p" href="/dashboard">Open Dashboard</a>
<a class="btn-s" href="https://github.com/erfianugrah/markov-mail">GitHub</a>
</div>

<div class="foot">Markov Mail v${pkg.version} &middot; Cloudflare Workers &middot; 48-feature RF &middot; Platt-calibrated &middot; &lt;20ms P50</div>

</div>
<script>
function toggle(id){document.getElementById(id).classList.toggle('open')}
document.querySelectorAll('section').forEach(s=>s.classList.add('open'));
</script>
</body>
</html>`;
	return new Response(html, {
		headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
	});
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
		return c.json({ error: 'ValidationError', message: 'Email is required in the request body.' }, 400);
	}

	const metadata: Record<string, any> = {
		version: pkg.version,
		modelVersion: fraud?.signals?.randomForestVersion || fraud?.signals?.decisionTreeVersion || 'unavailable',
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

		// Task 2: Weekly model retraining via container
		// Cron "0 3 * * 0" = Sunday 3AM UTC
		if (event.cron === '0 3 * * SUN') {
			if (env.TRAINER) {
				logger.info({
					event: 'training_cron_triggered',
					cron: event.cron,
				}, 'Weekly model retraining cron triggered');

				ctx.waitUntil((async () => {
					try {
						const id = env.TRAINER!.idFromName('trainer');
						const stub = env.TRAINER!.get(id);

						const res = await stub.fetch('http://container/train', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({
								workerUrl: 'https://fraud.erfi.dev',
								apiKey: env['X-API-KEY'],
								config: {
									nTrees: 10,
									maxDepth: 6,
									minSamplesLeaf: 20,
									conflictWeight: 20,
								},
							}),
						});

						const result = await res.json() as { success?: boolean };
						logger.info({
							event: 'training_cron_completed',
							result,
						}, 'Weekly model retraining completed');

						// Prune old training samples after successful training
						if (result.success && env.DB) {
							const pruned = await pruneTrainingSamples(env.DB, 14);
							logger.info({
								event: 'training_data_pruned',
								pruned,
							}, `Pruned ${pruned} old training samples`);
						}
					} catch (error) {
						logger.error({
							event: 'training_cron_error',
							error: error instanceof Error ? error.message : String(error),
						}, 'Weekly model retraining failed');
					}
				})());
			} else {
				logger.warn(
					'TRAINER container binding not configured, skipping weekly retraining'
				);
			}
		}
	}
};

// Export TrainerContainer class for Durable Object binding
export { TrainerContainer } from './container/trainer';
export { FraudDetectionService };
