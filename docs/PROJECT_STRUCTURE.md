# Project Structure (Decision-Tree Reset)

```
markov-mail/
├── src/                  # Worker runtime (middleware, detectors, services, models, utils)
│   ├── middleware/       # `fraud-detection.ts` (decision-tree scoring pipeline)
│   ├── detectors/        # Plus-addressing, pattern families, linguistic/TLD helpers
│   ├── models/           # Decision-tree evaluator + cache utilities
│   ├── services/         # KV-backed updaters (disposable domains, TLD risk)
│   ├── utils/            # Shared helpers (feature vector builder, metrics, etc.)
│   └── routes/           # `/admin` API + debug endpoints
├── cli/                  # Bun CLI (`npm run cli <command>`)
│   └── commands/         # Deploy, KV, analytics, AB testing, feature exporter, tree training (with Python)
├── dashboard/            # Astro + React dashboard source (builds to public/dashboard/)
├── config/production/    # Shipping `config.json` + decision-tree artifacts
├── public/dashboard/     # Built dashboard bundle served as static assets
├── docs/                 # Active decision-tree docs (legacy content removed in this reset)
├── tests/                # Vitest suites (unit, integration, e2e, performance)
├── public/               # Static assets served via Wrangler
├── migrations/           # D1 database migrations
├── wrangler.jsonc        # Cloudflare bindings (CONFIG, DISPOSABLE_DOMAINS_LIST, TLD_LIST, DB)
├── package.json          # npm scripts + dependencies
└── README.md             # Project overview + next steps
```

### Key Bindings

| Binding | Purpose |
|---------|---------|
| `CONFIG` | Holds `config.json` and `decision_tree.json`. |
| `DISPOSABLE_DOMAINS_LIST` | KV namespace populated by the disposable-domain updater. |
| `TLD_LIST` | KV namespace populated by the TLD risk updater. |
| `DB` | Cloudflare D1 database storing validation metrics. |

### Model Workflow

1. One-liner: `npm run cli tree:train -- --input data/main.csv --output config/production/decision-tree.$(date +%F).json --upload`
2. Or manually:
   - Export features: `npm run cli features:export`
   - Train (handled by CLI internally via Python/scikit-learn)
   - Upload: `npm run cli kv:put -- --binding CONFIG decision_tree.json --file ...`

That’s it—no pre-reset calibration artifacts remain on this branch.
