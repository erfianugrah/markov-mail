# Integration Examples

Framework-specific examples showing how to integrate the fraud detection worker into your application with fail-open behavior.

## Available Examples

### [express.js](./express.js)
**Node.js / Express.js integration**
- HTTP API validation
- Middleware pattern
- Fail-open error handling
- Timeout management

**Best for:** Traditional Node.js backends

---

### [nextjs.tsx](./nextjs.tsx)
**Next.js (App Router) integration**
- API route validation
- Server Actions
- Edge middleware
- TypeScript support
- Client-side forms

**Best for:** Next.js applications (13+)

---

### [cloudflare-workers.ts](./cloudflare-workers.ts)
**Cloudflare Workers RPC integration**
- Worker-to-Worker RPC (5-10x faster)
- Type-safe interfaces
- Background validation
- HTTP fallback
- Full fingerprinting support

**Best for:** Cloudflare Workers applications

---

### [generic-fetch.js](./generic-fetch.js)
**Universal Fetch API integration**
- Works in any JavaScript environment
- Retry logic with exponential backoff
- Caching layer
- Progressive enforcement
- Circuit breaker pattern
- Batch validation

**Best for:** Any JavaScript environment (Node.js, Deno, Bun, Browser, Edge Functions)

---

## Common Patterns

### 1. Fail-Open Pattern

All examples implement fail-open behavior: if fraud detection fails, the signup continues.

```javascript
try {
  const result = await validateEmail(email);
  if (!result.allow) {
    return error('Email blocked');
  }
} catch (error) {
  // Fail open: continue with signup
  console.error('Fraud detection failed, allowing signup');
}
```

**Why fail-open?**
- Ensures user signups are never blocked due to service outages
- Fraud detection adds security without breaking critical flows
- Degrades gracefully under high load

---

### 2. Timeout Management

Set timeouts to prevent long waits:

```javascript
const controller = new AbortController();
setTimeout(() => controller.abort(), 2000);

await fetch(url, { signal: controller.signal });
```

**Recommended timeouts:**
- HTTP validation: 2-3 seconds
- RPC validation: 500-1000ms
- Background validation: 5-10 seconds

---

### 3. Decision Handling

Handle the three decision types:

```javascript
const { decision, riskScore } = result;

if (decision === 'block') {
  // High risk - reject signup
  return error('Email cannot be used');
}

if (decision === 'warn') {
  // Medium risk - allow but add extra verification
  console.warn(`Suspicious email: ${email}`);
  // Could require email verification, phone verification, etc.
}

// decision === 'allow'
// Low risk - proceed normally
```

---

### 4. Progressive Enforcement

Roll out fraud detection gradually:

**Phase 1: Logging only**
```javascript
const result = await validateEmail(email);
if (result.decision === 'block') {
  console.log(`[LOG] Would have blocked: ${email}`);
}
// Always allow
```

**Phase 2: Block high-risk only**
```javascript
if (result.decision === 'block' && result.riskScore > 0.8) {
  return error('Email blocked');
}
// Allow everything else
```

**Phase 3: Full enforcement**
```javascript
if (result.decision === 'block') {
  return error('Email blocked');
}
```

---

### 5. Monitoring & Observability

Track fraud detection performance:

```javascript
const start = Date.now();
const result = await validateEmail(email);
const duration = Date.now() - start;

// Log metrics
console.log({
  email: hashEmail(email),
  decision: result.decision,
  riskScore: result.riskScore,
  duration,
  success: true
});
```

**Key metrics to track:**
- Validation success rate
- Average latency
- Decision distribution (allow/warn/block)
- False positive rate

---

## Integration Checklist

### Before Production

- [ ] Implement fail-open pattern
- [ ] Add timeout (2-3 seconds for HTTP)
- [ ] Test with service unavailable
- [ ] Test with slow responses
- [ ] Add logging for blocked emails
- [ ] Monitor validation success rate
- [ ] Start with log-only mode
- [ ] Gradually increase enforcement

### Configuration

- [ ] Use environment variables for URLs
- [ ] Set appropriate timeouts
- [ ] Configure retry logic (optional)
- [ ] Enable caching (optional)
- [ ] Set up monitoring/alerts

### Testing

- [ ] Test legitimate emails (should allow)
- [ ] Test sequential patterns (should block/warn)
- [ ] Test disposable domains (should block)
- [ ] Test high-entropy/random emails (should block/warn)
- [ ] Test service failures (should fail open)
- [ ] Load test (ensure no bottleneck)

---

## Quick Start

### 1. Choose your framework

Pick the example that matches your stack:
- Node.js/Express → `express.js`
- Next.js → `nextjs.tsx`
- Cloudflare Workers → `cloudflare-workers.ts`
- Other → `generic-fetch.js`

### 2. Copy the validation function

```javascript
// Copy the validateEmail() function from the example
async function validateEmail(email) {
  // ... implementation from example
}
```

### 3. Add to your signup endpoint

```javascript
app.post('/signup', async (req, res) => {
  const { email } = req.body;

  // Validate email
  const validation = await validateEmail(email);

  if (!validation.allow) {
    return res.status(400).json({ error: 'Email blocked' });
  }

  // Continue with signup...
});
```

### 4. Test and monitor

```bash
# Test with legitimate email
curl -X POST http://localhost:3000/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"person1@example.com"}'

# Test with suspicious email
curl -X POST http://localhost:3000/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"user123@example.com"}'
```

---

## Performance Considerations

### HTTP vs RPC

| Method | Latency | Use Case |
|--------|---------|----------|
| **HTTP** | 5-20ms | External apps, public API |
| **RPC** | 0.1-0.5ms | Cloudflare Workers only |

**Recommendation:** Use RPC for Cloudflare Workers, HTTP for everything else.

### Caching

Cache validation results for repeat emails:

```javascript
// Cache for 1 minute
const cache = new Map();
const CACHE_TTL = 60000;

async function validateEmailCached(email) {
  const cached = cache.get(email);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.result;
  }

  const result = await validateEmail(email);
  cache.set(email, { result, timestamp: Date.now() });
  return result;
}
```

**When to cache:**
- High-traffic applications
- Repeat validation attempts
- Rate-limited endpoints

**When NOT to cache:**
- Real-time risk assessment
- Evolving attack patterns
- Short-lived sessions

---

## Troubleshooting

### "Request timeout"

**Cause:** Network latency or service overload

**Solutions:**
1. Increase timeout (but not too much)
2. Implement retry logic
3. Use RPC instead of HTTP (Cloudflare Workers only)
4. Enable caching

### "Always failing open"

**Cause:** Service unreachable or misconfigured URL

**Solutions:**
1. Check FRAUD_DETECTION_URL is correct
2. Verify service is deployed and healthy
3. Check network connectivity
4. Test with curl manually

### "High latency"

**Cause:** Cold starts, geographic distance, or service load

**Solutions:**
1. Use RPC for Cloudflare Workers
2. Deploy fraud detector in same region
3. Enable caching
4. Use background validation for non-critical paths

---

## Related Documentation

- [API Quickstart](../../docs/API_DECISION_TREE.md) – Request/response schema for the reset Worker.
- [Configuration Guide](../../docs/CONFIGURATION.md) – How to manage `config.json` + `decision_tree.json` in KV.
- [Architecture Overview](../../docs/ARCHITECTURE.md) – High-level picture of the new runtime.
Legacy resources from the previous stack were removed in this reset. Use git history if you need to dig them up.

---

**Need help?** Open an issue on GitHub or check the docs.
