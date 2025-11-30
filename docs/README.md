# 📚 Documentation Index (Reset)

This branch is the decision-tree reboot of Markov Mail. Everything in this folder tracks the new baseline; the legacy write-ups were deleted.

## ✅ Active References

| Document | Description |
|----------|-------------|
| **[../README.md](../README.md)** | Project overview + current goals. |
| **[RELEASE_2025-11-30.md](RELEASE_2025-11-30.md)** | **Latest release notes: MX-enhanced model + dashboard rebuild.** |
| **[SYSTEM_INVENTORY.md](SYSTEM_INVENTORY.md)** | Complete system inventory with file details and git status. |
| **[ARCHITECTURE.md](ARCHITECTURE.md)** | High-level view of the slimmed-down Worker + offline tooling. |
| **[DETECTORS.md](DETECTORS.md)** | Inventory of the feature extractors that still exist. |
| **[SCORING.md](SCORING.md)** | Snapshot of the decision-tree based scoring flow. |
| **[TRAINING.md](TRAINING.md)** | Minimal training/checklist for exporting trees. |
| **[DECISION_TREE.md](DECISION_TREE.md)** | Detailed exporter instructions + schema. |
| **[API_DECISION_TREE.md](API_DECISION_TREE.md)** | Lightweight request/response quickstart for the reset Worker. |
| **[CONFIGURATION.md](CONFIGURATION.md)** | How to ship `config.json` + `decision_tree.json` via KV. |
| **[CALIBRATION.md](CALIBRATION.md)** | Quick reminder that calibration happens offline now (no runtime knobs). |
| **[INVENTORY.md](../INVENTORY.md)** | Placeholder for the current decision-tree artifact inventory. |
| **[CLI/README](../cli/README.md)** | Current CLI quickstart (deploy/config/analytics + feature export). |

The legacy docs have been removed from this branch. If you need to reference them, check the git history (pre-reset tags) or your favorite archive.

### Risk Scoring Strategy

This reset branch uses a single JSON decision tree loaded from KV:

1. Middleware assembles a deterministic feature vector (plus-risk, sequential confidence, linguistic/structural stats, domain reputation, entropy, etc.).
2. `decision_tree.json` is fetched once per isolate and cached for ~60s; leaves carry both the probability (`value`) and a human-readable `reason`.
3. Hard blockers (invalid format, disposable domains) short-circuit before the tree. Otherwise, the leaf score (`0..1`) is compared against the configured warn/block thresholds.

The Worker logs `decisionTreeReason`, `decisionTreePath`, and `modelVersion` so you can audit every block/warn. See [SCORING.md](SCORING.md) + [DECISION_TREE.md](DECISION_TREE.md) for details.

---

## 🔧 Command Line Interface

**43 commands across 6 categories** - See **[CLI Reference](../cli/README.md)** for complete documentation.

### Quick Reference

```bash

# Show all commands
npm run cli

# Feature Export & Model Upload
npm run cli features:export -- --input data/main.csv --output data/features/export.csv
npm run cli tree:train -- --input data/main.csv --output config/production/decision-tree.latest.json --upload
npm run cli kv:put -- --binding CONFIG decision_tree.json --file config/production/decision-tree.latest.json

# Deployment
npm run cli deploy --minify           # Deploy to Cloudflare
npm run cli deploy:status             # Check deployment status

# Data Management (KV & D1)
npm run cli kv:list --binding CONFIG  # List KV keys
npm run cli kv:get <key>              # Get KV value
npm run cli analytics:query <sql>     # Run D1 SQL via /admin/analytics
npm run cli analytics:stats --last 24 # Built-in analytics summaries

# Testing
npm run cli test:api <email>          # Test API endpoint
npm run cli test:detectors            # Test pattern detectors
npm run cli test:generate --count 100 # Generate test data

# A/B Testing
npm run cli ab:create                 # Create experiment
npm run cli ab:analyze                # Analyze results
npm run cli ab:stop                   # Stop experiment

# Configuration
npm run cli config:list               # List all config
npm run cli config:sync --remote      # Sync to production
```

**For detailed usage, workflows, and examples:** See [CLI Reference](../cli/README.md).

## 📊 Analytics Dashboard

The analytics dashboard has been rebuilt with Astro + React and includes:

- **Real-time Metrics** – validations, block rate, latency, error rate (auto-refresh every 30s)
- **Block Reasons** – distribution chart showing top 10 reasons with percentages
- **Time Series** – hourly trends visualization (blocks, warns, allows)
- **Model Performance** – accuracy, precision, recall, F1 score, confusion matrix
- **Model Comparison** – side-by-side baseline vs MX-enhanced performance
- **Query Builder** – SQL editor with 4 preset queries and CSV/JSON export
- **Identity Similarity** – groups validations into strong/partial/mismatch buckets
- **Geo Consistency** – highlights language/timezone mismatches vs IP country
- **MX Providers** – shows dominant MX providers plus average risk per provider

All panels read from `/admin/analytics` (see `src/database/queries.ts`). Enter your admin API key in the dashboard UI to populate charts.

**Access**:
- Local: `http://localhost:8787/dashboard/`
- Production: `https://fraud.erfi.dev/dashboard/`

**Build**: `cd dashboard && npm run build` (outputs to `public/dashboard/`)

## 🗄️ Database Migrations

Identity/geo/MX telemetry lives in the `validations` table. Apply the migrations anytime you pull a new release:

```bash
wrangler d1 migrations apply markov-mail
```

That command will re-run the reset migration plus `0002_add_identity_geo_mx_columns.sql`, so existing D1 databases gain the new columns without data loss. Run it before deploying Workers that emit the new metrics.

The sections that used to live here (detection capabilities, analytics, long-form release notes) were deleted with the reset. New write-ups will land once the decision-tree workflow stabilizes.

---

**Production URL**: https://your-worker.workers.dev
**Last Updated**: 2025-01-12
