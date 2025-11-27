# System Status

**Last Updated**: 2025-01-12  
**Production URL**: https://your-worker.workers.dev  
**Version**: 2.4.2

---

## ✅ OPERATIONAL

Markov-first detection with OOD scoring + D1 analytics is healthy. All scheduled tasks running.

### Key Metrics (last 24h)
- **Accuracy**: 83% precision / 75% recall (sequential traffic routed to "warn")
- **Latency**: 35ms p50 / 68ms p95
- **Worker Startup**: 3ms
- **Uptime**: 99.9%

### Active Components
- ✅ Markov Chain Models (2-gram + 3-gram) loaded from `MARKOV_MODEL`
- ✅ KV Namespaces: `CONFIG`, `MARKOV_MODEL`, `DISPOSABLE_DOMAINS_LIST`, `TLD_LIST`
- ✅ D1 Databases: `DB` (validations/admin) + `ANALYTICS` (reporting)
- ✅ Scheduled Tasks: Disposable domain refresh (6h)
- ✅ A/B Pipeline: `ab_test_config` key + `/admin/ab-test/status` powering dashboard experiment card

### Recent Changes (v2.4.2)
- Clarified scoring hooks (dated + plus-addressing risk + sequential overrides when confidence clears threshold; sub-threshold hits stay telemetry-only)
- Added configurable domain/TLD weights + professional email adjustments
- Migrated docs to D1 terminology

See [SCORING.md](./SCORING.md) for the full risk model and [ANALYTICS.md](./ANALYTICS.md) for D1 query tips.
