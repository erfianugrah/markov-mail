# Model Training v3.0 - Unified Random Forest Pipeline

**Version**: 3.0.0
**Date**: 2025-11-30
**Status**: Production Ready

## Overview

Version 3.0 introduces a unified model training pipeline that treats Random Forest as the core algorithm. A decision tree is simply a Random Forest with `n_trees=1`.

## Architecture

### Unified Training Command

```bash
npm run cli model:train [options]
```

**Key Parameters**:
- `--n-trees <n>` - Number of trees (1 = decision tree, 10+ = random forest)
- `--max-depth <n>` - Maximum tree depth (default: 6)
- `--min-samples-leaf <n>` - Minimum samples per leaf (default: 20)
- `--conflict-weight <n>` - Weight for conflict zone samples (default: 20.0)
- `--upload` - Upload to KV after training
- `--skip-mx` - Skip MX lookups (faster iteration)

### Model Types

| Trees | Type | Size | Training | Inference | Accuracy | Use Case |
|-------|------|------|----------|-----------|----------|----------|
| 1 | Decision Tree | ~5KB | 10s | 0.1ms | 88% | Fast fallback, debugging |
| 10 | Random Forest | ~28KB | 2min | 1ms | 90% | Production default |
| 20 | Random Forest | ~56KB | 4min | 2ms | 91% | Balanced performance |
| 50 | Random Forest | ~140KB | 10min | 5ms | 92% | High accuracy |
| 100 | Random Forest | ~280KB | 20min | 10ms | 93% | Maximum accuracy |

## Conflict Zone Weighting

The training uses strategic sample weighting to handle **high-entropy fraud patterns** that overlap with legitimate users.

### Conflict Zone Definition

```python
conflict_mask = (bigram_entropy > 3.0) & (domain_reputation_score >= 0.6)
```

This identifies samples where:
- **High bigram entropy** (>3.0) - Pronounceable but random-looking local parts
- **Sketchy domains** (>=0.6) - Free providers with high abuse rates (mail.com, gmx.com, email.com)

### Weighting Strategy

- **Normal samples**: weight = 1.0
- **Conflict zone samples**: weight = 20.0 (default, configurable)

This forces the forest to learn discriminating features like:
- `avg_segment_length` - Unsegmented gibberish (12.5) vs structured names (8.3)
- `has_word_boundaries` - Presence of dots/underscores
- `consecutive_consonants` - Phonetic patterns
- `has_dictionary_words` - Real name components

## Production Deployment

### Inference Architecture

```typescript
// middleware/fraud-detection.ts

// Try Random Forest first (primary model)
const forestLoaded = await loadRandomForestModel(c.env);
if (forestLoaded && featureVector) {
    randomForestResult = evaluateRandomForest(featureVector);
}

// Fall back to Decision Tree if Random Forest unavailable
const treeLoaded = await loadDecisionTreeModel(c.env);
if (treeLoaded && featureVector) {
    decisionTreeResult = evaluateDecisionTree(featureVector);
}

// Use best available model
if (randomForestResult) {
    riskScore = randomForestResult.score;
} else if (decisionTreeResult) {
    riskScore = decisionTreeResult.score;
}
```

### KV Storage

| Model | KV Key | Purpose |
|-------|--------|---------|
| Random Forest | `random_forest.json` | Primary scoring model |
| Decision Tree | `decision_tree.json` | Fallback model |

Both models are cached with 60s TTL for hot-reload without redeployment.

## Training Examples

### Quick Development (Single Tree, No MX)
```bash
npm run cli model:train -- --n-trees 1 --skip-mx
```

### Production Default (10 Trees, Full Features)
```bash
npm run cli model:train -- --n-trees 10 --upload
```

### High Accuracy (50 Trees)
```bash
npm run cli model:train -- --n-trees 50 --upload
```

### Performance Comparison
```bash
# Train multiple models for comparison
npm run cli model:train -- --n-trees 10 --output models/rf-10.json
npm run cli model:train -- --n-trees 20 --output models/rf-20.json
npm run cli model:train -- --n-trees 50 --output models/rf-50.json
npm run cli model:train -- --n-trees 100 --output models/rf-100.json
```

## Migration from v2.x

### Training Command

Use the unified `model:train` command for all model types:

```bash
# Train Decision Tree (1 tree)
npm run cli model:train -- --n-trees 1 --max-depth 8

# Train Random Forest (multiple trees)
npm run cli model:train -- --n-trees 20
```

## Training Workflow

### Step 1: Feature Export

```bash
# Export features with MX lookups (2-4 hours for large datasets)
npm run cli features:export --input data/main.csv --output data/features/export.csv

# OR: Skip MX for faster iteration (30 seconds)
npm run cli features:export --skip-mx
```

**Output**: `data/features/export.csv` (45 features + label column)

### (Optional) Hyperparameter Tuning

Use the Bun CLI wrapper to run the Python `RandomizedSearchCV` helper when you need to refresh the forest shape:

```bash
npm run cli model:tune -- \
  --dataset data/features/export.csv \
  --n-iter 40 \
  --output tmp/rf-tuning.json
```

The command shells into `cli/commands/model/tune_hyperparameters.py`, reports the best `n_estimators`, `max_depth`, and `min_samples_leaf`, and stores the leaderboard so you can pin the configuration you push to production.

### Step 2: Train & Export

```bash
# Uses existing feature export, trains Random Forest
npm run cli model:train -- --n-trees 50 --upload
```

**Process**:
1. ✅ Feature export (reuses existing if fresh, otherwise regenerates)
2. 🌲 Python training (scikit-learn RandomForestClassifier)
3. 🧮 Automatic Platt calibration (`meta.calibration`)
4. 📦 JSON export (minified t/f/v/l/r format + feature importances)
5. ☁️ KV upload (optional, requires `--upload` flag)

Inspect the exported importance map any time with:

```bash
npm run cli model:analyze -- config/production/random-forest-balanced.2025-12-01.json
```

This dumps the ranked feature list and highlights which detectors are carrying the most weight in the current forest.

### Step 3: Calibrate & pick thresholds

1. **Calibrated scores** – the trainer emits `data/calibration/latest.csv` automatically. Refit (or audit) with the CLI:

   ```bash
   npm run cli -- model:calibrate -- \
     --input data/calibration/latest.csv \
     --output data/calibration/calibrated.csv
   ```

   This now produces `data/calibration/threshold-scan.[json|csv]` with recall/FPR/FNR counts for each candidate threshold.

2. **Automatic threshold selection** – feed the scan into the new helper to obtain warn/block recommendations that hit your SLO (defaults: recall ≥ 0.95, FPR/FNR ≤ 0.05):

   ```bash
   npm run cli -- model:thresholds -- \
     --input data/calibration/threshold-scan.json \
     --min-recall 0.95 \
     --max-fpr 0.05 \
     --max-fnr 0.05
   ```

   The output JSON (`data/calibration/threshold-recommendation.json`) includes the metrics for each chosen threshold plus the constraints used to derive them.

3. **Update configs** – apply the selected thresholds everywhere with a single command:

   ```bash
   npm run cli -- config:update-thresholds [--dry-run]
   ```

   This patches `config/production/config.json`, `src/config/defaults.ts`, and records the change inside `CHANGELOG.md`. Pass `--dry-run` for CI previews or `--warn/--block` to override the recommendation file when experimenting. CI jobs can chain everything with `npm run cli -- model:guardrail` to fail fast whenever the calibration set no longer meets the recall/FPR SLO.

### Step 4: Deploy

```bash
npm run deploy
```

Worker automatically loads new model from KV within 60 seconds.

### One-Command Automation

When you want the whole flow (feature export → training → guardrail → threshold update → config sync → artifact snapshot) handled for you, run:

```bash
npm run pipeline -- \
  --dataset data/main.csv \
  --features-output data/features/export.csv \
  --model-output config/production/random-forest.auto.json \
  --export-modes fast,full \
  --search '[{"label":"fast-pass","nTrees":10,"featureMode":"fast"},{"label":"full-depth","nTrees":20,"maxDepth":8,"featureMode":"full"}]' \
  --calibration-retries 1 \
  --retry-threshold-step 0.02 \
  --upload-model \
  --apply-thresholds \
  --sync-config \
  --config-dry-run
```

The pipeline:
1. Exports features for each mode listed in `--export-modes` (`fast = skip MX, full = full MX). Use `--fast-features-output` / `--features-output` to control file paths or `--skip-export` if you already have the files.
2. Trains the model (pass `--n-trees`, `--max-depth`, etc.) for every entry in the `--search` grid, automatically binding the right feature file via `featureMode`.
3. Runs the guardrail after each attempt. If it fails, optional `--calibration-retries` rerun calibration with alternate sweep parameters (`--retry-threshold-step`, etc.) before moving to the next attempt. Promotion continues only when the SLO is satisfied.
4. Updates `config/production/config.json` + `src/config/defaults.ts` (dry-run unless `--apply-thresholds`).
5. Uploads the final model to KV when `--upload-model` is present (use `--upload-dry-run` to preview).
6. Syncs both config and `risk-heuristics.json` to KV (respecting `--config-dry-run`).
7. Captures the calibration/threshold artifacts in `tmp/threshold-artifacts/<timestamp>`.

Toggle uploads or syncing with `--upload-model`, `--sync-config`, and `--config-dry-run`. Use `--skip-guardrail`, `--skip-artifacts`, or `--skip-export` for faster local iterations.

**Run Directories & Resume**

- Every run stores its manifest under `tmp/pipeline-runs/<timestamp>/manifest.json` (override with `--run-dir`).
- To continue a failed run, pass `--resume latest` (or a specific directory) and the pipeline will skip completed exports/attempts and continue with the remaining search configs.
- Manifest entries track hyperparameters, export modes, guardrail outcomes, uploads, config sync results, and the artifact snapshot directory for auditability.

**Full-MX, 100 Tree Run**

```bash
npm run pipeline -- \
  --dataset data/main.csv \
  --export-modes full \
  --search '[{"label":"mx-forest","nTrees":100,"maxDepth":8,"featureMode":"full"}]' \
  --calibration-retries 1 \
  --upload-model \
  --apply-thresholds \
  --sync-config
```

Drop `--config-dry-run` when you’re ready for the pipeline to push the updated thresholds + config to KV. Use `--resume latest` if the run halts mid-way so it can pick up from the next attempt automatically.

## Feature Set (45 Features)

### Local Part Features (13)
- `local_part_length`, `digit_count`, `special_char_count`
- `has_numbers`, `has_special_chars`, `starts_with_digit`
- `bigram_entropy`, `trigram_entropy` (language-agnostic)
- `avg_segment_length`, `has_word_boundaries`
- `consecutive_consonants`, `has_dictionary_words`
- `char_diversity`

### Domain Features (9)
- `domain_length`, `has_subdomain`, `subdomain_count`
- `is_free_provider`, `is_disposable`, `domain_reputation_score`
- `tld_fraud_score`, `tld_is_risky`, `tld_is_suspicious`

### Pattern Features (6)
- `is_sequential`, `is_dated`, `is_formatted`
- `is_suspicious_sequential`, `is_suspicious_dated`, `is_suspicious_formatted`

### Email Structure (5)
- `email_length`, `has_plus_addressing`, `plus_tag_length`
- `local_to_domain_ratio`, `has_uncommon_tld`

### MX Features (6)
- `mx_record_count`, `has_valid_mx`, `mx_includes_domain`
- `mx_is_google`, `mx_is_microsoft`, `mx_is_common_provider`

### N-Gram Features (6)
- `ngram_bigram_score`, `ngram_trigram_score`, `ngram_overall_score`
- `ngram_confidence`, `ngram_risk_score`, `ngram_is_natural`

## Model Performance

### Overall Metrics (50 Trees, Conflict Weight 20.0)

| Metric | Train | Test |
|--------|-------|------|
| **Precision** | 91.2% | 89.7% |
| **Recall** | 95.1% | 90.4% |
| **F1 Score** | 93.1% | 90.0% |

### Conflict Zone Performance

| Metric | Before v3.0 | After v3.0 |
|--------|-------------|------------|
| **Recall** | 66.7% | 99.9% |
| **Precision** | 42.6% | 90.7% |
| **Samples** | 5,879 | 5,879 |

The conflict zone weighting solved the high-entropy fraud detection problem where certain fraud patterns were being missed due to overlapping characteristics with legitimate users.

## Model Versioning

Models include version metadata:

```json
{
  "meta": {
    "version": "3.0.0-forest",
    "features": [...],
    "tree_count": 50,
    "config": {
      "n_trees": 50,
      "max_depth": 6,
      "min_samples_leaf": 20,
      "conflict_weight": 20.0
    }
  },
  "forest": [...]
}
```

## Troubleshooting

### Model Too Large for KV

**Error**: `Model exceeds KV 25MB limit!`

**Solution**: Reduce tree count or max depth
```bash
# Reduce from 100 to 50 trees
npm run cli model:train -- --n-trees 50 --upload

# OR: Reduce max depth
npm run cli model:train -- --n-trees 100 --max-depth 5 --upload
```

### Training Takes Too Long

**Solution**: Use `--skip-mx` flag to skip MX lookups
```bash
npm run cli model:train -- --n-trees 50 --skip-mx --upload
```

**Trade-off**: 6 fewer features (88% → 86% accuracy), but 100x faster feature export

### Python venv Not Found

**Error**: `Python venv not found at venv/bin/python`

**Solution**: Set up Python environment
```bash
python -m venv venv
source venv/bin/activate
pip install scikit-learn pandas numpy
```

## References

- [Configuration](./CONFIGURATION.md) - KV and config management
- [Architecture](./ARCHITECTURE.md) - System design overview
- [Project Structure](./PROJECT_STRUCTURE.md) - Codebase organization
- [Detectors](./DETECTORS.md) - Pattern detector reference
