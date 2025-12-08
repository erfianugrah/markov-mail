# Remediation Plan – Fraud Detection Logic

## Objectives
- Harden middleware so non-email POSTs are not blocked and bodies aren’t consumed twice.
- Improve data quality in metrics writes and model outage handling.
- Reduce latency/KV pressure through better caching.
- Re-evaluate fraud signal efficacy and note follow-ups.

## Work Items
- Middleware request parsing: branch by `content-type`, clone/tee the stream, and only fall back to `next()` when no email is present. Add tests for JSON, form-data, and invalid bodies.
- Missing email handling: treat absent `email` as a no-op (pass-through) except on `/validate`; align docs and headers.
- Metrics nullability: bind `null` for unknown boolean/optional signals (e.g., MX, disposable, bot flags) instead of forcing `0`.
- Model degradation: when decision models are unavailable or evaluation fails, return `warn` at minimum, surface a distinct reason, and emit alert/metric for ops.
- Caching: add per-worker caches for config, heuristics, and models with explicit admin cache-bust hooks; measure P95 latency before/after.

## Testing & Validation
- Unit: middleware parsing/flow, metrics binding, model-fallback decisions.
- Integration (worker): POST permutations (JSON/form-data/malformed) and model-missing scenarios.
- Regression: ensure `/validate` behavior unchanged; confirm headers set correctly for A/B metadata.

## Fraud Detection Efficacy Notes
- Signals cover format, entropy, disposable/TLD, MX, n-gram, identity, geo, and bot score; strong coverage but outages and null coercion risk blind spots.
- Random Forest/Decision Tree selection is brittle; consider retaining last-good scores and tracking feature drift in D1.
- Disposable/TLD lists rely on KV freshness; schedule health checks and cache version headers in metrics to trace staleness.
