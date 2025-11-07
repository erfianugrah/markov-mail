# Getting Started Guide

**Bogus Email Pattern Recognition** - Complete setup and implementation guide

## Table of Contents

1. [Quick Start](#quick-start)
2. [Prerequisites](#prerequisites)
3. [Installation](#installation)
4. [Configuration](#configuration)
5. [Running Locally](#running-locally)
6. [Testing](#testing)
7. [Deployment](#deployment)
8. [Usage Examples](#usage-examples)
9. [Troubleshooting](#troubleshooting)

---

## Quick Start

Get the system running in under 5 minutes:

```bash
# 1. Clone and install
git clone https://github.com/your-org/bogus-email-pattern-recognition.git
cd bogus-email-pattern-recognition
npm install

# 2. Run tests
npm test

# 3. Start development server
npm run dev

# 4. Test the API
curl -X POST http://localhost:8787/validate \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'
```

---

## Prerequisites

### Required

- **Node.js** v18+ (v20+ recommended)
- **npm** v9+ (comes with Node.js)
- **Cloudflare Account** (free tier works)

### Optional

- **wrangler CLI** (for deployment)
- **Git** (for version control)

### System Requirements

- **OS**: Linux, macOS, or Windows (with WSL2)
- **RAM**: 2GB minimum
- **Disk**: 500MB available space

---

## Installation

### Step 1: Clone Repository

```bash
git clone https://github.com/your-org/bogus-email-pattern-recognition.git
cd bogus-email-pattern-recognition
```

### Step 2: Install Dependencies

```bash
npm install
```

**Expected output:**
```
added 142 packages, and audited 143 packages in 12s
```

**Key dependencies installed:**
- `hono` - Web framework
- `@cloudflare/workers-types` - TypeScript definitions
- `pino` - Structured logging
- `vitest` - Testing framework

### Step 3: Verify Installation

```bash
# Check Node version
node --version  # Should show v18+ or v20+

# Check npm version
npm --version   # Should show v9+

# Verify TypeScript compilation
npx tsc --noEmit
```

---

## Configuration

**Zero Configuration Required** - The worker starts with sensible defaults out of the box.

### KV-Based Runtime Configuration

Configuration is managed via Cloudflare Workers KV and can be updated at runtime without redeployment.

#### Configuration Structure

The configuration system includes:

- **Risk Thresholds**: Block and warn thresholds (default: block 0.6, warn 0.3)
- **Feature Toggles**: Enable/disable pattern detection, disposable checks, etc.
- **Risk Weights**: Configurable weights for entropy, domain reputation, TLD risk, and pattern detection
- **Logging Settings**: Control log verbosity and what gets logged
- **Action Overrides**: Escalate decisions (e.g., warn → block)

#### Setup KV Configuration (Optional)

1. **Create KV Namespace**:
   ```bash
   wrangler kv namespace create CONFIG
   wrangler kv namespace create CONFIG --preview
   ```

2. **Update `wrangler.jsonc`** with namespace IDs:
   ```jsonc
   {
     "kv_namespaces": [
       {
         "binding": "CONFIG",
         "id": "your-namespace-id",
         "preview_id": "your-preview-id"
       }
     ]
   }
   ```

3. **Set Admin API Key** (enables configuration management):
   ```bash
   # For production
   wrangler secret put ADMIN_API_KEY

   # For local development, create .dev.vars:
   echo "ADMIN_API_KEY=your-secret-key" > .dev.vars
   ```

#### Configuration Options

**Risk Thresholds:**
- `block`: 0.6 (emails with risk > 0.6 are blocked)
- `warn`: 0.3 (emails with risk 0.3-0.6 get warning)

**Feature Flags:**
- `enableDisposableCheck`: true (checks 170+ disposable domains)
- `enablePatternCheck`: true (sequential, dated, plus-addressing, keyboard walks)
- `enableNGramAnalysis`: true (gibberish detection)
- `enableTLDRiskProfiling`: true (TLD risk scoring)
- `enableKeyboardWalkDetection`: true (keyboard pattern detection)
- `enableBenfordsLaw`: true (statistical batch detection)

**Risk Weights** (must sum to 1.0):
- `entropy`: 0.20 (random string detection)
- `domainReputation`: 0.10 (disposable/free providers)
- `tldRisk`: 0.10 (TLD risk profiling)
- `patternDetection`: 0.50 (pattern-based detection)

**Logging:**
- `logAllValidations`: true (log every validation)
- `logLevel`: "info" (debug, info, warn, error)
- `logBlocks`: true (log blocked emails separately)

#### Manage Configuration via Admin API

**View current configuration:**
```bash
curl https://your-worker.dev/admin/config \
  -H "X-API-Key: your-admin-api-key"
```

**Update configuration:**
```bash
curl -X PUT https://your-worker.dev/admin/config \
  -H "X-API-Key: your-admin-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "riskThresholds": {"block": 0.7, "warn": 0.4},
    "features": {
      "enableDisposableCheck": true,
      "enablePatternCheck": true
    }
  }'
```

**Reset to defaults:**
```bash
curl -X POST https://your-worker.dev/admin/config/reset \
  -H "X-API-Key: your-admin-api-key"
```

**See [CONFIGURATION.md](CONFIGURATION.md) for complete guide with all admin endpoints, examples, and troubleshooting.**

---

## Running Locally

### Development Server

Start the development server with hot reload:

```bash
npm run dev
```

**Output:**
```
⛅️ wrangler 3.x.x
------------------
Your worker has 1 route:
  - http://localhost:8787

[wrangler:inf] Ready on http://localhost:8787
```

The server runs on `http://localhost:8787` by default.

### Available Endpoints

#### 1. Root Endpoint (GET /)

**Test:**
```bash
curl http://localhost:8787/
```

**Response:**
```
Bogus Email Pattern Recognition API

Endpoints:
- POST /validate { "email": "test@example.com" }
- GET /debug (shows all request signals)

Example:
curl -X POST https://your-worker.dev/validate \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'
```

#### 2. Validation Endpoint (POST /validate)

**Test:**
```bash
curl -X POST http://localhost:8787/validate \
  -H "Content-Type: application/json" \
  -d '{"email":"john.doe@example.com"}'
```

**Response:**
```json
{
  "valid": true,
  "riskScore": 0.36,
  "decision": "warn",
  "message": "Email validation completed",
  "signals": {
    "formatValid": true,
    "entropyScore": 0.42,
    "localPartLength": 8,
    "isDisposableDomain": false,
    "isFreeProvider": false,
    "domainReputationScore": 0,
    "patternFamily": "RANDOM@example.com",
    "patternType": "random",
    "patternConfidence": 0.6,
    "patternRiskScore": 0.5,
    "normalizedEmail": "john.doe@example.com",
    "hasPlusAddressing": false,
    "hasKeyboardWalk": false,
    "keyboardWalkType": "none",
    "isGibberish": true,
    "gibberishConfidence": 1,
    "tldRiskScore": 0.29
  },
  "fingerprint": {
    "hash": "3d1852...",
    "country": "US",
    "asn": 13335,
    "botScore": 0
  },
  "latency_ms": 1
}
```

#### 3. Debug Endpoint (GET /debug)

Shows all available fingerprinting signals:

```bash
curl http://localhost:8787/debug
```

**Response:**
```json
{
  "fingerprint": {
    "hash": "...",
    "ip": "127.0.0.1",
    "userAgent": "curl/7.x",
    "country": "XX",
    "asn": 0,
    "botScore": 0
  },
  "allSignals": {
    "cf-connecting-ip": "127.0.0.1",
    "user-agent": "curl/7.x",
    "cf-ipcountry": "XX",
    "cf-bot-score": "0"
  }
}
```

---

## Testing

### Run All Tests

```bash
npm test
```

**Expected output:**
```
Test Files  6 passed (6)
Tests  169 passed (169)
Duration  2.00s
```

### Test Breakdown

**169 total tests across 6 files:**

1. **Email Validator Tests** (`email.test.ts`) - 20 tests
   - Format validation (RFC 5322)
   - Entropy calculation
   - Edge cases

2. **Pattern Detector Tests** (`pattern-detectors.test.ts`) - 37 tests
   - Sequential patterns
   - Dated patterns
   - Plus-addressing
   - Keyboard walks

3. **N-Gram Analysis Tests** (`ngram-analysis.test.ts`) - 29 tests
   - Natural name detection
   - Gibberish identification
   - Name patterns
   - Edge cases

4. **TLD Risk Tests** (`tld-risk.test.ts`) - 37 tests
   - TLD categorization
   - Risk scoring
   - Domain validation
   - Real-world scenarios

5. **Benford's Law Tests** (`benfords-law.test.ts`) - 34 tests
   - Statistical analysis
   - Batch detection
   - Distribution comparison
   - Attack wave simulation

6. **Integration Tests** (`validate-endpoint.test.ts`) - 12 tests
   - API endpoint behavior
   - End-to-end validation
   - CORS handling
   - Error cases

### Run Specific Test Suite

```bash
# Run only N-Gram tests
npm test -- ngram-analysis

# Run only integration tests
npm test -- validate-endpoint

# Run with verbose output
npm test -- --reporter=verbose
```

### Test in Watch Mode

```bash
npm run test:watch
```

Auto-reruns tests when files change.

---

## Deployment

### Prerequisites for Deployment

1. **Cloudflare Account**: Sign up at https://dash.cloudflare.com/
2. **wrangler CLI**: Install if not already done:
   ```bash
   npm install -g wrangler
   ```
3. **Authentication**: Login to Cloudflare:
   ```bash
   wrangler login
   ```

### Step 1: Configure Worker Name

Edit `wrangler.jsonc`:

```jsonc
{
  "name": "your-worker-name",  // Change this
  // ... rest of config
}
```

### Step 2: Deploy to Cloudflare

```bash
npm run deploy
```

**Output:**
```
Total Upload: 45.23 KiB / gzip: 12.34 KiB
Uploaded your-worker-name (2.3 sec)
Published your-worker-name (0.5 sec)
  https://your-worker-name.workers.dev
Current Deployment ID: abc123...
```

### Step 3: Test Deployed Worker

```bash
curl -X POST https://your-worker-name.workers.dev/validate \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'
```

### Step 4: Monitor Analytics

Visit Cloudflare Dashboard:
1. Go to **Workers & Pages**
2. Select your worker
3. Click **Analytics** tab
4. Query Analytics Engine:

```sql
SELECT
  blob1 as decision,
  COUNT(*) as count
FROM email_validations
WHERE timestamp >= NOW() - INTERVAL '1' HOUR
GROUP BY decision
```

---

## Usage Examples

### Example 1: Validate Single Email

```javascript
const response = await fetch('https://your-worker.workers.dev/validate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'user@example.com' })
});

const result = await response.json();

if (result.decision === 'block') {
  console.log('Email blocked:', result.signals);
} else if (result.decision === 'warn') {
  console.log('Email flagged for review');
} else {
  console.log('Email looks good');
}
```

### Example 2: Batch Validation

```javascript
const emails = [
  'user1@example.com',
  'user2@example.com',
  'spam@throwaway.email'
];

const results = await Promise.all(
  emails.map(email =>
    fetch('https://your-worker.workers.dev/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    }).then(r => r.json())
  )
);

console.log('Blocked:', results.filter(r => r.decision === 'block').length);
console.log('Warned:', results.filter(r => r.decision === 'warn').length);
console.log('Allowed:', results.filter(r => r.decision === 'allow').length);
```

### Example 3: Integration with Signup Form

```javascript
async function validateEmailOnSignup(email) {
  try {
    const response = await fetch('https://your-worker.workers.dev/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    const result = await response.json();

    switch (result.decision) {
      case 'block':
        return {
          valid: false,
          message: 'This email address cannot be used. Please use a different email.'
        };

      case 'warn':
        return {
          valid: true,
          warning: 'This email will be reviewed by our team.',
          riskScore: result.riskScore
        };

      case 'allow':
        return {
          valid: true,
          message: 'Email validated successfully'
        };
    }
  } catch (error) {
    // Fail open - don't block signups if service is down
    console.error('Validation service error:', error);
    return { valid: true, warning: 'Email validation unavailable' };
  }
}
```

### Example 4: Custom Threshold

If you want different thresholds for specific use cases:

```javascript
async function validateWithCustomThreshold(email, blockThreshold = 0.7) {
  const response = await fetch('https://your-worker.workers.dev/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  });

  const result = await response.json();

  // Apply custom threshold
  const customDecision = result.riskScore > blockThreshold ? 'block' :
                         result.riskScore > 0.3 ? 'warn' : 'allow';

  return {
    ...result,
    customDecision,
    originalDecision: result.decision
  };
}
```

### Example 5: Worker-to-Worker RPC (Service Bindings)

If you're calling from another Cloudflare Worker, use RPC for better performance:

**Setup `wrangler.jsonc` in your consuming worker:**

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

**Usage in your Worker (with fingerprinting):**

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { email } = await request.json();

    // Direct RPC call with original headers for fingerprinting
    const result = await env.FRAUD_DETECTOR.validate({
      email: email,
      consumer: "MY_APP",
      flow: "SIGNUP_EMAIL_VERIFY",
      // Pass original request headers for accurate fingerprinting
      headers: {
        'cf-connecting-ip': request.headers.get('cf-connecting-ip'),
        'user-agent': request.headers.get('user-agent'),
        'cf-ipcountry': request.headers.get('cf-ipcountry'),
        'cf-ray': request.headers.get('cf-ray')
      }
    });

    if (result.decision === 'block') {
      return new Response('Email rejected', { status: 400 });
    }

    return new Response('Email accepted', { status: 200 });
  }
};
```

**Benefits:**
- 5-10x lower latency (~2-5ms vs ~15-25ms)
- No JSON serialization overhead
- TypeScript type safety across Workers
- Full fingerprinting support when passing headers
- Perfect for high-throughput applications

**See [API.md - RPC Integration](API.md#rpc-integration-service-bindings) for comprehensive examples.**

---

## Troubleshooting

### Issue 1: Tests Failing

**Symptom**: `npm test` shows failures

**Solutions**:

1. **Check Node version**:
   ```bash
   node --version  # Should be v18+
   ```

2. **Reinstall dependencies**:
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```

3. **Run specific failing test**:
   ```bash
   npm test -- <test-file-name>
   ```

### Issue 2: Dev Server Won't Start

**Symptom**: `npm run dev` fails

**Solutions**:

1. **Port already in use**:
   ```bash
   # Kill process on port 8787
   lsof -ti:8787 | xargs kill -9

   # Or use different port
   wrangler dev --port 8788
   ```

2. **Wrangler version**:
   ```bash
   npx wrangler --version  # Should be 3.x+
   npm install -D wrangler@latest
   ```

### Issue 3: Deployment Fails

**Symptom**: `npm run deploy` errors

**Solutions**:

1. **Not logged in**:
   ```bash
   wrangler login
   ```

2. **Worker name conflict**:
   - Change name in `wrangler.jsonc`
   - Must be globally unique

3. **Binding issues**:
   - Verify Analytics Engine dataset exists
   - Check Cloudflare dashboard for bindings

### Issue 4: High Latency

**Symptom**: Validation takes > 100ms

**Solutions**:

1. **Disable excessive logging via Admin API**:
   ```bash
   curl -X PUT https://your-worker.dev/admin/config \
     -H "X-API-Key: your-key" \
     -d '{"logging": {"logAllValidations": false}}'
   ```

2. **Pattern detection is fast and should remain enabled**

3. **Monitor Analytics**:
   - Check p95 latency in dashboard
   - Most requests should be < 5ms

### Issue 5: False Positives

**Symptom**: Legitimate emails blocked

**Solutions**:

1. **Adjust thresholds via Admin API**:
   ```bash
   curl -X PUT https://your-worker.dev/admin/config \
     -H "X-API-Key: your-key" \
     -d '{"riskThresholds": {"block": 0.7, "warn": 0.4}}'
   ```

2. **Check signals**:
   - Look at `result.signals` to see why flagged
   - Common causes:
     - High entropy (random-looking names)
     - Suspicious TLD (.xyz, .top, etc.)
     - Pattern detection (sequential numbers)

3. **Review logs**:
   ```bash
   wrangler tail
   ```

### Issue 6: TypeScript Errors

**Symptom**: IDE shows TypeScript errors

**Solutions**:

1. **Regenerate types**:
   ```bash
   npm run cf-typegen
   ```

2. **Check TypeScript version**:
   ```bash
   npx tsc --version  # Should be 5.x+
   ```

3. **Restart TypeScript server**:
   - VS Code: Cmd+Shift+P → "Restart TS Server"

---

## Additional Resources

After setup, explore these resources:

1. **[Architecture Guide](./ARCHITECTURE.md)** - System design deep dive
2. **[API Documentation](./API.md)** - Complete API reference
3. **[Detectors Guide](./DETECTORS.md)** - Fraud detection algorithms
4. **[Project Structure](./PROJECT_STRUCTURE.md)** - Directory layout

### Using in Production

1. **Test with real data**:
   - Use actual signup emails from your system
   - Analyze risk scores and decisions
   - Tune thresholds based on results

2. **Monitor Analytics**:
   - Query D1 database for blocked/warned emails
   - Track detection patterns
   - Identify attack trends

3. **Integrate with your app**:
   - Add validation to signup flow
   - Implement custom thresholds per use case
   - Set up alerts for high-risk activity

### Advanced Topics

- **Phase 6B**: Markov Chain & Edit Distance (planned)
- **Phase 6C**: Temporal analysis with Durable Objects (planned)
- **Rate Limiting**: Multi-dimensional limits (planned)
- **Admin API**: Whitelist/blacklist management (planned)

---

## Support

**Issues**: https://github.com/your-org/bogus-email-pattern-recognition/issues
**Documentation**: Full docs in `/docs` directory
**Tests**: 169 tests covering all functionality

**Quick Reference**:
- Test: `npm test`
- Dev: `npm run dev`
- Deploy: `npm run deploy`
- Types: `npm run cf-typegen`
