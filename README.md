# Markov Mail

Email fraud detection system powered by a Random Forest classifier running on Cloudflare Workers. Features a 45-dimension feature vector, Platt-calibrated scoring, and a real-time analytics dashboard.

## What exists

| Component | Status |
|-----------|--------|
| Worker runtime (`src/`) | Production — RF + DT model evaluation, 45-feature extraction (identity/geo/MX/n-gram) |
| Dashboard (`dashboard/`) | Production — Astro + React analytics UI at `fraud.erfi.dev/dashboard` |
| CLI tooling (`cli/`) | Production — training pipeline, calibration, deployment, dataset management |
| D1 schema & migrations | Single consolidated migration |

## Architecture

1. **Feature extraction** — Bun CLI exports a 45-feature matrix from labeled emails (`features:export`).
2. **Model training** — Python/scikit-learn trains a Random Forest with conflict-zone weighting and OOB-based Platt calibration (`model:train` or `npm run pipeline`).
3. **KV-backed models** — Upload `random_forest.json` to the `CONFIG` namespace and hot-swap without redeploying (60s cache TTL).
4. **Edge inference** — Worker evaluates the feature vector against the RF model, applies calibrated thresholds, and logs to D1.
5. **Dashboard** — Real-time analytics, score distributions, model comparison, and SQL query builder.

## Working directories

- `src/` — Worker runtime (middleware, detectors, services, model evaluators).
- `config/production/` — Production config + trained models.
- `cli/commands/` — Model training, data generation, calibration, deployment.
- `docs/` — Documentation.
- `dashboard/` — Astro + React analytics dashboard (builds to `public/dashboard/`).

## Developing

```bash
npm install
npm run dev            # worker
npm run typecheck
npm run test:unit
```

CLI helpers: `npm run cli -- <command>` (model:train, features:export, deploy, analytics:stats, etc.).

### Training workflow

```bash
# 1. Generate synthetic data (with proper name-stripping and diverse gibberish)
npm run cli -- data:synthetic -- --count 500000 --legit-ratio 0.5 --seed 2025

# 2. Export features (shuffle for representative sampling)
npm run cli -- features:export -- --input data/main.csv --output data/features/export.csv --shuffle

# 3. Train model
npm run cli -- model:train -- --n-trees 50 --version "4.0.0-forest" --upload

# Or use the full automated pipeline
npm run pipeline -- \
  --dataset data/main.csv \
  --export-modes full \
  --search '[{"label":"prod","nTrees":50,"maxDepth":6,"noSplit":true}]' \
  --upload-model --apply-thresholds --sync-config
```

See `docs/MODEL_TRAINING.md` for the complete training reference.

## Dashboard

```bash
cd dashboard && npm install && npm run build  # Output: ../public/dashboard/
npm run dev  # Development: http://localhost:4321
```

**Features**: Real-time metrics, block reasons, time series, model comparison, SQL query builder, auto-refresh.

**Access**: https://fraud.erfi.dev/dashboard/
