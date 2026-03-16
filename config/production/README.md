# Production Artifacts

Everything in this directory is safe to upload directly to Cloudflare KV. It represents the exact configuration and model bundle the Worker expects.

## Files

| File | KV Key | Description |
|------|--------|-------------|
| `config.json` | `config.json` | Runtime configuration (thresholds, feature flags, logging) |
| `random-forest.json` | `random_forest.json` | Pre-trained 48-feature Random Forest model (v5.0.0) |
| `decision-tree.example.json` | `decision_tree.json` | Example schema for the legacy decision tree format |

## First-Time Upload

After creating your KV namespace (see [SETUP.md](../../docs/SETUP.md)):

```bash
NAMESPACE_ID="<your CONFIG KV namespace ID>"

# Upload config
npx wrangler kv key put config.json \
  --path config/production/config.json \
  --namespace-id "$NAMESPACE_ID" --remote

# Upload model
npx wrangler kv key put random_forest.json \
  --path config/production/random-forest.json \
  --namespace-id "$NAMESPACE_ID" --remote
```

Or use the automated setup: `bash scripts/setup.sh`

## Current Model (v5.0.0-48feat)

- **Type:** Random Forest, 20 trees, max depth 6
- **Features:** 48 (including `has_year_suffix`, `alpha_prefix_naturalness`, `digit_position_ratio`)
- **Calibration:** Platt scaling (intercept: -4.56, coef: 8.97, trained on 50k samples)
- **Size:** ~54 KB
- **Performance:**
  - Fraud blocked: 98.6%
  - False negatives: 0.4%
  - P50 latency: <20ms

## Current Thresholds

| Decision | Score Range | Description |
|----------|-------------|-------------|
| `allow` | < 0.56 | Low risk — legitimate user |
| `warn` | 0.56 – 0.87 | Moderate risk — flag for review |
| `block` | >= 0.88 | High risk — reject submission |

## Updating

### Config changes

Edit `config.json` and re-upload, or use the admin API:

```bash
curl -X PATCH https://your-worker.dev/admin/config \
  -H "X-API-Key: KEY" -H "Content-Type: application/json" \
  -d '{"riskThresholds":{"block":0.90,"warn":0.60}}'
```

### Model updates

Train a new model via the container pipeline or offline tools, then upload:

```bash
npx wrangler kv key put random_forest.json \
  --path config/production/random-forest.json \
  --namespace-id "$NAMESPACE_ID" --remote

# Clear model cache to force reload
curl -X DELETE https://your-worker.dev/admin/cache/models \
  -H "X-API-Key: KEY"
```

Always update `CHANGELOG.md` when shipping new models or threshold changes.
