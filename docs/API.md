# Bogus Email Pattern Recognition API

## Overview

This API provides inline email validation to prevent fake account signups by analyzing email patterns, entropy, and user fingerprints.

**Base URL:** `https://your-worker.workers.dev` (or your custom domain)

## Features

- RFC 5322 email format validation
- Shannon entropy analysis for random string detection
- Advanced fingerprinting (IP + JA4 + ASN + Bot Score)
- Configurable risk thresholds
- Structured JSON logging (Pino)
- Analytics Engine metrics collection
- Sub-100ms latency (p95)

## Authentication

**Validation Endpoints** (`/validate`, `/debug`): Open (no authentication required)

**Admin Endpoints** (`/admin/*`): Require API key authentication via `X-API-Key` header or `Authorization: Bearer` header.

Set up authentication:
```bash
# Production
wrangler secret put ADMIN_API_KEY

# Local development (.dev.vars)
ADMIN_API_KEY=your-secret-key
```

## Endpoints

### POST /validate

Validate an email address and return risk assessment.

**Request:**

```json
{
  "email": "user@example.com"
}
```

**Response (200 OK - Valid):**

```json
{
  "valid": true,
  "riskScore": 0.15,
  "signals": {
    "formatValid": true,
    "entropyScore": 0.42,
    "localPartLength": 8
  },
  "decision": "allow",
  "message": "Email validation completed",
  "fingerprint": {
    "hash": "7426dc6e4bb50d6d91948b76c024ff090553b2655a724d03f7009a33ac53d0e5",
    "country": "NL",
    "asn": 1136,
    "botScore": 99
  },
  "latency_ms": 0
}
```

**Response (400 Bad Request - Invalid):**

```json
{
  "valid": false,
  "riskScore": 0.8,
  "signals": {
    "formatValid": false,
    "entropyScore": 0,
    "localPartLength": 0
  },
  "decision": "block",
  "message": "Invalid email format",
  "fingerprint": {
    "hash": "abc123...",
    "country": "US",
    "asn": 15169,
    "botScore": 50
  },
  "latency_ms": 1
}
```

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `valid` | boolean | Whether the email passed validation |
| `riskScore` | number | Risk score from 0.0 (safe) to 1.0 (dangerous) |
| `signals` | object | Individual validation signals |
| `signals.formatValid` | boolean | RFC 5322 format compliance |
| `signals.entropyScore` | number | Shannon entropy (0-1, higher = more random) |
| `signals.localPartLength` | number | Length of local part (before @) |
| `decision` | string | `allow`, `warn`, or `block` |
| `message` | string | Human-readable result message |
| `fingerprint` | object | User fingerprint data |
| `fingerprint.hash` | string | SHA-256 hash of composite fingerprint |
| `fingerprint.country` | string | ISO 3166-1 alpha-2 country code |
| `fingerprint.asn` | number | Autonomous System Number |
| `fingerprint.botScore` | number | Cloudflare bot score (1-99, higher = more likely human) |
| `latency_ms` | number | Processing time in milliseconds |

#### Decision Logic

- **allow** (`riskScore < 0.3`): Low risk, safe to proceed
- **warn** (`0.3 ≤ riskScore < 0.6`): Medium risk, log for review
- **block** (`riskScore ≥ 0.6`): High risk, reject signup

#### Risk Score Calculation

The risk score (0.0-1.0) is calculated using a **hybrid scoring strategy** that prevents double-counting:

```typescript
// Special cases (fast-path)
if (!formatValid) {
  riskScore = 0.8;  // Invalid format
  blockReason = 'invalid_format';
} else if (isDisposableDomain) {
  riskScore = 0.95;  // Known disposable (71,751-domain list)
  blockReason = 'disposable_domain';
} else if (entropyScore > 0.7) {
  riskScore = entropyScore;  // Extreme randomness
  blockReason = 'high_entropy';
} else {
  // Normal case: Multi-signal analysis with hybrid scoring

  // Step 1: Domain signals (independent) → ADDITIVE
  const domainRisk = domainReputationScore * 0.15;  // Disposable detection
  const tldRisk = tldRiskScore * 0.15;              // TLD risk (142 TLDs)
  const domainBasedRisk = domainRisk + tldRisk;

  // Step 2: Local part signals (overlapping) → MAX-BASED
  const entropyRisk = entropyScore * 0.05;           // Randomness baseline
  const patternRisk = patternScore * 0.30;           // 5 pattern detectors
  const markovRisk = markovScore * 0.35;             // Character transitions
  const localPartRisk = Math.max(entropyRisk, patternRisk, markovRisk);

  // Step 3: Combine and clamp
  riskScore = Math.min(domainBasedRisk + localPartRisk, 1.0);
}
```

**Why Hybrid Scoring?**
- Domain + TLD check **different properties** → can both be high → add them
- Pattern + Markov check **same data** (local part) → take max to avoid double-counting

**Example**:
```
Email: user123@gmail.com

Signals:
  domainReputationScore: 0.0  (gmail whitelisted)
  tldRiskScore: 0.29          (.com is standard)
  patternScore: 0.85          (sequential pattern detected)
  markovScore: 0.78           (fraudulent transitions detected)

Calculation:
  domainBasedRisk = (0.0 * 0.15) + (0.29 * 0.15) = 0.044
  localPartRisk = max(0.85 * 0.30, 0.78 * 0.35) = max(0.255, 0.273) = 0.273
  riskScore = 0.044 + 0.273 = 0.317

Decision: WARN (0.3 <= 0.317 < 0.6)
```

**See [docs/SCORING.md](./SCORING.md) for complete scoring documentation with more examples.**

### GET /debug

Get all available request signals and fingerprint data (for testing/debugging).

**Response (200 OK):**

```json
{
  "fingerprint": {
    "hash": "7426dc6e4bb50d6d91948b76c024ff090553b2655a724d03f7009a33ac53d0e5",
    "ip": "127.0.0.1",
    "ja4": "t13d3012h2_1d37bd780c83_882d495ac381",
    "ja3": "db8a6f4f9f8195ea17db377175d2cb08",
    "userAgent": "Mozilla/5.0...",
    "country": "NL",
    "asn": 1136,
    "asOrg": "KPN B.V.",
    "botScore": 99,
    "deviceType": "desktop"
  },
  "allSignals": {
    "ip": "195.240.81.42",
    "userAgent": "Mozilla/5.0...",
    "country": "NL",
    "region": "North Brabant",
    "city": "Vught",
    "timezone": "Europe/Amsterdam",
    "botScore": "99",
    "ja4": "t13d3012h2_1d37bd780c83_882d495ac381",
    "cfData": {
      "asn": 1136,
      "asOrganization": "KPN B.V.",
      "colo": "AMS",
      "httpProtocol": "HTTP/2",
      "tlsVersion": "TLSv1.3",
      "botManagement": {
        "score": 99,
        "ja4Signals": {
          "h2h3_ratio_1h": 0.997,
          "browser_ratio_1h": 0.045,
          "reqs_rank_1h": 246
        }
      }
    }
  }
}
```

### GET /

Get API welcome message and usage instructions.

**Response (200 OK):**

```text
Bogus Email Pattern Recognition API

Endpoints:
- POST /validate { "email": "test@example.com" }
- GET /debug (shows all request signals)

Example:
curl -X POST https://your-worker.dev/validate \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'
```

## RPC Integration (Service Bindings)

For Workers-to-Workers communication, you can use Cloudflare's RPC system instead of HTTP. This provides:
- **Lower latency** - No HTTP overhead, direct JavaScript function calls
- **Type safety** - TypeScript types preserved across Workers
- **Simpler code** - No need to serialize/deserialize JSON
- **Promise pipelining** - Multiple RPC calls can be batched

### Setup

#### 1. Configure the Consuming Worker

In your consuming worker's `wrangler.jsonc`, add a service binding:

```jsonc
{
  "name": "my-app",
  "services": [{
    "binding": "FRAUD_DETECTOR",
    "service": "bogus-email-pattern-recognition",
    "entrypoint": "FraudDetectionService"
  }]
}
```

#### 2. Add TypeScript Types

In your consuming worker's types file:

```typescript
interface Env {
  FRAUD_DETECTOR: {
    validate(request: {
      email: string;
      consumer?: string;
      flow?: string;
    }): Promise<{
      valid: boolean;
      riskScore: number;
      decision: 'allow' | 'warn' | 'block';
      signals: Record<string, any>;
      message: string;
    }>;
  };
}
```

### Usage Examples

#### Basic Validation (without fingerprinting)

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { email } = await request.json();

    // Call fraud detection via RPC
    const result = await env.FRAUD_DETECTOR.validate({
      email: email,
      consumer: "MY_APP",
      flow: "SIGNUP_EMAIL_VERIFY"
    });

    if (result.decision === 'block') {
      return new Response('Email rejected due to fraud risk', {
        status: 400
      });
    }

    // Continue with signup...
    return new Response('Email accepted', { status: 200 });
  }
};
```

#### With Fingerprinting (Recommended)

Pass original request headers to preserve IP, User-Agent, and Cloudflare signals:

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { email } = await request.json();

    // Call fraud detection via RPC with original headers for fingerprinting
    const result = await env.FRAUD_DETECTOR.validate({
      email: email,
      consumer: "MY_APP",
      flow: "SIGNUP_EMAIL_VERIFY",
      headers: {
        'cf-connecting-ip': request.headers.get('cf-connecting-ip'),
        'user-agent': request.headers.get('user-agent'),
        'cf-ipcountry': request.headers.get('cf-ipcountry'),
        'cf-ray': request.headers.get('cf-ray'),
        'x-real-ip': request.headers.get('x-real-ip')
      }
    });

    if (result.decision === 'block') {
      return new Response(
        JSON.stringify({
          error: 'Email rejected',
          riskScore: result.riskScore,
          fingerprint: result.fingerprint?.hash
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Continue with signup...
    return new Response('Email accepted', { status: 200 });
  }
};
```

#### With Error Handling

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { email } = await request.json();

    try {
      const result = await env.FRAUD_DETECTOR.validate({
        email: email,
        consumer: "MY_APP",
        flow: "SIGNUP_EMAIL_VERIFY"
      });

      // Check decision
      switch (result.decision) {
        case 'block':
          return new Response(
            JSON.stringify({
              error: 'Email rejected',
              reason: result.message,
              riskScore: result.riskScore
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );

        case 'warn':
          // Log warning but allow - could trigger additional verification
          console.warn('High-risk email:', {
            email: email,
            riskScore: result.riskScore,
            signals: result.signals
          });
          break;

        case 'allow':
          // Normal flow
          break;
      }

      // Continue with registration
      return new Response('Success', { status: 200 });

    } catch (error) {
      // Handle RPC errors gracefully
      console.error('Fraud detection RPC error:', error);
      // Decide: fail open (allow) or fail closed (block)
      return new Response('Service temporarily unavailable', {
        status: 503
      });
    }
  }
};
```

#### Batch Validation

```typescript
// Validate multiple emails in parallel
async function validateBatch(
  emails: string[],
  env: Env
): Promise<Map<string, boolean>> {
  const results = await Promise.all(
    emails.map(email =>
      env.FRAUD_DETECTOR.validate({
        email: email,
        consumer: "BATCH_IMPORTER",
        flow: "BULK_IMPORT"
      })
    )
  );

  return new Map(
    emails.map((email, i) => [
      email,
      results[i].decision !== 'block'
    ])
  );
}
```

#### Using Additional Signals

```typescript
const result = await env.FRAUD_DETECTOR.validate({
  email: "user@example.com",
  consumer: "MY_APP",
  flow: "SIGNUP_EMAIL_VERIFY"
});

// Access detailed signals for custom logic
if (result.signals.markovDetected) {
  console.log('Detected fraud via Markov Chain:', result.signals.markovConfidence);
}

if (result.signals.patternType === 'sequential') {
  console.log('Detected sequential pattern');
}

if (result.signals.patternType === 'dated') {
  console.log('Detected dated pattern with confidence:', result.signals.patternConfidence);
}

// Custom risk scoring
const customRisk =
  result.riskScore * 0.7 +           // Base risk
  (result.signals.isDisposableDomain ? 0.3 : 0) + // Add disposable penalty
  (result.signals.entropyScore > 0.6 ? 0.2 : 0);  // Add entropy penalty
```

### Performance Benefits

**HTTP vs RPC Latency Comparison:**

| Method | Avg Latency | p95 Latency | Overhead |
|--------|-------------|-------------|----------|
| HTTP (same region) | ~15-25ms | ~35ms | JSON serialization + HTTP headers |
| RPC (Service Binding) | ~2-5ms | ~8ms | Direct function call |

**Use RPC when:**
- Calling from another Cloudflare Worker
- Need lowest latency possible
- Want type safety across services
- Making many validation calls per request

**Use HTTP when:**
- Calling from external services
- Need to use curl/Postman for testing
- Integrating with non-Worker systems

### Limitations

- **RPC only works between Cloudflare Workers** - Cannot be called from external services
- **Same Cloudflare account** - Workers must be in the same account
- **Headers must be passed manually** - Unlike HTTP, you must explicitly pass headers for fingerprinting (see examples above)
- **Compatibility date** - Requires `compatibility_date >= 2024-04-03`

### RPC vs HTTP Decision Matrix

| Requirement | Recommended Method |
|-------------|-------------------|
| Lowest latency | RPC (with headers) |
| External integration | HTTP |
| Type safety | RPC |
| Testing with curl | HTTP |
| Batch validation | RPC (parallel) |
| Fingerprinting signals | Both (pass headers in RPC) |
| Cross-account | HTTP |
| Simple integration | HTTP |

## Admin API

Manage worker configuration at runtime without redeployment.

**Authentication:** Requires `ADMIN_API_KEY` secret set via `X-API-Key` or `Authorization: Bearer` header.

### GET /admin/health

Health check endpoint for the admin API.

**Request:**
```bash
curl https://your-worker.dev/admin/health \
  -H "X-API-Key: your-admin-api-key"
```

**Response (200 OK):**
```json
{
  "status": "healthy",
  "adminApiEnabled": true,
  "timestamp": 1730368439603
}
```

### GET /admin/config

Get current active configuration (merged defaults + KV + secrets).

**Request:**
```bash
curl https://your-worker.dev/admin/config \
  -H "X-API-Key: your-admin-api-key"
```

**Response (200 OK):**
```json
{
  "config": {
    "riskThresholds": {"block": 0.6, "warn": 0.3},
    "features": {...},
    "logging": {...},
    "headers": {...},
    "actionOverride": "allow",
    "riskWeights": {...},
    "patternThresholds": {...},
    "rateLimiting": {...},
    "admin": {"enabled": true}
  },
  "source": {
    "defaults": {...},
    "cached": true
  }
}
```

### PUT /admin/config

Update full configuration (replaces entire KV config). Must include all required fields.

**Request:**
```bash
curl -X PUT https://your-worker.dev/admin/config \
  -H "X-API-Key: your-admin-api-key" \
  -H "Content-Type: application/json" \
  -d @examples/config.json
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Configuration updated successfully",
  "config": {...}
}
```

**Response (400 Bad Request):**
```json
{
  "error": "Invalid configuration",
  "errors": [
    "riskWeights must sum to 1.0 (currently 0.90)"
  ]
}
```

### POST /admin/config/validate

Validate configuration without saving.

**Request:**
```bash
curl -X POST https://your-worker.dev/admin/config/validate \
  -H "X-API-Key: your-admin-api-key" \
  -H "Content-Type: application/json" \
  -d '{"riskThresholds": {"block": 0.7, "warn": 0.4}}'
```

**Response (200 OK):**
```json
{
  "valid": true,
  "message": "Configuration is valid"
}
```

### POST /admin/config/reset

Reset configuration to defaults (clears KV storage).

**Request:**
```bash
curl -X POST https://your-worker.dev/admin/config/reset \
  -H "X-API-Key: your-admin-api-key"
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Configuration reset to defaults",
  "defaults": {...}
}
```

### DELETE /admin/config/cache

Clear in-memory configuration cache (forces reload from KV).

**Request:**
```bash
curl -X DELETE https://your-worker.dev/admin/config/cache \
  -H "X-API-Key: your-admin-api-key"
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Configuration cache cleared"
}
```

### Admin API Error Responses

**401 Unauthorized:**
```json
{
  "error": "Unauthorized",
  "message": "API key required. Provide via X-API-Key or Authorization header"
}
```

**503 Service Unavailable:**
```json
{
  "error": "Admin API is not enabled",
  "message": "Set ADMIN_API_KEY secret to enable admin endpoints"
}
```

**See [docs/CONFIGURATION.md](CONFIGURATION.md) for complete Admin API documentation, examples, and configuration options.**

## Custom Headers

The API supports custom headers for easier integration with downstream systems, CDN logs, WAFs, and monitoring tools.

### Response Headers (Worker → Client)

When `ENABLE_RESPONSE_HEADERS` is set to `"true"`, the following headers are added to responses:

#### Core Decision Headers

| Header | Type | Description | Example |
|--------|------|-------------|---------|
| `X-Risk-Score` | number | Overall risk score (0.0-1.0) | `0.48` |
| `X-Fraud-Decision` | string | Decision: allow, warn, or block | `warn` |
| `X-Fraud-Reason` | string | Primary reason for the decision | `sequential_pattern` |

#### Fingerprinting Headers

| Header | Type | Description | Example |
|--------|------|-------------|---------|
| `X-Fingerprint-Hash` | string | SHA-256 composite fingerprint | `7426dc6e...` |
| `X-Bot-Score` | number | Bot detection score (0-100) | `99` |
| `X-Country` | string | ISO 3166-1 alpha-2 country code | `US` |

#### Performance Headers

| Header | Type | Description | Example |
|--------|------|-------------|---------|
| `X-Detection-Latency-Ms` | number | Processing time in milliseconds | `3` |

#### Pattern Detection Headers (when applicable)

| Header | Type | Description | Example |
|--------|------|-------------|---------|
| `X-Pattern-Type` | string | Detected pattern type | `sequential`, `dated`, `random` |
| `X-Pattern-Confidence` | number | Pattern confidence (0.0-1.0) | `0.85` |
| `X-Markov-Detected` | boolean | Markov fraud detection (only if true) | `true` |
| `X-Markov-Confidence` | number | Markov detection confidence (0.0-1.0) | `0.92` |

**Example Response with Headers:**

```bash
curl -i -X POST http://localhost:8787/validate \
  -H "Content-Type: application/json" \
  -d '{"email":"user123@outlook.com"}'
```

```
HTTP/1.1 200 OK
Content-Type: application/json
X-Risk-Score: 0.48
X-Fraud-Decision: warn
X-Fraud-Reason: dated_pattern
X-Fingerprint-Hash: 7426dc6e4bb50d6d91948b76c024ff090553b2655a724d03f7009a33ac53d0e5
X-Bot-Score: 99
X-Country: NL
X-Detection-Latency-Ms: 3
X-Pattern-Type: dated
X-Pattern-Confidence: 0.60
```

### Origin Request Headers (Worker → Backend)

When `ENABLE_ORIGIN_HEADERS` is set to `"true"` and `ORIGIN_URL` is configured, the Worker forwards validation requests to your backend with enriched fraud detection headers.

#### Configuration

```jsonc
{
  "vars": {
    "ENABLE_ORIGIN_HEADERS": "true",
    "ORIGIN_URL": "https://api.yourbackend.com/fraud-check"
  }
}
```

#### Headers Sent to Origin

All original request headers are preserved, plus the following fraud detection headers:

| Header | Type | Description | Example |
|--------|------|-------------|---------|
| `X-Fraud-Risk-Score` | number | Overall risk score | `0.48` |
| `X-Fraud-Decision` | string | allow, warn, or block | `warn` |
| `X-Fraud-Reason` | string | Primary fraud indicator | `sequential_pattern` |
| `X-Fraud-Fingerprint` | string | SHA-256 fingerprint hash | `7426dc6e...` |
| `X-Fraud-Bot-Score` | number | Bot detection score | `99` |
| `X-Fraud-Country` | string | User's country code | `US` |
| `X-Fraud-ASN` | number | Autonomous System Number | `15169` |
| `X-Fraud-Pattern-Type` | string | Detected pattern type | `sequential` |
| `X-Fraud-Pattern-Confidence` | number | Pattern confidence | `0.85` |
| `X-Fraud-Markov-Detected` | boolean | Markov fraud detection | `true` |
| `X-Fraud-Markov-Confidence` | number | Markov confidence | `0.92` |

**Note:** Origin forwarding is fire-and-forget (non-blocking). The Worker responds to the client immediately while forwarding to your backend asynchronously.

### Use Cases

#### 1. CDN/Edge Logs
Headers are visible in Cloudflare Analytics, access logs, and edge compute logs without parsing JSON bodies.

```
# Cloudflare Analytics query
SELECT
  http.request.headers['x-risk-score'] as risk_score,
  http.request.headers['x-fraud-decision'] as decision,
  COUNT(*) as requests
FROM cloudflare_logs
GROUP BY risk_score, decision
```

#### 2. WAF Rules
Trigger Web Application Firewall rules based on header values:

```
# Block high-risk requests at the edge
(http.request.headers["x-risk-score"] gt 0.8) then block
```

#### 3. Reverse Proxy Integration
nginx, Apache, or other proxies can log and act on headers:

```nginx
# nginx configuration
location /signup {
  if ($http_x_fraud_decision = "block") {
    return 403;
  }
  proxy_pass http://backend;
  # Pass fraud headers to backend
  proxy_set_header X-Fraud-Risk-Score $http_x_fraud_risk_score;
}
```

#### 4. Backend Processing
Your backend receives enriched fraud signals without additional API calls:

```javascript
// Express.js backend
app.post('/signup', (req, res) => {
  const riskScore = parseFloat(req.headers['x-fraud-risk-score']);
  const decision = req.headers['x-fraud-decision'];

  if (decision === 'block') {
    return res.status(403).json({ error: 'Signup blocked' });
  }

  if (decision === 'warn') {
    // Require additional verification
    await sendVerificationEmail(req.body.email);
  }

  // Continue with signup...
});
```

#### 5. SIEM Integration
Security Information and Event Management systems can ingest headers from logs:

```
# Splunk query
index=web sourcetype=access_combined
| eval risk_score=mvindex(split(http_headers, "X-Risk-Score: "), 1)
| where risk_score > 0.6
```

### Configuration Examples

**Enable response headers only:**
```jsonc
{
  "vars": {
    "ENABLE_RESPONSE_HEADERS": "true",
    "ENABLE_ORIGIN_HEADERS": "false"
  }
}
```

**Enable origin forwarding:**
```jsonc
{
  "vars": {
    "ENABLE_RESPONSE_HEADERS": "true",
    "ENABLE_ORIGIN_HEADERS": "true",
    "ORIGIN_URL": "https://api.yourbackend.com/fraud-check"
  }
}
```

**Disable all custom headers:**
```jsonc
{
  "vars": {
    "ENABLE_RESPONSE_HEADERS": "false",
    "ENABLE_ORIGIN_HEADERS": "false"
  }
}
```

## Configuration

**Zero Configuration Required** - The worker starts with sensible defaults.

### KV-Based Runtime Configuration

Configuration is managed via Cloudflare Workers KV and can be updated at runtime via the Admin API:

```bash
# View current configuration
curl https://your-worker.dev/admin/config \
  -H "X-API-Key: your-admin-api-key"

# Update configuration (runtime, no redeployment)
curl -X PUT https://your-worker.dev/admin/config \
  -H "X-API-Key: your-admin-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "riskThresholds": {"block": 0.7, "warn": 0.4},
    "features": {
      "enableDisposableCheck": true,
      "enablePatternCheck": true,
      "enableNGramAnalysis": true,
      "enableTLDRiskProfiling": true,
      "enableBenfordsLaw": true,
      "enableMarkovChainDetection": true
    },
    "logging": {
      "logAllValidations": true,
      "logLevel": "info",
      "logBlocks": true
    },
    "headers": {
      "enableResponseHeaders": true,
      "enableOriginHeaders": false,
      "originUrl": ""
    },
    "riskWeights": {
      "entropy": 0.2,
      "domainReputation": 0.1,
      "tldRisk": 0.1,
      "patternDetection": 0.6
    }
  }'
```

**See [docs/CONFIGURATION.md](CONFIGURATION.md) for complete configuration guide including:**
- Default configuration values
- All configurable options
- Admin API endpoints
- Configuration examples
- Troubleshooting

## Examples

### cURL

```bash
# Validate a normal email
curl -X POST https://your-worker.dev/validate \
  -H "Content-Type: application/json" \
  -d '{"email":"person1.person2@example.com"}'

# Validate a suspicious email
curl -X POST https://your-worker.dev/validate \
  -H "Content-Type: application/json" \
  -d '{"email":"xk9m2qw7r4p@example.com"}'

# Get debug information
curl https://your-worker.dev/debug
```

### JavaScript/Fetch

```javascript
async function validateEmail(email) {
  const response = await fetch('https://your-worker.dev/validate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email }),
  });

  const result = await response.json();

  if (result.decision === 'block') {
    console.error('Email blocked:', result.message);
    return false;
  } else if (result.decision === 'warn') {
    console.warn('Email flagged:', result.riskScore);
    // Log for manual review
  }

  return result.valid;
}

// Usage
const isValid = await validateEmail('test@example.com');
```

### Node.js

```javascript
const axios = require('axios');

async function validateEmail(email) {
  try {
    const response = await axios.post('https://your-worker.dev/validate', {
      email: email
    });

    return response.data;
  } catch (error) {
    if (error.response) {
      // Server responded with error status
      return error.response.data;
    }
    throw error;
  }
}

// Usage
validateEmail('test@example.com')
  .then(result => {
    console.log('Validation result:', result);
    if (result.decision === 'block') {
      console.log('⛔ Email blocked');
    }
  });
```

### Python

```python
import requests

def validate_email(email):
    response = requests.post(
        'https://your-worker.dev/validate',
        json={'email': email}
    )

    result = response.json()

    if result['decision'] == 'block':
        print(f"❌ Email blocked: {result['message']}")
        return False
    elif result['decision'] == 'warn':
        print(f"⚠️  Email flagged (risk: {result['riskScore']})")

    return result['valid']

# Usage
is_valid = validate_email('test@example.com')
```

## Admin API

**Authentication Required**: All admin endpoints require API key authentication.

```bash
# Set admin API key (production)
wrangler secret put ADMIN_API_KEY

# Use in requests
curl -H "X-API-Key: your-secret-key" https://your-worker.workers.dev/admin/...
```

### GET /admin/analytics

Query D1 database with predefined query types.

**Recommended**: Use predefined query types to avoid Cloudflare WAF blocking.

```bash
# Summary statistics
curl -H "X-API-Key: $KEY" "https://your-worker.workers.dev/admin/analytics?type=summary&hours=24"

# Available types: summary, blockReasons, riskDistribution, topCountries,
#                  highRisk, performance, timeline, fingerprints,
#                  disposableDomains, patternFamilies, markovStats
```

**Response**:
```json
{
  "success": true,
  "mode": "predefined",
  "query": "SELECT decision, COUNT(*) as count FROM validations...",
  "hours": 24,
  "data": [
    { "decision": "allow", "count": 1234 },
    { "decision": "block", "count": 56 }
  ]
}
```

### POST /admin/analytics

Execute custom SQL queries. Use POST to avoid Cloudflare WAF blocking SQL in URLs.

**Security**: Only `SELECT` queries on `validations`, `training_metrics`, `ab_test_metrics`, and `admin_metrics` tables are allowed.

```bash
curl -X POST "https://your-worker.workers.dev/admin/analytics" \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "SELECT pattern_type, COUNT(*) as count FROM validations WHERE timestamp >= datetime('"'"'now'"'"', '"'"'-24 hours'"'"') GROUP BY pattern_type",
    "hours": 24
  }'
```

**Response**:
```json
{
  "success": true,
  "mode": "custom",
  "query": "SELECT pattern_type...",
  "hours": 24,
  "data": [
    { "pattern_type": "simple", "count": 500 },
    { "pattern_type": "sequential", "count": 25 }
  ]
}
```

**Why POST?**: Cloudflare WAF blocks SQL keywords in URL query parameters as potential SQLi attacks. Sending SQL in the POST body bypasses this protection.

### GET /admin/analytics/queries

List all available predefined query types with SQL examples.

```bash
curl -H "X-API-Key: $KEY" "https://your-worker.workers.dev/admin/analytics/queries"
```

### GET /admin/config

Get current fraud detection configuration.

```bash
curl -H "X-API-Key: $KEY" "https://your-worker.workers.dev/admin/config"
```

### PUT /admin/config

Update fraud detection configuration.

```bash
curl -X PUT "https://your-worker.workers.dev/admin/config" \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "riskThresholds": {
      "block": 0.7,
      "warn": 0.4
    }
  }'
```

### POST /admin/markov/train

Manually trigger Markov Chain model retraining using production data from the last 7 days.

**⚠️ Important**: This endpoint uses the model's own predictions as training labels, which can create circular reasoning issues. CLI training with human-labeled CSV data is recommended instead. See [TRAINING.md](./TRAINING.md) for details.

**Request:**
```bash
curl -X POST "https://your-worker.workers.dev/admin/markov/train" \
  -H "X-API-Key: $ADMIN_API_KEY"
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Training completed successfully",
  "result": {
    "success": true,
    "fraud_count": 1234,
    "legit_count": 5678,
    "version": "v1762063221887_69",
    "duration_ms": 8542,
    "anomaly_score": 0.25,
    "deployed": true
  }
}
```

**Response (Failure):**
```json
{
  "success": false,
  "message": "Training failed",
  "error": "Insufficient samples: need at least 500, got 342"
}
```

**Training Process:**
1. Fetches high-confidence validation data from D1 (last 7 days)
2. Labels samples based on risk_score and decision
3. Runs anomaly detection for data poisoning
4. Trains new 3-gram models
5. Validates against production models
6. Saves to KV with backup and versioning

**Requirements:**
- Minimum 500 samples in last 7 days
- Anomaly score < 0.8 (security check)
- D1 database configured

### Dashboard

Access the analytics dashboard at: `https://your-worker.workers.dev/dashboard/`

Enter your `ADMIN_API_KEY` when prompted. The dashboard uses the POST endpoint to fetch data.

---

## Error Codes

| Status Code | Description |
|-------------|-------------|
| 200 | Validation successful (email may still be invalid) |
| 400 | Bad request (missing email or validation failed) |
| 404 | Endpoint not found |
| 500 | Internal server error |

## Rate Limits

Currently no rate limits enforced at the API level. Consider implementing:
- Per-IP rate limiting
- Per-fingerprint rate limiting
- Per-API-key rate limiting (if authentication is added)

## Observability

### Structured Logging

All validations are logged in structured JSON format:

```json
{
  "level": "info",
  "event": "email_validation",
  "email_hash": "973dfe463ec85785",
  "fingerprint": "7426dc6e...",
  "risk_score": 0.15,
  "decision": "allow",
  "signals": { "formatValid": true, "entropyScore": 0.42 },
  "latency_ms": 2,
  "timestamp": 1698765432100
}
```

Blocked emails are logged at WARNING level:

```json
{
  "level": "warn",
  "event": "email_blocked",
  "email_hash": "8a81c99059a5a2a5",
  "fingerprint": "7426dc6e...",
  "risk_score": 0.85,
  "reason": "high_entropy",
  "timestamp": 1698765432100
}
```

### Analytics Engine

Metrics are written to Cloudflare Analytics Engine for dashboarding:

**Metrics tracked:**
- Decision distribution (allow/warn/block)
- Risk score histogram
- Block reasons breakdown
- Country distribution
- Bot score distribution
- Performance (P50/P95/P99 latency)

**Query examples:**

See `src/utils/metrics.ts` for predefined GraphQL queries for common dashboards.

## Performance

**Target Metrics:**
- P95 latency: < 100ms
- P99 latency: < 150ms
- Availability: > 99.9%

**Actual Performance (Phase 1):**
- Average latency: 0-2ms (basic validation only)
- Format validation: ~0.5ms
- Entropy calculation: ~0.5ms
- Fingerprinting: ~1ms

## Security

**Email Privacy:**
- Email addresses are never logged in plain text
- SHA-256 hashes are used for logging (first 16 chars)
- Hashes are salted per validation

**Fingerprinting:**
- Composite fingerprints use multiple signals
- IP addresses are hashed in logs
- No PII is stored long-term

## Support

For issues, feature requests, or contributions:
- GitHub: [Your Repository URL]
- Email: [Your Contact Email]

## License

[Your License]
