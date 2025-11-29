# Scoring Overview (Work in Progress)

The scoring engine is being rebuilt around a JSON-backed decision tree. Until the exporter and feature catalog are finalized, all you need to know is:

1. The Worker extracts a deterministic feature vector (see `src/utils/feature-vector.ts`). Every feature is numeric and stable between runtime and training.
2. A decision tree exported from Python evaluates those features and returns a risk score in `[0,1]` plus a human-readable reason.
3. Hard blockers (invalid format, disposable domains) still short-circuit before the tree runs.

Future sections will document:

- The full feature list (column descriptions and ranges)
- How to run the feature-export CLI
- How to interpret decision-tree paths in logs/D1

For now refer to `docs/DECISION_TREE.md` for the latest training/export instructions.
