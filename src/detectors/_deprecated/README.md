# Deprecated Detectors

This folder contains detector modules that have been deprecated or removed from active use.

## Files

### `markov-ensemble.ts`
- **Status**: Never implemented
- **Reason**: Planned feature that was never completed
- **Replacement**: None (feature cancelled)
- **Date Deprecated**: 2025-01-07

### `signal-aggregator.ts`
- **Status**: Replaced
- **Reason**: Complex multi-signal voting system caused more problems than it solved
- **Replacement**: Markov-first approach in `fraud-detection.ts`
- **Date Deprecated**: 2025-01-07
- **Notes**: The Markov model (trained on 91K emails) now takes precedence over heuristic detectors. Signal aggregation logic was simplified to respect the trained model's judgment.

## Kept but Not Exported

These files are still in use internally but are no longer exported from the main index:

- `sequential.ts` - Used internally by `pattern-family.ts`
- `dated.ts` - Used internally by `pattern-family.ts`
- `markov-chain.ts` - Replaced by `ngram-markov.ts` (kept for backwards compatibility)
- `ngram-multilang.ts` - Used internally by `ngram-analysis.ts`

## Archive Policy

Deprecated files are kept for:
1. Historical reference
2. Understanding system evolution
3. Potential future analysis

Files may be permanently deleted after 6 months if no longer referenced.
