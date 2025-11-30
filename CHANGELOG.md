# Changelog

## [Unreleased]

### Detectors & Features
- Implemented the multilingual n-gram detector end-to-end: feature export, runtime middleware, and model inputs now emit `ngram_*` scores and risk signals to capture gibberish local parts.
- Added six new n-gram features to the normalized vector (bigram/trigram/overall scores, confidence, risk, naturalness flag) plus documentation/test coverage so training sets remain consistent.
- Built a reproducible 1M-row canonical dataset (`data/main.csv`) by cleaning the Enron corpus, generating 327,194 synthetic legit emails, and 500,000 synthetic fraud samples (exactly 50/50); documented the pipeline and shipped `data:enron:clean` for repeatable preprocessing.

### Model Pipeline
- Added Bun CLI wrappers for feature importance introspection (`model:analyze`) and RandomizedSearchCV-driven hyperparameter tuning (`model:tune`) along with the underlying Python helpers.
- Extended `model:train` to export per-feature importance maps, emit calibration datasets, and embed Platt-scaling coefficients directly into the Random Forest metadata.
- New `model:calibrate` command (wrapping `scripts/calibrate_scores.py`) produces calibrated probability columns plus logistic coefficients for auditing/plotting.

### Runtime Scoring
- Worker now reads `meta.calibration` and applies Platt scaling before comparing scores with the warn/block thresholds; Random Forest metadata schema updated accordingly.
- Introduced heuristic risk bumps (high-risk TLDs/domains, sequential/digit-heavy locals, plus-tag abuse, high Cloudflare bot scores) to shrink false negatives without increasing false positives.
- Raised production/default thresholds to `warn=0.60`, `block=0.85` (post-calibration) and log every heuristic adjustment for observability.

### Documentation & Ops
- Updated `docs/MODEL_TRAINING`, `docs/CALIBRATION`, `docs/SCORING`, and `config/production/README` with the new calibration, tuning, and deployment workflow.
- Trimmed legacy model files and documented the exact KV push commands for `random_forest.json`.

## 2025-11-30

### Model Training
- Added identity, geo-consistency, and MX telemetry end-to-end (middleware, feature vector, analytics, and webhook alerts)
- Introduced MX-enabled feature export + `npm run cli tree:train` helper for automated dataset generation, training, and KV uploads
- Fixed MX feature availability by awaiting the first lookup (with a short timeout) so training/runtime both see the real provider on cache misses
- Training MX-enhanced model with 144k rows, max_depth=8, min_samples_leaf=30

### Dashboard Rebuild
- Rebuilt analytics dashboard with Astro 5.16.3 + React 19.2.0 (replaces frozen analytics.html)
- Added 10 production-ready components: MetricsGrid, BlockReasonsChart, TimeSeriesChart, QueryBuilder, ModelMetrics, ModelComparison, ExportButton, ApiKeyInput, Dashboard wrapper
- Connected all components to real API endpoints with proper error handling
- Implemented UX improvements: Enter key support, auto-refresh persistence, HTTP status code error messages, mobile responsiveness
- Dashboard builds to `public/dashboard/` and served via Wrangler static assets
- Bundle size: 607 KB raw, 184 KB gzipped

### Documentation
- Updated all docs to reflect dashboard rebuild and remove deprecated `ml/` Python workflow
- Training now fully integrated into CLI via `npm run cli tree:train`
- Updated README, docs/README, docs/DECISION_TREE, docs/TRAINING, docs/CONFIGURATION
- Migration: Run `wrangler d1 migrations apply markov-mail` to pick up `0002_add_identity_geo_mx_columns.sql` before deploying
