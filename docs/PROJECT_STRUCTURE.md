# Project Structure

```
markov-mail/
├── src/                  # Worker runtime (middleware, detectors, services, models, utils)
│   ├── middleware/       # Fraud detection middleware with model evaluation
│   ├── detectors/        # Plus-addressing, pattern families, linguistic/TLD helpers
│   ├── models/           # Model evaluators (Random Forest, Decision Tree) + cache utilities
│   ├── services/         # KV-backed updaters (disposable domains, TLD risk, MX resolver)
│   ├── utils/            # Shared helpers (feature vector builder, metrics, identity/geo signals)
│   └── routes/           # `/admin` API + debug endpoints
├── cli/                  # Bun CLI (`npm run cli <command>`)
│   ├── commands/         # Deploy, KV, analytics, AB testing, feature exporter, model training
│   └── utils/            # CLI utilities (known MX providers, logger, args parser)
├── dashboard/            # Astro + React dashboard source (builds to public/dashboard/)
├── config/production/    # Production configuration and trained models
├── public/dashboard/     # Built dashboard bundle served as static assets
├── docs/                 # Project documentation
├── tests/                # Vitest suites (unit, integration, e2e, performance)
├── public/               # Static assets served via Wrangler
├── migrations/           # D1 database migrations
├── wrangler.jsonc        # Cloudflare bindings (CONFIG, DISPOSABLE_DOMAINS_LIST, TLD_LIST, DB)
├── package.json          # npm scripts + dependencies
└── README.md             # Project overview
```

## Key Bindings

| Binding | Purpose |
|---------|---------|
| `CONFIG` | Holds `config.json`, `random_forest.json`, and `decision_tree.json` |
| `DISPOSABLE_DOMAINS_LIST` | KV namespace populated by the disposable-domain updater |
| `TLD_LIST` | KV namespace populated by the TLD risk updater |
| `DB` | Cloudflare D1 database storing validation metrics |

## Model Training Workflow

Train models using the unified CLI command:

```bash
# Train Random Forest (20 trees) and upload to KV
npm run cli model:train -- --n-trees 20 --upload --kv-key random_forest.json

# Train Decision Tree (1 tree) and upload to KV
npm run cli model:train -- --n-trees 1 --upload --kv-key decision_tree.json
```

Or manually:
1. Export features: `npm run cli features:export -- --input data/main.csv --output data/features/export.csv`
2. Train model with CLI (internally uses Python/scikit-learn)
3. Upload: `npm run cli kv:put -- --binding CONFIG --key <model_key> --file <model_file>`

For detailed training instructions, see [MODEL_TRAINING.md](./MODEL_TRAINING.md).
