# Production Artifacts

Everything in this directory is safe to upload directly to Cloudflare KV. It represents the exact configuration and model bundle the Worker expects.

---

## Files

| File | Description |
|------|-------------|
| `config.json` | Runtime configuration (risk thresholds, feature toggles, logging) |
| `random-forest-*.json` | Exported Random Forest models (primary runtime scorer) |
| `decision-tree.example.json` | Sample JSON model illustrating the required schema |

### `config.json`

Key sections:

* `riskThresholds`: `warn` / `block` cutoffs (current: warn ≥ 0.60, block ≥ 0.85 after calibration).
* `baseRiskScores`: deterministic blockers (invalid format, disposable domains, high entropy).
* `features`: toggles for disposable domain checks, pattern detection, and TLD risk profiling.
* `logging`: log level + block logging flags.
* `headers`: whether the worker adds fraud headers to downstream responses.
* `actionOverride`: set to `allow`, `warn`, or `block` when you need a kill switch/monitoring mode.

Upload with:

```bash
npm run cli config:upload -- config/production/config.json
```

### `random-forest-balanced.2025-12-01.json`

Latest calibrated Random Forest bundle:

* 267 trees (`max_depth=14`, `min_samples_leaf=11`, conflict weight 50)
* Embedded feature-importance map for CLI introspection (`model:analyze`)
* `meta.calibration` contains Platt-scaling coefficients so the worker can convert raw forest votes into calibrated probabilities before applying the new thresholds.

Upload it to KV as the active scorer:

```bash
npm run cli -- kv:put random_forest.json \
  --binding CONFIG \
  --file config/production/random-forest-balanced.2025-12-01.json
```

(Older `random-forest-balanced.*.json` files can be deleted once the new model is live.)

### `decision-tree.example.json`

A tiny tree that demonstrates the JSON format used by `src/models/decision-tree.ts`. Real models should be generated via the offline pipeline (see [`docs/DECISION_TREE.md`](../../docs/DECISION_TREE.md)) and uploaded as `decision_tree.json` in the `CONFIG` KV namespace:

```bash
npm run cli kv:put -- \
  --binding CONFIG \
  decision_tree.json \
  --file config/production/decision-tree.example.json
```

Each leaf should include a human-readable `reason`. The worker logs the reason + traversal path to D1 so you can inspect why a request was blocked.

---

## Promotion checklist

1. Train/export a new tree (`ml/export_tree.py`).
2. Upload it to `CONFIG` KV as `decision_tree.json`.
3. Update `config.json` if thresholds or feature flags changed.
4. Record the change in `CHANGELOG.md` and `INVENTORY.md`.
5. (Optional) run an A/B test using the `ab:*` CLI commands before rolling out globally.
