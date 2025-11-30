# Training Data Directory

This directory stores the *single* canonical CSV used for every retraining cycle. All other artefacts (train/val/test splits, relabeled datasets, domain exports, etc.) must be generated on demand to avoid stale copies drifting away from production.

## Layout

```
data/
├── README.md     # This file
├── main.csv      # Canonical labeled dataset (synthetic)
└── fraudulent-emails.json  # Regenerated test harness fixture (npm run cli test:generate)
```

If you need derived files (`train.csv`, `test.csv`, domain lists, etc.) generate them locally and keep them untracked. The new deterministic CLI makes it trivial to recreate the exact same splits whenever needed.

## Dataset Format

`main.csv` follows a simple schema:

```csv
email,label,source
person@example.com,legit,synthetic
fraud.pattern@example.net,fraud,synthetic
```

- **email** – synthetic address only (no PII)
- **label** – `legit`/`fraud` (case-insensitive, numeric values supported)
- **source** – optional metadata column; ignored by the tooling

## Feature exports

The new decision-tree pipeline consumes a feature matrix derived from this file. Use the CLI to generate it:

```bash
# Default export -> data/features/export.csv
npm run cli features:export

# Custom paths / include original email column
npm run cli features:export -- \
  --input data/main.csv \
  --output tmp/features.csv \
  --include-email
```

The exported CSV contains one row per email with the full feature vector (see `src/utils/feature-vector.ts`) plus a numeric `label`. Feed that file into `ml/export_tree.py` or any other offline trainer.

See [docs/DECISION_TREE.md](../docs/DECISION_TREE.md) for the complete workflow.

## Enron Cleanup

We keep the original dump (`data/enron.csv`) untouched and generate a normalized version (`data/enron-clean.csv`) with lowercase emails, trimmed punctuation, and deduplicated records. Use the helper script any time you need to refresh the cleaned dataset:

```bash
scripts/clean_enron.py \
  --input data/enron.csv \
  --output data/enron-clean.csv
```

Current stats (2025‑11‑30 build):

- Total kept: **172,806** legitimate addresses
- Duplicates trimmed: 38
- Invalid/blank rows: 0

## Canonical Dataset Build (1,000,000 rows)

`data/main.csv` mixes the cleaned Enron list with synthetic data to balance fraud vs. legit examples. The current build (2025‑11‑30) uses the following recipe:

| Source | Rows | Label |
|--------|------|-------|
| `data/enron-clean.csv` | 172,806 | legit |
| Synthetic (legit) | 327,194 | legit |
| Synthetic (fraud) | 500,000 | fraud |
| **Total** | **1,000,000** | 50% legit / 50% fraud |

Reproduce the synthetic portions with deterministic seeds:

```bash
# Legitimate filler to reach 500k positives (seed 20251130)
npm run cli -- data:synthetic -- \
  --count 327194 \
  --legit-ratio 1 \
  --seed 20251130 \
  --output tmp/synthetic_legit.csv

# Fraud half (seed 20251131)
npm run cli -- data:synthetic -- \
  --count 500000 \
  --legit-ratio 0 \
  --seed 20251131 \
  --output tmp/synthetic_fraud.csv
```

Then merge and shuffle (seed `20251130`) to form the canonical dataset:

```bash
python - <<'PY'
import csv, random, pathlib
from itertools import chain

def load(path, label_override, source):
    with open(path, newline='', encoding='utf-8') as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            yield {
                'email': row['email'].lower(),
                'name': row.get('name', '').strip(),
                'label': label_override,
                'source': source,
            }

rows = list(chain(
    load('data/enron-clean.csv', 'legit', 'enron'),
    load('tmp/synthetic_legit.csv', 'legit', 'synthetic_legit'),
    load('tmp/synthetic_fraud.csv', 'fraud', 'synthetic_fraud'),
))

rng = random.Random(20251130)
rng.shuffle(rows)

with open('data/main.csv', 'w', newline='', encoding='utf-8') as fh:
    writer = csv.DictWriter(fh, fieldnames=['email', 'name', 'label', 'source'])
    writer.writeheader()
    writer.writerows(rows)
PY
```

The resulting file is ~53 MB with exactly **500,000 legit** and **500,000 fraud** rows ready for feature export.

## Fraudulent email fixtures

`fraudulent-emails.json` is a synthetic corpus used by the integration suites (`tests/integration/fraudulent-emails.test.ts`). Regenerate it any time the generator logic changes:

```bash
npm run cli test:generate -- --count 400 --output data/fraudulent-emails.json
```

The generator now focuses on sequential, dated, high-entropy, disposable, and plus-addressing patterns—the same ones exercised by the decision-tree runtime.
