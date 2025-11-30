# Changelog

## [Unreleased]

## 2025-11-30
- Added identity, geo-consistency, and MX telemetry end-to-end (middleware, feature vector, analytics, and webhook alerts). Run `wrangler d1 migrations apply markov-mail` to pick up `0002_add_identity_geo_mx_columns.sql` before deploying.
- Introduced MX-enabled feature export + `npm run tree:train` helper so dataset generation, training, and KV uploads stay in sync.
- Updated docs/dashboards to cover the new signals, plus CHANGELOG/CONFIGURATION guidance for ALERT_WEBHOOK and MX toggles.
- Fixed MX feature availability by awaiting the first lookup (with a short timeout) so training/runtime both see the real provider on cache misses.
