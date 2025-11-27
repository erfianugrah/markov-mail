# Project Structure

**Last Updated**: 2025-01-17

## Directory Layout

```
markov-mail/
├── src/                      # Worker source
│   ├── detectors/            # Pattern detectors (active + legacy)
│   ├── middleware/          # Fraud pipeline (`fraud-detection.ts`)
│   ├── services/            # Updaters (disposable domains, TLD lists)
│   ├── training/            # Online/CLI training helpers
│   ├── utils/               # Shared helpers (metrics, calibration, etc.)
│   └── index.ts             # Cloudflare Worker entrypoint
├── cli/                     # Bun-powered operational commands
├── dashboard/               # Vite/React analytics UI (builds to `dashboard/dist`)
├── dataset/                 # Sample + compiled training CSVs
├── docs/                    # Contributor + operator docs (22 Markdown files)
├── tests/                   # Vitest suites (`unit/`, `integration/`, `e2e/`, `performance/`, `fixtures/`)
├── public/                  # Static assets served via Wrangler
├── config/production/       # Shipping KV config, calibration, Markov models
├── migrations/              # D1 schema migrations
├── scripts/                 # Data-labeling + automation scripts
├── wrangler.jsonc           # Cloudflare bindings (CONFIG, MARKOV_MODEL, DISPOSABLE_DOMAINS_LIST, TLD_LIST, DB)
├── package.json             # Scripts + dependencies
├── tsconfig.json            # TS compiler options (ES2022, strict)
└── README.md / CHANGELOG.md # High-level docs
```

## Detection Modules

- `src/detectors/ngram-markov.ts` – Trains/loads the Markov models used by `src/index.ts`; this stays the primary scoring signal.
- `src/detectors/pattern-family.ts` – Wraps `sequential.ts` and `dated.ts` to classify email structures; sequential risk is reintroduced in `middleware/fraud-detection.ts` when confidence clears `config.patternThresholds.sequential`.
- `src/detectors/plus-addressing.ts` – Normalizes aliases and emits a deterministic risk score for alias abuse.
- `src/detectors/tld-risk.ts` + `services/tld-risk-updater.ts` – TLD reputation tables loaded from KV.
- `src/detectors/benfords-law.ts` – Batch/analytics helper for large attack bursts.
- `src/detectors/ngram-analysis.ts` + `ngram-multilang.ts` – Linguistic helpers still used for telemetry and calibration features.
- `_deprecated/` + `keyboard-mashing.ts`/`keyboard-walk.ts` remain for research, but exports are disabled in `detectors/index.ts` and no longer influence scoring.

## Documentation Inventory (`docs/`)

Current Markdown guides (run `ls docs` to verify):
- **Onboarding**: `README.md`, `QUICK_START.md`, `GETTING_STARTED.md`, `FIRST_DEPLOY.md`
- **Architecture & Detection**: `ARCHITECTURE.md`, `DETECTORS.md`, `SCORING.md`, `MARKOV_CHAIN_DIAGRAMS.md`, `OOD_DETECTION.md`
- **API & Integration**: `API.md`, `INTEGRATION_GUIDE.md`, `RPC-INTEGRATION.md`
- **Operations & Config**: `CONFIGURATION.md`, `CALIBRATION.md`, `DATASETS.md`, `DB_OPERATIONS.md`, `SCHEMA-INITIALIZATION.md`, `SYSTEM_STATUS.md`, `ANALYTICS.md`, `LOGGING_STANDARDS.md`, `TESTING.md`, `TRAINING.md`, `PROJECT_STRUCTURE.md`

If you add a new doc, link it from `docs/README.md` and the root `README.md` to keep navigation consistent.

## Tests & Tooling

- `tests/unit` covers detectors, config loaders, calibration, etc.
- `tests/integration` exercises scoring paths and configuration merges.
- `tests/e2e` runs Worker-style API checks (many rely on `env.SELF`).
- `tests/performance` contains load/latency harnesses; keep data volumes small so Vitest runs locally.
- CLI entrypoint (`cli/index.ts`) exposes commands such as `training:extract`, `train:markov`, `train:calibrate`, `analytics:*`, and `ab:*`. Invoke via `npm run cli <command>`.

## Configuration & Deploy

- `config/production/config.json` and `calibration.json` mirror what ships to Cloudflare KV (`CONFIG` + `MARKOV_MODEL`).
- `wrangler.jsonc` defines the production route (`fraud.erfi.dev`), KV namespaces, and the D1 database binding `DB`. Replace IDs/domains with your own before publishing.
- `src/config/defaults.ts` documents every configurable field; `CONFIG` KV overrides defaults, and secrets (e.g., `X-API-KEY`) flip the admin features on.

## Datasets & Models

- `dataset/training_compiled/training_compiled.csv` is the canonical aggregated dataset (89k+ rows). Use it with `npm run cli training:extract` + `train:markov`/`train:calibrate` when regenerating models.
- Pre-built Markov artifacts live under `config/production/markov_*gram.json`; upload them to the `MARKOV_MODEL` namespace (keys `MM_legit_2gram`, etc.) to match the worker expectations in `src/index.ts`.

---

For deeper walkthroughs, start with `docs/README.md` and the root `README.md` quick links.
