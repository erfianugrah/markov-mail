# Configuration Management

**KV-Based Runtime Configuration System**

## Overview

The fraud detection worker uses a flexible KV-based configuration system that allows you to:
- Start with sane defaults (no setup required)
- Override settings via KV storage (runtime-editable)
- Secure sensitive data with Worker secrets
- Manage configuration via Admin API

## Configuration Hierarchy

Settings are loaded in this priority order:

```
1. Default Values (hardcoded in src/config/defaults.ts)
   ↓
2. KV Configuration (stored in CONFIG namespace as "config.json")
   ↓
3. Worker Secrets (ADMIN_API_KEY, ORIGIN_URL)
```

Higher priority values override lower priority ones.

## Configuration Structure

```typescript
{
  // Risk Thresholds
  riskThresholds: {
    block: 0.6,  // Block if risk > 0.6
    warn: 0.3    // Warn if risk > 0.3
  },

  // Feature Toggles
  features: {
    enableMxCheck: false,
    enableDisposableCheck: true,
    enablePatternCheck: true,
    enableNGramAnalysis: true,
    enableTLDRiskProfiling: true,
    enableBenfordsLaw: true,
    enableKeyboardWalkDetection: true
  },

  // Logging Configuration
  logging: {
    logAllValidations: true,
    logLevel: "info",
    logBlocks: true
  },

  // Custom Headers
  headers: {
    enableResponseHeaders: true,
    enableOriginHeaders: false,
    originUrl: ""
  },

  // Action Override
  actionOverride: "allow",  // "allow" | "warn" | "block"

  // Risk Scoring Weights (must sum to 1.0)
  riskWeights: {
    entropy: 0.20,
    domainReputation: 0.10,
    tldRisk: 0.10,
    patternDetection: 0.50
  },

  // Pattern Detection Thresholds
  patternThresholds: {
    sequential: 0.8,
    dated: 0.7,
    plusAddressing: 0.6,
    keyboardWalk: 0.8,
    gibberish: 0.9
  },

  // Rate Limiting (future feature)
  rateLimiting: {
    enabled: false,
    maxValidationsPerMinute: 60,
    maxValidationsPerHour: 1000
  },

  // Admin API
  admin: {
    enabled: false  // Auto-enabled when ADMIN_API_KEY is set
  }
}
```

## Setup

### 1. Create KV Namespace

```bash
# Create production namespace
wrangler kv namespace create CONFIG

# Create preview namespace (for local dev)
wrangler kv namespace create CONFIG --preview

# Update wrangler.jsonc with the IDs
```

Update `wrangler.jsonc`:
```jsonc
{
  "kv_namespaces": [
    {
      "binding": "CONFIG",
      "id": "your-namespace-id-here",
      "preview_id": "your-preview-id-here"
    }
  ]
}
```

### 2. Set Admin API Key (Optional)

To enable the admin API for configuration management:

```bash
# Generate a secure key
openssl rand -hex 32

# Set as Worker secret
wrangler secret put ADMIN_API_KEY
# Enter your generated key when prompted
```

For local development, create `.dev.vars`:
```
ADMIN_API_KEY=your-secret-key-here
```

### 3. Set Origin URL (Optional)

If you want to forward validation requests to another service:

```bash
wrangler secret put ORIGIN_URL
# Enter your origin URL when prompted (e.g., https://api.example.com)
```

## Usage

### Default Behavior

**Out of the box, the worker uses sensible defaults and requires zero configuration.**

All features are enabled by default with conservative thresholds:
- Block threshold: 0.6 (high risk)
- Warn threshold: 0.3 (medium risk)
- All pattern detection enabled
- Logging enabled
- Response headers enabled

### Using the Admin API

The Admin API requires an API key (set via `ADMIN_API_KEY` secret).

#### Get Current Configuration

```bash
curl -X GET https://your-worker.workers.dev/admin/config \
  -H "X-API-Key: your-admin-api-key"
```

Response:
```json
{
  "config": { /* full merged config */ },
  "source": {
    "defaults": { /* default values */ },
    "cached": true
  }
}
```

#### View Default Configuration

```bash
curl -X GET https://your-worker.workers.dev/admin/config/defaults \
  -H "X-API-Key: your-admin-api-key"
```

#### Update Configuration (PUT)

Replace the entire configuration:

```bash
curl -X PUT https://your-worker.workers.dev/admin/config \
  -H "X-API-Key: your-admin-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "riskThresholds": {
      "block": 0.7,
      "warn": 0.4
    },
    "features": {
      "enableMxCheck": false,
      "enableDisposableCheck": true,
      "enablePatternCheck": true,
      "enableNGramAnalysis": true,
      "enableTLDRiskProfiling": true,
      "enableBenfordsLaw": true,
      "enableKeyboardWalkDetection": true
    },
    /* ... rest of config ... */
  }'
```

**Note:** Use PUT when you want to replace the entire configuration. Make sure all required fields are provided.

#### Validate Configuration

Test a configuration without saving:

```bash
curl -X POST https://your-worker.workers.dev/admin/config/validate \
  -H "X-API-Key: your-admin-api-key" \
  -H "Content-Type: application/json" \
  -d '{"riskThresholds":{"block":0.7,"warn":0.4}}'
```

#### Reset to Defaults

Clear all KV configuration and revert to defaults:

```bash
curl -X POST https://your-worker.workers.dev/admin/config/reset \
  -H "X-API-Key: your-admin-api-key"
```

#### Clear Cache

Force reload configuration from KV:

```bash
curl -X DELETE https://your-worker.workers.dev/admin/config/cache \
  -H "X-API-Key: your-admin-api-key"
```

### Direct KV Management

You can also manage configuration directly via Wrangler:

#### View Current Configuration

```bash
wrangler kv key get --namespace-id=your-namespace-id config.json
```

#### Update Configuration

Use one of the example configurations from the `examples/` directory:

Upload to KV:
```bash
wrangler kv key put --namespace-id=your-namespace-id config.json --path=examples/config.json
```

#### Delete Configuration (revert to defaults)

```bash
wrangler kv key delete --namespace-id=your-namespace-id config.json
```

## Configuration Examples

### Example 1: Stricter Blocking

```json
{
  "riskThresholds": {
    "block": 0.5,
    "warn": 0.25
  },
  "actionOverride": "block"
}
```

This configuration:
- Blocks at 0.5 risk (vs default 0.6)
- Warns at 0.25 risk (vs default 0.3)
- Escalates all warnings to blocks

### Example 2: Pattern Detection Only

```json
{
  "features": {
    "enableMxCheck": false,
    "enableDisposableCheck": false,
    "enablePatternCheck": true,
    "enableNGramAnalysis": true,
    "enableTLDRiskProfiling": false,
    "enableBenfordsLaw": true,
    "enableKeyboardWalkDetection": true
  }
}
```

This focuses only on pattern-based detection, disabling domain checks.

### Example 3: Custom Risk Weights

```json
{
  "riskWeights": {
    "entropy": 0.10,
    "domainReputation": 0.20,
    "tldRisk": 0.20,
    "patternDetection": 0.50
  }
}
```

This emphasizes domain/TLD reputation over entropy.

### Example 4: Minimal Logging

```json
{
  "logging": {
    "logAllValidations": false,
    "logLevel": "warn",
    "logBlocks": true
  }
}
```

This only logs blocks and warnings, reducing log volume.

## Configuration Validation

The system validates all configuration changes:

### Risk Thresholds
- Must be between 0 and 1
- `warn` must be less than `block`

### Risk Weights
- Must sum to exactly 1.0 (±0.01 tolerance)
- Each weight must be between 0 and 1

### Pattern Thresholds
- Must be between 0 and 1

### Action Override
- Must be one of: "allow", "warn", "block"

If validation fails, the configuration is rejected and an error is returned.

## Caching

Configuration is cached in memory for **1 minute** to reduce KV reads.

- First request: Loads from KV
- Subsequent requests (within 1 min): Uses cached config
- After 1 min: Reloads from KV

To force immediate reload, use the cache clear endpoint:
```bash
curl -X DELETE https://your-worker.workers.dev/admin/config/cache \
  -H "X-API-Key: your-admin-api-key"
```

## Security

### Admin API Key

The `ADMIN_API_KEY` secret protects all admin endpoints:
- **Never commit secrets to git**
- Use `wrangler secret put` for production
- Use `.dev.vars` for local development (gitignored)
- Rotate keys regularly

### Origin URL

The `ORIGIN_URL` secret (if used for request forwarding):
- Keep it secret to prevent unauthorized access
- Use HTTPS URLs only
- Validate the destination service trusts the worker

## Troubleshooting

### Issue: Configuration not updating

**Solution:**
1. Check KV namespace is correctly bound
2. Clear the cache: `DELETE /admin/config/cache`
3. Verify configuration in KV: `wrangler kv key get ...`

### Issue: Admin API returns 503

**Solution:**
- Ensure `ADMIN_API_KEY` secret is set
- Check `.dev.vars` for local development
- Verify secret with: `wrangler secret list`

### Issue: Validation fails with "riskWeights must sum to 1.0"

**Solution:**
- Ensure all four weights are provided
- Verify they sum to 1.0: `entropy + domainReputation + tldRisk + patternDetection = 1.0`
- Use: `0.20 + 0.10 + 0.10 + 0.50 = 0.90` ❌
- Use: `0.20 + 0.10 + 0.10 + 0.60 = 1.00` ✅

### Issue: "Property 'CONFIG' does not exist on type 'Env'"

**Solution:**
Run `npm run cf-typegen` to regenerate type definitions.

## Best Practices

1. **Start with defaults** - Don't configure anything unless you need to
2. **Test locally first** - Use `.dev.vars` and local KV
3. **Validate before saving** - Use `/admin/config/validate`
4. **Document changes** - Keep a changelog of configuration updates
5. **Monitor impact** - Watch metrics after config changes
6. **Use version control** - Store configuration files in git (without secrets)
7. **Gradual rollout** - Test strict configurations on a subset first

## Migration from Environment Variables

If you previously used environment variables in `wrangler.jsonc`:

**Old (wrangler.jsonc):**
```jsonc
{
  "vars": {
    "RISK_THRESHOLD_BLOCK": "0.6",
    "ENABLE_PATTERN_CHECK": "true"
  }
}
```

**New (KV config.json):**
```json
{
  "riskThresholds": {
    "block": 0.6
  },
  "features": {
    "enablePatternCheck": true
  }
}
```

**Benefits of KV-based config:**
- ✅ Runtime updates (no redeploy needed)
- ✅ Structured validation
- ✅ Admin API for management
- ✅ Cleaner wrangler.jsonc
- ✅ Type-safe configuration

## Example Configurations

For ready-to-use configuration examples, see the [`examples/`](../examples/) directory:
- `config.json` - Balanced production configuration
- `config-strict.json` - Maximum security configuration
- `config-lenient.json` - User-friendly configuration
- `config-pattern-only.json` - Pattern detection focus

See [`examples/CONFIG_EXAMPLES.md`](../examples/CONFIG_EXAMPLES.md) for detailed usage guide.

## Related Documentation

- [Getting Started](GETTING_STARTED.md) - Initial setup
- [API Reference](API.md) - All endpoints
- [Architecture](ARCHITECTURE.md) - System design
- [Configuration Examples](../examples/CONFIG_EXAMPLES.md) - Example configurations

---

**Last Updated:** 2025-11-01
**Config Version:** KV-based system with defaults
