# Configuration Guide

## Overview

The fraud detection system is configured via JSON stored in Cloudflare KV. This allows real-time configuration updates without redeployment.

## Action Overrides

Override the normal decision logic for specific use cases.

### No Override (Default - Enforcement Mode)

```json
{
  "actionOverride": null  // or omit this field
}
```

**Behavior**: Normal decision logic applies based on risk thresholds.

### Monitoring Mode

```json
{
  "actionOverride": "allow"
}
```

**Behavior**: Allow all requests, but log decisions for observability.

### Strict Mode

```json
{
  "actionOverride": "block"
}
```

**Behavior**: Escalate warnings to blocks. ⚠️ Use with caution.

### Warning Mode

```json
{
  "actionOverride": "warn"
}
```

**Behavior**: Downgrade blocks to warnings for soft launch.

## Risk Thresholds

```json
{
  "riskThresholds": {
    "block": 0.6,    // Score > 0.6 = block
    "warn": 0.3      // Score > 0.3 = warn
  }
}
```

**Recommended**: block=0.6, warn=0.3 (91.8% accuracy)

## See Also

- [Training Guide](./TRAINING.md)
- [Architecture Overview](../README.md)
