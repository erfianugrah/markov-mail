# Markov Mail (Reset)

This branch is the clean slate for Markov Mail. The Worker will stay extremely small—just enough TypeScript to parse requests, pull a JSON decision tree from KV, score a set of engineered features, and log the verdicts to D1 so the archived dashboard snapshot can keep running. Everything else (training, experimentation, weight tuning) moves offline.

## What exists right now

| Component | Status |
|-----------|--------|
| Worker entry (`src/`) | ✅ Minimal middleware + decision-tree evaluator |
| Dashboard source (`dashboard/`) | ❌ Removed (archived static bundle lives in `public/dashboard`) |
| D1 schema & migrations | ✅ Fully intact (single reset migration) |
| CLI tooling | ✅ Focused on KV/config/analytics utilities |
| Legacy runtime pipeline | ❌ Removed |

## What we're building

1. **Offline feature export + training** – Bun/TS script to dump labeled features, Python script (`ml/export_tree.py`) to train/convert trees.
2. **KV-backed model catalog** – upload `decision_tree.json` to the `CONFIG` namespace and hot-swap without redeploying.
3. **Simple observability** – every validation stores the tree reason/path in D1 so the dashboard can explain blocks.

## Working directories

- `src/` – Worker runtime (middleware, detectors, services, decision-tree evaluator).
- `config/production/` – shipping config + decision-tree example.
- `ml/` – Python exporter scaffold for the new model pipeline.
- `docs/` – high-level notes for the reset branch.
- `public/dashboard/` – static snapshot of the legacy analytics UI (served as-is by Wrangler until we rebuild).

## Developing

```bash
npm install
npm run dev            # worker
npm run typecheck
npm run test
```

> Testing tip: by default `npm test` uses the Cloudflare Workers pool (wrangler spins up a proxy and may require network permissions). Set `VITEST_CLOUDFLARE_POOL=off npm test` to fall back to plain Node threads when running in a sandbox or offline.

CLI helpers: `npm run cli -- <command>` (deploy, kv:list, analytics:stats, config:get, features:export, etc.).

### Exporting features for training

```bash
# Generate data/features/export.csv from data/main.csv
npm run cli features:export

# Custom input/output, keep original email column, cap at 10k rows
npm run cli features:export -- \
  --input data/main.csv \
  --output tmp/features.csv \
  --include-email \
  --limit 10000
```

Use the resulting CSV as the input to `ml/export_tree.py` (see `docs/DECISION_TREE.md`).

## Next steps

- Flesh out the Python exporter with validation metrics + version metadata.
- Extend the dashboard to show loaded model versions and tree reasons.
