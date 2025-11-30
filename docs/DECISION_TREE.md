# JSON Decision Trees

This document describes how the new decision-tree scoring pipeline works and how to train/ship a model.

---

## Runtime Expectations

* **Model location:** `CONFIG` KV key `decision_tree.json`
* **Schema:** each node is either a `"node"` with `feature`, `threshold`, optional `operator` (`<=` by default), `left`/`right`; or a `"leaf"` with `value` (`0..1`) and optional `reason`.
* **Features:** the worker builds a flat feature vector using `src/utils/feature-vector.ts`. Every field is numeric (booleans are converted to `0/1`). The default vector includes:
  * Plus-addressing risk buckets
  * Sequential pattern confidence
  * Linguistic metrics (pronounceability, vowel ratio, consonant clusters, syllable estimates…)
  * Structural metrics (segment counts, vowel-free segments…)
  * Statistical metrics (digit ratio, unique char ratio, entropy…)
  * Domain/TLD risk scores + hosted-platform flags
  * Identity/name vs. email similarity signals
  * Geo-consistency checks (IP vs. Accept-Language/timezone)
  * MX record presence + provider fingerprints (Google/Microsoft/self-hosted/etc.)

> Feel free to add more engineered features in TypeScript—just remember to regenerate your training dataset so the offline tree sees the same columns.

At runtime the middleware calls:

```ts
await loadDecisionTreeModel(c.env); // fetch once per isolate
const features = buildFeatureVector({ ... });
const result = evaluateDecisionTree(features);
```

If the model is missing or malformed the Worker logs `model_unavailable` and returns a 0 risk score (fail-open monitoring mode).

---

## Offline Flow
## Offline Flow

1. **One-liner** (recommended)
   * Run `npm run cli tree:train -- --input data/main.csv --output config/production/decision-tree.$(date +%F).json --upload`
   * This exports features, trains with scikit-learn (DecisionTreeClassifier), and uploads to KV
2. **Manual workflow**
   * Export: `npm run cli features:export -- --input data/main.csv --output data/features/export.csv`
   * Each row contains the exact keys emitted by `buildFeatureVector` plus a numeric `label` (0 legit, 1 fraud)
   * Train: Handled by CLI internally (`cli/commands/model/train.ts` calls Python)
   * Upload: `npm run cli kv:put -- --binding CONFIG decision_tree.json --file <path>`
3. **Promote**
   * Record the version in `INVENTORY.md` + `CHANGELOG.md`
   * Optionally run an A/B test (`npm run cli ab:create`) before switching all traffic

---
## JSON Template

See `config/production/decision-tree.example.json` for a tiny sample. Each leaf should include a `reason` so the Worker can explain its decision. Reasons double as analytics dimensions (we log the path + reason in D1).

---

## FAQ

**Q: Why decision trees instead of Markov chains?**  
A: The Markov implementation required megabytes of state in KV, duplicate feature extraction between runtime and training, and complicated calibration/ensemble logic. Decision trees let us encode the same heuristics + ML interactions in a single JSON file that loads instantly.

**Q: Can I still use forests/gradient boosting?**  
A: Yes—train whatever you like, then “compile” it down to a single decision tree (e.g., via model distillation) or export an ensemble of trees and average their leaves in JavaScript. The JSON schema is flexible enough to support multiple models if needed.

**Q: How do I roll back?**  
Upload the previous JSON to the KV key. The Worker always reads the latest version on cold start, so no redeploy is required.
