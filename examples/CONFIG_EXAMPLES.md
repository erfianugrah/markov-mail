# Configuration Examples

This directory contains example configuration files for different use cases.

## Available Configurations

### 1. `config.json` - Balanced Configuration
**Use Case:** Production environment with moderate security

**Key Settings:**
- **Thresholds**: block: 0.7, warn: 0.4 (more lenient than defaults)
- **Risk Weights**: Emphasizes TLD risk (0.2) and pattern detection (0.5)
- **Logging**: Minimal logging (`logAllValidations: false`, level: `warn`)
- **Features**: All detection features enabled

**Best For:**
- Production with moderate traffic
- Balancing security with user experience
- Reducing false positives

---

### 2. `config-strict.json` - Maximum Security
**Use Case:** High-security environment, minimize fraud at all costs

**Key Settings:**
- **Thresholds**: block: 0.5, warn: 0.25 (very strict)
- **Action Override**: `block` (escalates all warnings to blocks)
- **Risk Weights**: Higher emphasis on domain reputation (0.2) and TLD risk (0.2)
- **Pattern Thresholds**: Lower thresholds catch more patterns (0.7, 0.6, 0.5...)
- **Logging**: Full logging enabled for forensics

**Best For:**
- Financial services
- High-value transactions
- Environments with high fraud risk
- Beta/early access signups

**Warning:** Will increase false positives. Review blocked emails regularly.

---

### 3. `config-lenient.json` - User-Friendly
**Use Case:** Prioritize user experience, accept more risk

**Key Settings:**
- **Thresholds**: block: 0.8, warn: 0.5 (very lenient)
- **Features**: Advanced detection disabled (N-Gram, TLD profiling, Benford's Law off)
- **Risk Weights**: Higher entropy weight (0.3)
- **Pattern Thresholds**: Higher thresholds (0.9, 0.8, 0.7...)
- **Logging**: Error-level only to reduce noise

**Best For:**
- B2C consumer apps
- Free tier signups
- Low-risk applications
- Onboarding optimization

**Note:** Suitable for environments where user friction is more costly than fraud.

---

### 4. `config-pattern-only.json` - Pattern Detection Focus
**Use Case:** Focus on behavior patterns, ignore domain reputation

**Key Settings:**
- **Features**: Disposable check disabled, pattern detection maxed
- **Risk Weights**: 80% on pattern detection, minimal domain/TLD weights
- **Pattern Thresholds**: Moderate sensitivity
- **Logging**: Debug level for pattern analysis

**Best For:**
- Research and analysis
- Understanding attack patterns
- Custom domain environments (corporate email)
- Whitelist-based systems

---

## Usage Examples

### Upload Configuration

**Using curl:**
```bash
# Upload default balanced config
curl -X PUT https://your-worker.dev/admin/config \
  -H "X-API-Key: your-admin-api-key" \
  -H "Content-Type: application/json" \
  -d @config.json

# Upload strict config
curl -X PUT https://your-worker.dev/admin/config \
  -H "X-API-Key: your-admin-api-key" \
  -H "Content-Type: application/json" \
  -d @config-strict.json

# Upload lenient config
curl -X PUT https://your-worker.dev/admin/config \
  -H "X-API-Key: your-admin-api-key" \
  -H "Content-Type: application/json" \
  -d @config-lenient.json

# Upload pattern-only config
curl -X PUT https://your-worker.dev/admin/config \
  -H "X-API-Key: your-admin-api-key" \
  -H "Content-Type: application/json" \
  -d @config-pattern-only.json
```

**Using wrangler (direct KV):**
```bash
# Upload to KV directly
wrangler kv key put --namespace-id=your-namespace-id config.json --path=config.json
```

---

### Validate Before Uploading

Always validate your configuration before uploading:

```bash
curl -X POST https://your-worker.dev/admin/config/validate \
  -H "X-API-Key: your-admin-api-key" \
  -H "Content-Type: application/json" \
  -d @config.json
```

---

### Test After Upload

Test validation behavior after updating config:

```bash
# Test normal email
curl -X POST https://your-worker.dev/validate \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}' | jq '{riskScore, decision}'

# Test suspicious email
curl -X POST https://your-worker.dev/validate \
  -H "Content-Type: application/json" \
  -d '{"email":"test123456@example.com"}' | jq '{riskScore, decision}'

# Test disposable domain
curl -X POST https://your-worker.dev/validate \
  -H "Content-Type: application/json" \
  -d '{"email":"test@mailinator.com"}' | jq '{riskScore, decision}'
```

---

## Configuration Comparison

| Setting | Default | Balanced | Strict | Lenient | Pattern-Only |
|---------|---------|----------|--------|---------|--------------|
| **Block Threshold** | 0.6 | 0.7 | 0.5 | 0.8 | 0.6 |
| **Warn Threshold** | 0.3 | 0.4 | 0.25 | 0.5 | 0.3 |
| **Action Override** | allow | allow | **block** | allow | allow |
| **Pattern Weight** | 0.5 | 0.5 | 0.5 | 0.4 | **0.8** |
| **Domain Weight** | 0.1 | 0.15 | **0.2** | 0.2 | 0.05 |
| **TLD Weight** | 0.1 | **0.2** | **0.2** | 0.1 | 0.05 |
| **Entropy Weight** | 0.2 | 0.15 | 0.1 | **0.3** | 0.1 |
| **Disposable Check** | ✅ | ✅ | ✅ | ✅ | ❌ |
| **N-Gram Analysis** | ✅ | ✅ | ✅ | ❌ | ✅ |
| **TLD Profiling** | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Log All** | true | **false** | true | **false** | true |
| **Log Level** | info | **warn** | info | **error** | **debug** |

---

## Creating Custom Configurations

### Configuration Structure

All configurations must include these fields:

```json
{
  "riskThresholds": {
    "block": 0.6,    // Must be > warn (0-1)
    "warn": 0.3      // Must be < block (0-1)
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
  "logging": {
    "logAllValidations": true,
    "logLevel": "info",     // "debug" | "info" | "warn" | "error"
    "logBlocks": true
  },
  "headers": {
    "enableResponseHeaders": true,
    "enableOriginHeaders": false,
    "originUrl": ""
  },
  "actionOverride": "allow",  // "allow" | "warn" | "block"
  "riskWeights": {
    "entropy": 0.2,           // Must sum to 1.0
    "domainReputation": 0.1,
    "tldRisk": 0.1,
    "patternDetection": 0.6
  },
  "patternThresholds": {
    "sequential": 0.8,        // All 0-1
    "dated": 0.7,
    "plusAddressing": 0.6,
    "keyboardWalk": 0.8,
    "gibberish": 0.9
  },
  "rateLimiting": {
    "enabled": false,
    "maxValidationsPerMinute": 60,
    "maxValidationsPerHour": 1000
  },
  "admin": {
    "enabled": true
  }
}
```

### Validation Rules

1. **riskThresholds.warn** must be less than **riskThresholds.block**
2. **riskWeights** must sum to exactly **1.0** (±0.01 tolerance)
3. All threshold values must be between **0 and 1**
4. **actionOverride** must be one of: `"allow"`, `"warn"`, `"block"`
5. **logLevel** must be one of: `"debug"`, `"info"`, `"warn"`, `"error"`

---

## Best Practices

1. **Start with defaults** - Only configure when you have a specific need
2. **Test locally** - Use `.dev.vars` and local KV for testing
3. **Validate first** - Always use `/admin/config/validate` before uploading
4. **Monitor impact** - Watch metrics after config changes
5. **Document changes** - Keep notes on why you changed specific values
6. **Gradual rollout** - Test strict configs on a subset first
7. **Review regularly** - Adjust based on false positive/negative rates

---

## Troubleshooting

### "riskWeights must sum to 1.0"
Ensure your weights add up exactly:
```javascript
0.2 + 0.1 + 0.1 + 0.6 = 1.0  ✅
0.2 + 0.1 + 0.1 + 0.5 = 0.9  ❌
```

### "riskThresholds.warn must be less than riskThresholds.block"
```json
{"block": 0.6, "warn": 0.3}  ✅
{"block": 0.3, "warn": 0.6}  ❌
```

### Configuration Not Taking Effect
1. Clear the cache: `DELETE /admin/config/cache`
2. Wait 60 seconds for cache expiry
3. Verify with: `GET /admin/config`

---

## Related Documentation

- [Complete Configuration Guide](docs/CONFIGURATION.md)
- [API Documentation](docs/API.md)
- [Getting Started](docs/GETTING_STARTED.md)

---

**Last Updated:** 2025-11-01
**Config Version:** KV-based system
