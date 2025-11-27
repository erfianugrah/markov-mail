# Configuration Guide

## Overview

The fraud detection system is configured via JSON stored in Cloudflare KV. This allows real-time configuration updates without redeployment.

## Quick Start

**New to Markov Mail?** Use the production-ready configuration:
- **Pre-configured**: [`config/production/config.json`](../config/production/config.json) includes calibration and optimal thresholds
- **Tested**: 97.96% F1 score with 100% recall and 96% precision
- **Upload Instructions**: See [`config/production/README.md`](../config/production/README.md)

The rest of this document covers individual configuration options for customization.

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

## A/B Experiments

Experiments live alongside configuration in the `CONFIG` KV namespace under the `ab_test_config` key.

- Create/update via CLI: `npm run cli ab:create --experiment-id ...`
- Inspect via CLI: `npm run cli ab:status` (or API: `GET /admin/ab-test/status`)
- Disable by deleting the key: `npm run cli ab:stop`

Once an experiment is active:

- The worker hashes each fingerprint, assigns a control/treatment variant, and deep merges the treatment overrides into the base config
- Each validation row in D1 records `experiment_id`, `variant`, and `bucket` so you can query lift directly
- The dashboard overview card shows the active experiment along with traffic split and dates
