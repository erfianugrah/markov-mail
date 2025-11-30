# Detectors

Only a subset of the previous detectors remain:

| Category | Source |
|----------|--------|
| Plus-addressing normalization & risk | `src/detectors/plus-addressing.ts` |
| Sequential and dated pattern detectors | `src/detectors/sequential.ts`, `src/detectors/dated.ts` |
| Pattern family aggregator (hashes structures) | `src/detectors/pattern-family.ts` |
| Linguistic & structural features | `src/detectors/linguistic-features.ts` |
| Multi-language n-gram naturalness | `src/detectors/ngram-analysis.ts`, `src/detectors/ngram-multilang.ts` |
| TLD risk profiling | `src/detectors/tld-risk.ts` |
| Benford’s law batch analysis | `src/detectors/benfords-law.ts` |
| Identity / name similarity signals | `src/utils/identity-signals.ts` |
| Geo-consistency + MX resolver | `src/utils/geo-signals.ts`, `src/services/mx-resolver.ts` |

All of these feed into the decision-tree feature builder—none of them produce risk scores directly anymore. If you delete or replace one, make sure the feature list stays in sync with `src/utils/feature-vector.ts`.

If you add a new detector, make sure:

1. It returns simple numeric/boolean features.
2. You thread those features into `buildFeatureVector` so they’re available both at runtime and during offline training.
