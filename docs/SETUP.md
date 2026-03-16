# First-Time Setup Guide

Deploy Markov Mail from scratch in under 10 minutes.

## Prerequisites

- Node.js 18+ and npm
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) authenticated (`npx wrangler login`)
- A Cloudflare account (free tier works)
- (Optional) [Bun](https://bun.sh/) for CLI tooling and local training
- (Optional) Python 3.10+ for the offline training pipeline

## Quick Start (Automated)

```bash
git clone https://github.com/erfianugrah/markov-mail.git
cd markov-mail
npm install
cd dashboard && npm install && cd ..

# Create KV namespaces, D1 database, apply migrations, upload config + model
bash scripts/setup.sh

# Set your API key (protects admin endpoints and dashboard)
npx wrangler secret put X-API-KEY
# Paste a key generated with: openssl rand -hex 32

# Build and deploy
npm run deploy
```

Your worker is now live. Test it:

```bash
curl -s -X POST https://your-worker.workers.dev/validate \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}' | jq
```

## Manual Setup (Step by Step)

### 1. Install dependencies

```bash
npm install
cd dashboard && npm install && cd ..
```

### 2. Create Cloudflare resources

```bash
# KV namespaces
npx wrangler kv namespace create CONFIG
npx wrangler kv namespace create DISPOSABLE_DOMAINS_LIST
npx wrangler kv namespace create TLD_LIST

# D1 database
npx wrangler d1 create markov-db
```

### 3. Update wrangler.jsonc

Replace the placeholder IDs in `wrangler.jsonc` with the IDs returned above:

```jsonc
"kv_namespaces": [
  { "binding": "CONFIG",                  "id": "<your CONFIG id>" },
  { "binding": "DISPOSABLE_DOMAINS_LIST", "id": "<your DISPOSABLE id>" },
  { "binding": "TLD_LIST",                "id": "<your TLD id>" }
],
"d1_databases": [
  { "binding": "DB", "database_name": "markov-db", "database_id": "<your D1 id>" }
]
```

Optionally update the `routes` section with your custom domain, or remove it to use `*.workers.dev`.

### 4. Apply D1 migrations

```bash
npx wrangler d1 migrations apply markov-db --remote
```

### 5. Upload config and model to KV

```bash
# Get your CONFIG namespace ID from step 2
NAMESPACE_ID="<your CONFIG id>"

npx wrangler kv key put config.json \
  --path config/production/config.json \
  --namespace-id "$NAMESPACE_ID" --remote

npx wrangler kv key put random_forest.json \
  --path config/production/random-forest.json \
  --namespace-id "$NAMESPACE_ID" --remote
```

### 6. Set secrets

```bash
# Required: admin API key
npx wrangler secret put X-API-KEY

# Optional: alert webhook (Slack/Teams)
npx wrangler secret put ALERT_WEBHOOK_URL
```

### 7. Build and deploy

```bash
npm run deploy
```

### 8. Verify

```bash
# Health check (requires API key)
curl https://your-worker.dev/admin/health -H "X-API-Key: YOUR_KEY"

# Validate an email (public, no auth needed)
curl -s -X POST https://your-worker.dev/validate \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}' | jq .decision

# Open the dashboard
open https://your-worker.dev/dashboard
```

## What's Included Out of the Box

| Component | Details |
|-----------|---------|
| **Pre-trained model** | 20-tree Random Forest, 48 features, Platt-calibrated (v5.0.0) |
| **Thresholds** | warn >= 0.56, block >= 0.88 (calibrated on 50k samples) |
| **Dashboard** | Astro + React analytics UI at `/dashboard` |
| **API docs** | Full endpoint reference at `/` |
| **Rate limiting** | Enabled by default (60/min, 1000/hr) |
| **Cron jobs** | Disposable domain updates (6h), model retraining (weekly) |
| **71k+ disposable domains** | Auto-updated from GitHub sources |

## What You'll Need to Customize

| Setting | Location | Why |
|---------|----------|-----|
| Custom domain | `wrangler.jsonc` `routes` | Default uses `*.workers.dev` |
| Thresholds | `config/production/config.json` or `/admin/config` API | Tune for your FP/FN tolerance |
| Alert webhook | `wrangler secret put ALERT_WEBHOOK_URL` | Get notified on anomalies |

## Local Development

```bash
# Copy dev secrets
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your test API key

# Run worker locally
npm run dev

# Run dashboard dev server
cd dashboard && npm run dev

# Run tests
npm run test:unit
npm run typecheck
```

## Training Your Own Model

### Using the container pipeline (recommended)

The worker collects feature vectors from live traffic into D1. Once you have enough data:

```bash
# Check dataset size
curl https://your-worker.dev/admin/training/dataset -H "X-API-Key: KEY"

# Trigger retraining (runs in a Cloudflare Container)
curl -X POST https://your-worker.dev/admin/training/trigger \
  -H "X-API-Key: KEY" \
  -H "Content-Type: application/json" \
  -d '{"nTrees":20,"maxDepth":6}'
```

### Using the offline pipeline

```bash
# 1. Generate synthetic data
npm run cli -- data:synthetic -- --count 100000 --legit-ratio 0.55 --seed 2026

# 2. Export features
npm run cli -- features:export -- --input data/main.csv --output data/features/export.csv --shuffle

# 3. Train (Python — requires pip install -r requirements.txt)
python3 cli/commands/model/train_forest.py \
  --dataset data/features/export.csv \
  --output config/production/random-forest.json \
  --n-trees 20 --max-depth 6 --no-split --version "my-model"

# 4. Upload
npx wrangler kv key put random_forest.json \
  --path config/production/random-forest.json \
  --namespace-id "$CONFIG_ID" --remote
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `D1 binding 'DB' references database which was not found` | Run `npx wrangler d1 create markov-db` and update `database_id` in `wrangler.jsonc` |
| `Admin API is not enabled` | Run `npx wrangler secret put X-API-KEY` |
| Dashboard shows login page | Enter your API key at the login prompt |
| Model not loading | Upload `random-forest.json` to CONFIG KV (see step 5) |
| High false positive rate | Retrain with your own data or adjust `riskThresholds.block` upward |

## See Also

- [Architecture](./ARCHITECTURE.md)
- [Configuration](./CONFIGURATION.md)
- [Model Training](./MODEL_TRAINING.md)
- [Operations](./OPERATIONS.md)
- [API Reference](https://fraud.erfi.dev/)
