# Fraud Detection CLI

Bun-powered automation for the Markov Mail fraud detection system: model training, calibration, dataset management, deployment, and operational tooling.

## Quick Start

```bash
# Show all available commands
npm run cli

# Full training pipeline (feature export -> train -> calibrate -> deploy)
npm run pipeline -- \
  --dataset data/main.csv \
  --export-modes full \
  --search '[{"label":"prod","nTrees":50,"maxDepth":6,"noSplit":true}]' \
  --upload-model --apply-thresholds --sync-config

# Generate synthetic training data
npm run cli -- data:synthetic -- --count 500000 --legit-ratio 0.5 --seed 2025

# Export features for offline training
npm run cli -- features:export -- --input data/main.csv --output data/features/export.csv --shuffle

# Train model directly (bypassing pipeline)
npm run cli -- model:train -- --n-trees 50 --max-depth 6 --version "4.0.0-forest" --upload
```

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `FRAUD_API_URL` | Base URL for `/admin/*` helpers (`analytics:*`, `ab:*`) | `http://localhost:8787` |
| `FRAUD_API_KEY` | Admin API key for analytics/A-B helpers | _(required for remote calls)_ |

Store them in `.dev.vars`, export in your shell, or pass `--url` / `--api-key` flags per command.

## Command Groups

### Model Workflow
- `model:train` -- Train Random Forest (or Decision Tree with `--n-trees 1`). Accepts `--version`, `--conflict-entropy-threshold`, `--conflict-reputation-threshold`.
- `model:tune` -- Hyperparameter tuning via RandomizedSearchCV.
- `model:calibrate` -- Refit Platt scaling on a calibration dataset.
- `model:thresholds` -- Auto-select warn/block thresholds meeting SLO constraints.
- `model:guardrail` -- CI gate: calibrate + thresholds + verification in one step.
- `model:analyze` -- Print feature importances for a trained model.
- `features:export` -- Export the 45-feature matrix from labeled emails. Supports `--shuffle`, `--skip-mx`, `--limit`.

### Data Generation
- `data:synthetic` -- Generate diverse multi-language synthetic emails for training. Supports `--seed`, `--legit-ratio`, `--append`.
- `data:enron:clean` -- Clean and preprocess the Enron corpus.

### Deployment
- `deploy` -- `npm run cli deploy -- --minify`
- `deploy:status` -- Check deployment status.

### Configuration & Data
- `config:get|set|list|upload|sync` -- Manage `config.json` in KV.
- `config:update-thresholds` -- Apply recommended thresholds to config files.
- `kv:list|get|put|delete` -- Raw KV helpers.
- `analytics:query` / `analytics:stats` -- Run D1 queries through `/admin/analytics`.
- `domains:*` -- Refresh/inspect disposable-domain metadata.
- `tld:*` -- Manage TLD risk profiles.

### Testing
- `test:api` -- Smoke test `/validate`.
- `test:live`, `test:batch`, `test:detectors`, `test:cron`, `test:multilang` -- Specialized suites.

### Experimentation
- `ab:create`, `ab:status`, `ab:analyze`, `ab:stop` -- Manage KV-backed A/B experiments.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `FRAUD_API_KEY is required` | Export `FRAUD_API_KEY` or pass `--api-key` to analytics/A-B commands. |
| `wrangler not authenticated` | Run `npx wrangler whoami` and log in. |
| `ENOENT: config/production/config.json` | Run commands from the repo root so relative paths resolve. |
| Python import errors | Install deps: `pip install scikit-learn pandas numpy` |

For the authoritative list of commands, run `npm run cli`.
