# Configuration Examples

Example configuration files for different use cases.

## ⚠️ IMPORTANT - v2.0+ Changes

**`riskWeights` are DEPRECATED** in v2.0+ and no longer used in scoring.

The system now uses **pure algorithmic scoring**:
- **Primary**: Markov Chain confidence (0-1) used directly
- **Secondary**: Pattern overrides (keyboard: 0.9, sequential: 0.8, dated: 0.7)
- **Tertiary**: Domain signals (reputation * 0.2, TLD * 0.1)

See [`docs/SCORING.md`](../docs/SCORING.md) for complete details.

---

## Available Configs

### `config.json` - Default/Balanced
Recommended starting point with balanced settings.

**Key Settings**:
- Block threshold: 0.7
- Warn threshold: 0.4
- All detectors enabled
- Markov fraud confidence: 0.7

### `config-strict.json` - High Security
Lower thresholds for stricter fraud prevention.

**Key Settings**:
- Block threshold: 0.5 (blocks more aggressively)
- Warn threshold: 0.3
- Higher pattern confidence requirements

**Use When**: Zero tolerance for fraud, willing to accept more false positives.

### `config-lenient.json` - Low False Positives
Higher thresholds for fewer false positives.

**Key Settings**:
- Block threshold: 0.8 (only high-confidence fraud)
- Warn threshold: 0.6
- Lower pattern confidence requirements

**Use When**: Minimize false positives, user experience priority.

### `config-pattern-only.json` - Pattern Detection Focus
Emphasizes pattern-based detection.

**Key Settings**:
- Pattern detection enabled
- Lower gibberish thresholds
- Focus on structural patterns

**Use When**: Known pattern-based attacks in your system.

---

## Configuration Fields

### Active Settings (v2.0+)

These settings are **actively used** in scoring:

```json
{
  "riskThresholds": {
    "block": 0.6,    // Risk score >= 0.6 → block
    "warn": 0.4      // Risk score >= 0.4 → warn
  },

  "confidenceThresholds": {
    "markovFraud": 0.7  // Markov confidence >= 0.7 for fraud flag
  },

  "features": {
    "enableMarkovChainDetection": true,      // Primary detector
    "enableKeyboardWalkDetection": true,     // Secondary override
    "enablePatternCheck": true,              // Sequential/dated patterns
    "enableDisposableCheck": true,           // Hard blocker
    // ... other feature flags
  }
}
```

### Deprecated Settings (v2.0+)

These settings are **ignored** in v2.0+ scoring:

```json
{
  "riskWeights": {
    // ALL VALUES IGNORED - kept for backwards compatibility only
    "entropy": 0.05,            // Not used
    "domainReputation": 0.10,   // Now fixed at 0.2
    "tldRisk": 0.10,            // Now fixed at 0.1
    "patternDetection": 0.50,   // Pattern overrides used instead
    "markovChain": 0.25         // Confidence used directly
  },

  "baseRiskScores": {
    "highEntropy": 0.7  // Entropy pre-check removed in v2.0+
  }
}
```

---

## Migration from v1.x

**No changes required!** The API contract is unchanged.

**Optional**: You can remove `riskWeights` from your custom configs, but keeping them won't cause issues (they're just ignored).

---

## Usage

### Via KV Storage (Production)

Upload config to KV:
```bash
npx wrangler kv:key put "fraud_detection_config" \
  --path examples/config.json \
  --namespace-id <YOUR_CONFIG_NAMESPACE_ID>
```

### Via Environment Variables

Set individual values:
```bash
RISK_THRESHOLD_BLOCK=0.7
RISK_THRESHOLD_WARN=0.4
```

---

## Testing Your Config

Test with sample emails:
```bash
curl -X POST https://your-worker.workers.dev/validate \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'
```

---

## Support

- [CONFIGURATION.md](../docs/CONFIGURATION.md) - Complete config reference
- [SCORING.md](../docs/SCORING.md) - v2.0+ scoring logic
- [API.md](../docs/API.md) - API reference
