# Configuration Guide

## Overview

The fraud detection system is configured via JSON stored in Cloudflare KV. This allows real-time configuration updates without redeployment.

## Quick Start

**Fresh deployment?** Start with the bundled artifacts:
- [`config/production/config.json`](../config/production/config.json) – sane defaults for risk thresholds, feature flags, and logging.
- [`config/production/decision-tree.example.json`](../config/production/decision-tree.example.json) – tiny reference tree that shows the runtime schema. Replace it with a real export before going live.

Upload both files to the `CONFIG` KV namespace (see [`config/production/README.md`](../config/production/README.md) for the exact commands). Once the tree is in KV the Worker automatically picks it up on the next cold start—no redeploy needed.

The rest of this document covers the fields inside `config.json`. The decision-tree reset removed the old calibration knobs entirely, so the JSON is intentionally small.

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
- Use `npm run cli ab:status` (or `GET /admin/ab-test/status`) to see the active experiment along with traffic split and dates
