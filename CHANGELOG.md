# Changelog

## [Unreleased]

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
