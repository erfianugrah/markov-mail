# Markov Mail

Email fraud detection API running on Cloudflare Workers. Scores email addresses in real-time using a 48-feature Random Forest classifier with Platt-calibrated probabilities.

## Quick Start

```bash
git clone https://github.com/erfianugrah/markov-mail.git
cd markov-mail
npm install && cd dashboard && npm install && cd ..

# Automated setup: creates KV, D1, uploads config + model
bash scripts/setup.sh

# Set your admin API key
npx wrangler secret put X-API-KEY

# Deploy
npm run deploy
```

Test it:

```bash
curl -s -X POST https://your-worker.workers.dev/validate \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}' | jq
```

See [docs/SETUP.md](docs/SETUP.md) for the full step-by-step guide.

## What You Get

| Feature | Details |
|---------|---------|
| **48-feature ML scoring** | Linguistic, structural, n-gram, identity, geo, MX, TLD, domain reputation |
| **Pre-trained model** | 20-tree RF, Platt-calibrated, 98.6% fraud detection, 0.4% false negatives |
| **Real-time API** | `POST /validate` — sub-20ms P50 latency, no auth required |
| **Analytics dashboard** | Astro + React UI at `/dashboard` with time series, score distributions, SQL query builder |
| **44 admin endpoints** | Config management, analytics, TLD profiles, model deployment, cache control |
| **Auto-retraining** | Container-based pipeline trains on live traffic data, weekly via cron |
| **71k+ disposable domains** | Auto-updated every 6 hours from GitHub sources |
| **Rate limiting** | Per-IP throttling enabled by default |

## How It Works

```
Request → Feature Extraction (48 signals) → Random Forest → Platt Calibration → Decision
                                                                                   ↓
                                                              allow (<0.56) / warn (0.56-0.87) / block (≥0.88)
```

1. Extract **48 features** from the email address — entropy, n-gram naturalness, digit position, year suffix detection, MX records, TLD risk, identity signals
2. Evaluate with a **Random Forest** (20 trees, max depth 6) loaded from KV
3. Apply **Platt scaling** to convert tree votes into calibrated probabilities
4. Compare against **configurable thresholds** to decide allow/warn/block

## Architecture

```
src/                  Worker runtime (middleware, detectors, models, services)
config/production/    Production config + trained model (committed, KV-uploadable)
cli/                  Bun-powered training, calibration, deployment tools
dashboard/            Astro + React analytics UI (builds to public/dashboard/)
container/            Dockerfile + entrypoint for automated retraining
docs/                 Full documentation
tests/                Vitest unit/integration/e2e/performance tests
migrations/           D1 schema migrations
```

## Development

```bash
cp .dev.vars.example .dev.vars     # configure local secrets
npm run dev                         # run worker locally
npm run typecheck                   # strict TypeScript gate
npm run test:unit                   # 280 tests
npm run build:dashboard             # build dashboard
```

## Training

### Container pipeline (recommended — uses live traffic data)

```bash
# Trigger via admin API
curl -X POST https://your-worker.dev/admin/training/trigger \
  -H "X-API-Key: KEY" -H "Content-Type: application/json" \
  -d '{"nTrees":20,"maxDepth":6}'
```

### Offline pipeline (synthetic data)

```bash
npm run cli -- data:synthetic -- --count 100000 --legit-ratio 0.55 --seed 2026
npm run cli -- features:export -- --input data/main.csv --output data/features/export.csv --shuffle
python3 cli/commands/model/train_forest.py \
  --dataset data/features/export.csv --output config/production/random-forest.json \
  --n-trees 20 --max-depth 6 --no-split --version "my-model"
```

See [docs/MODEL_TRAINING.md](docs/MODEL_TRAINING.md) for the full reference.

## Documentation

- **[Setup Guide](docs/SETUP.md)** — First-time deployment
- **[Tuning Guide](docs/TUNING.md)** — Improve accuracy by correcting labels and adjusting thresholds
- **[Architecture](docs/ARCHITECTURE.md)** — System design and data flow
- **[Configuration](docs/CONFIGURATION.md)** — Runtime config, thresholds, feature flags
- **[Model Training](docs/MODEL_TRAINING.md)** — Training pipeline reference
- **[Detectors](docs/DETECTORS.md)** — Feature extraction reference (48 features)
- **[Scoring](docs/SCORING.md)** — Scoring engine and calibration
- **[Operations](docs/OPERATIONS.md)** — Deployment, monitoring, rollback
- **[Abuse Operations](docs/abuse-ops.md)** — Shared abuse-ops framework + verified-gaps audit for the combined forminator + markov-mail system
- **[Troubleshooting](docs/TROUBLESHOOTING.md)** — Common issues and diagnostics
- **[API Reference](https://fraud.erfi.dev/)** — Full endpoint documentation

## License

Private repository.
