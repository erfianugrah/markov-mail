# Fraud Detection CLI

 Small Bun wrapper around the Worker’s operational tasks. The legacy automation (train:markov, training:workflow, etc.) has been removed—use the decision-tree exporter instead.

## Quick Start

```bash
# Show help
npm run cli --help

# Export features for offline training
npm run cli features:export -- --input data/main.csv --output data/features/export.csv
python ml/export_tree.py --dataset data/features/export.csv --output config/production/decision-tree.latest.json
npm run cli kv:put -- --binding CONFIG decision_tree.json --file config/production/decision-tree.latest.json

# Deploy to production
npm run cli deploy -- --minify

# Inspect analytics (requires API key)
FRAUD_API_KEY=your-key npm run cli analytics:stats -- --last 24 --url https://fraud.example.dev
```

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `FRAUD_API_URL` | Base URL for `/admin/*` helpers (`analytics:*`, `ab:*`) | `http://localhost:8787` |
| `FRAUD_API_KEY` | Admin API key for analytics/A·B helpers | _(required for remote calls)_ |

Store them in `.dev.vars`, export in your shell, or pass `--url` / `--api-key` flags per command.

## Command Groups

### Deployment
- `deploy` – `npm run cli deploy -- --minify`
- `deploy:status` – `npm run cli deploy:status`

### Configuration & Data
- `config:get|set|list|upload|sync` – manage `config.json` in KV.
- `kv:list|get|put|delete` – raw KV helpers.
- `analytics:query` / `analytics:stats` – run D1 queries through `/admin/analytics`.
- `domains:*` – refresh/inspect disposable-domain metadata.
- `tld:*` – manage TLD risk profiles.

### Model Workflow
- `features:export` – mirror the runtime feature vector into a CSV (see `docs/TRAINING.md`).
- Upload the exported decision tree via `kv:put -- --binding CONFIG decision_tree.json --file …`.

### Testing
- `test:api` – smoke test `/validate`.
- `test:live`, `test:batch`, `test:detectors`, `test:cron`, `test:multilang` – specialized suites for regression and detector sanity checks.

### Experimentation
- `ab:create`, `ab:status`, `ab:analyze`, `ab:stop` – manage KV-backed experiments from the CLI.

### Utilities
- `analyze:weights` – placeholder for future risk-weight tuning.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `FRAUD_API_KEY is required` | Export `FRAUD_API_KEY` or pass `--api-key` to analytics/A·B commands. |
| `wrangler not authenticated` | Run `npx wrangler whoami` and log in. |
| `ENOENT: config/production/config.json` | Run commands from the repo root so relative paths resolve. |

For the authoritative list of commands, run `npm run cli --help`.
