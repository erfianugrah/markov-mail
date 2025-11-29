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
  * Domain/TLD risk scores

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

1. **Export features**
   * Run `npm run cli features:export -- --input data/main.csv --output data/features/export.csv`.
   * Each row in the output CSV contains the exact keys emitted by `buildFeatureVector` plus a numeric `label` (`0` legit, `1` fraud).
2. **Train**
   * Use scikit-learn (DecisionTreeClassifier, RandomForest, GradientBoosting) or any framework you prefer.
   * Keep depth reasonable (5‑10) so the JSON stays small and edge latency remains <1 ms.
3. **Export**
   * Convert the trained estimator into the JSON schema above.
   * Store the artifact under `config/production/decision-tree.example.json` for reference and upload it to KV.
4. **Promote**
   * Record the version in `INVENTORY.md` + `CHANGELOG.md`.
   * Optionally run an A/B test (`ab:*` CLI commands) before switching all traffic.

---

## Reference Script (`ml/export_tree.py`)

```python
import argparse
import json
import pandas as pd
from sklearn.tree import DecisionTreeClassifier

def node_to_json(tree, feature_names, node_id=0):
    feature = tree.feature[node_id]
    if feature == -2:
        proba = tree.value[node_id][0][1] / tree.value[node_id][0].sum()
        return {"type": "leaf", "value": float(proba)}

    threshold = float(tree.threshold[node_id])
    return {
        "type": "node",
        "feature": feature_names[feature],
        "threshold": threshold,
        "operator": "<=",
        "left": node_to_json(tree, feature_names, tree.children_left[node_id]),
        "right": node_to_json(tree, feature_names, tree.children_right[node_id]),
    }

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", required=True, help="CSV with features + label column")
    parser.add_argument("--output", default="decision_tree.json")
    parser.add_argument("--max-depth", type=int, default=6)
    args = parser.parse_args()

    df = pd.read_csv(args.dataset)
    feature_cols = [col for col in df.columns if col not in ("label", "y")]

    clf = DecisionTreeClassifier(
        max_depth=args.max_depth,
        min_samples_leaf=50,
        random_state=42,
    )
    clf.fit(df[feature_cols], df["label"])

    tree_json = node_to_json(clf.tree_, feature_cols)

    with open(args.output, "w") as f:
        json.dump(tree_json, f, indent=2)

    print(f"Saved decision tree to {args.output}")

if __name__ == "__main__":
    main()
```

### Usage

```bash
cd ml
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt  # (create if you want to pin sklearn/pandas)

python export_tree.py \
  --dataset ../data/features/training_features.csv \
  --output ../config/production/decision-tree.2025-01-15.json \
  --max-depth 6

# Upload to KV
npm run cli kv:put -- \
  --binding CONFIG \
  decision_tree.json \
  --file ../config/production/decision-tree.2025-01-15.json
```

> **Tip:** keep the exported JSON under version control so you can diff paths/reasons between releases.

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
