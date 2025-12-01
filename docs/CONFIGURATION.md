# Configuration Guide

## Overview

The fraud detection system is configured via JSON stored in Cloudflare KV. This allows real-time configuration updates without redeployment.

## Quick Start

**Fresh deployment?** Start with the bundled artifacts:
- [`config/production/config.json`](../config/production/config.json) – sane defaults for risk thresholds, feature flags, and logging.
- [`config/production/decision-tree.example.json`](../config/production/decision-tree.example.json) – tiny reference tree that shows the runtime schema. Replace it with a real export before going live.

Upload both files to the `CONFIG` KV namespace (see [`config/production/README.md`](../config/production/README.md) for the exact commands). Once the tree is in KV the Worker automatically picks it up on the next cold start—no redeploy needed.

The rest of this document covers the fields inside `config.json`. The configuration is intentionally minimal, focusing on essential risk thresholds and feature flags.

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

## Heuristic Risk Adjustments

Deterministic bumps (extreme TLD risk, known-bad domains, sequential locals, plus-tagger abuse, high bot scores) now live in `config/risk-heuristics.json`. Each entry defines:

```json
{
  "threshold": 0.9,
  "decision": "block",
  "reason": "heuristic_tld_extreme",
  "minScoreOffset": 0.1,
  "direction": "gte"
}
```

- `threshold`: detector score required to trigger the bump (e.g., domain reputation ≥ 0.95)
- `decision`: whether we’re targeting the warn or block band
- `minScoreOffset`: amount to add on top of the decision’s threshold (defaults to `+0.05` block / `+0.03` warn if omitted)
- `reason`: logged verbatim for observability
- `direction`: comparison operator (`"gte"` default, `"lte"` for metrics like bot score where lower values are worse)

Upload changes alongside `config.json`:

```bash
npm run cli -- config:sync
# or explicitly:
# npm run cli -- config:sync --config config/production/config.json --heuristics config/risk-heuristics.json
```

The Worker caches the heuristics for 60 seconds and falls back to the defaults in git if the KV entry is missing. Append `--dry-run` to verify the files exist without sending writes (useful in CI gates).

## Feature Flags

Toggle runtime detectors/inputs without redeploying:

```json
{
  "features": {
    "enableDisposableCheck": true,
    "enablePatternCheck": true,
    "enableTLDRiskProfiling": true,
    "enableMXCheck": true
  }
}
```

- `enableMXCheck` controls both runtime MX lookups (via Cloudflare DNS over HTTPS) and the feature exporter’s defaults. Leave it `true` for production—the decision tree now expects `mx_*` inputs. When running fully offline you can disable it or pass `--skip-mx` to the exporter so those columns zero out cleanly.

## Alert Webhook

Set the `ALERT_WEBHOOK_URL` secret (Slack/Teams/webhook) if you want proactive notifications when high-risk geo/identity anomalies appear. The Worker sends a JSON payload whenever:

- `riskScore >= warnThreshold`, and
- name/email similarity is < 0.2, or
- Geo headers conflict (language/timezone), or
- MX lookups fail for a non-disposable domain.

```bash
wrangler secret put ALERT_WEBHOOK_URL
```

If the secret is unset no alerts are sent (fully opt-in).

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
