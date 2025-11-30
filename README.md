# Markov Mail (Reset)

This branch is the clean slate for Markov Mail. The Worker will stay extremely small—just enough TypeScript to parse requests, pull a JSON decision tree from KV, score a set of engineered features, and log the verdicts to D1 so the archived dashboard snapshot can keep running. Everything else (training, experimentation, weight tuning) moves offline.

## What exists right now

| Component | Status |
|-----------|--------|
| Worker entry (`src/`) | ✅ Minimal middleware + decision-tree evaluator (+ identity/geo/MX feature extraction) |
| Dashboard source (`dashboard/`) | ✅ Rebuilt with Astro + React (builds to `public/dashboard/`) |
| D1 schema & migrations | ✅ Fully intact (single reset migration) |
| CLI tooling | ✅ Focused on KV/config/analytics utilities |
| Legacy runtime pipeline | ❌ Removed |

## What we're building

1. **Offline feature export + training** – Bun CLI exports features and trains decision trees with scikit-learn via Python child process (all managed by `npm run cli tree:train`).
2. **KV-backed model catalog** – upload `decision_tree.json` to the `CONFIG` namespace and hot-swap without redeploying.
3. **Simple observability** – every validation stores the tree reason/path in D1 so the dashboard can explain blocks.

## Working directories

- `src/` – Worker runtime (middleware, detectors, services, decision-tree evaluator).
- `config/production/` – shipping config + decision-tree models.
- `cli/commands/model/` – Model training integration (decision tree training with scikit-learn via Python).
- `docs/` – high-level documentation for the reset branch.
- `dashboard/` – Astro + React analytics dashboard (builds to `public/dashboard/`).
- `public/dashboard/` – Built dashboard served by Wrangler static assets.

## Developing

```bash
npm install
npm run dev            # worker
npm run typecheck
npm run test
```

> Testing tip: by default `npm test` runs in a plain Node environment, which works inside sandboxes. Set `VITEST_CLOUDFLARE_POOL=on npm test` if you need to exercise the Cloudflare Workers pool via Wrangler.

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

# Skip DNS MX lookups (useful when offline)
npm run cli features:export -- --skip-mx
```

Use the resulting CSV with `npm run tree:train` for automated training (see `docs/DECISION_TREE.md`).

> MX-derived features hit Cloudflare’s DNS-over-HTTPS endpoint (`cloudflare-dns.com`). The exporter does that automatically; if you’re offline or testing without network access, pass `--skip-mx` so the CLI zeroes-out those columns instead of failing.

### One-liner training helper

```bash
# Export features, train the tree, and upload to KV (optional)
npm run cli tree:train -- \
  --input data/main.csv \
  --output config/production/decision-tree.$(date +%F).json \
  --label-column label \
  --max-depth 8 \
  --min-samples-leaf 30 \
  --upload
```

This runs the Bun feature exporter, trains the decision tree with scikit-learn (via Python subprocess), and (when `--upload` is passed) pushes the JSON to `decision_tree.json` in the `CONFIG` binding.

## Dashboard

The analytics dashboard has been rebuilt with modern tooling:

```bash
# Build dashboard (Astro + React)
cd dashboard
npm install
npm run build  # Output: ../public/dashboard/

# Development
npm run dev  # http://localhost:4321
```

**Features**:
- Real-time metrics (validations, block rate, latency, error rate)
- Block reasons distribution chart
- Time series visualization (hourly trends)
- Model performance metrics (accuracy, precision, recall, F1)
- Model comparison (baseline vs MX-enhanced)
- SQL query builder with export (CSV/JSON)
- Auto-refresh with persistence
- API key management with localStorage

**Access**:
- Local: `http://localhost:8787/dashboard/`
- Production: `https://fraud.erfi.dev/dashboard/`
