# Model Training Guide

## Overview

The fraud detection system uses NGram Markov Chain models trained on large datasets of legitimate and fraudulent email patterns. This guide covers training, deployment, and maintenance of these models.

## Training Architecture

### Incremental Training
Models are trained incrementally, meaning new data is added to existing models rather than replacing them entirely. This preserves learned patterns while incorporating new observations.

### Model Versioning
Every training run creates:
1. **Versioned models**: `MM_legit_2gram_20251104_153045` (permanent history)
2. **Backup**: `MM_legit_2gram_backup` (previous production model)
3. **Production**: `MM_legit_2gram` (currently active model)
4. **Version pointer**: `production_model_version` (tracks current version)

## Manual Training (Recommended for Initial Setup)

### From CSV Datasets

Train from CSV files in the `./dataset` directory:

```bash
# Train 2-gram model (default)
npm run cli train:markov

# Train multiple n-gram orders (ensemble)
npm run cli train:markov -- --orders "1,2,3"

# Train and upload to production KV
npm run cli train:markov -- --orders "2" --upload --remote
```

### Training Output
```
Dataset Statistics
------------------
ℹ️  Legitimate samples: 111,525
ℹ️  Fraudulent samples: 105,668
ℹ️  Total samples: 217,253

Training 2-gram Models
----------------------
2-gram Legit [██████████████████████████████] 100% (111,525/111,525)
2-gram Fraud [██████████████████████████████] 100% (105,668/105,668)
✅ 2-gram training complete!
```

## Automated Training (Cron-based)

### How It Works

The automated training worker runs every 6 hours via Cloudflare cron:

```yaml
# wrangler.toml
triggers = { crons = ["0 */6 * * *"] }
```

**Process**:
1. Loads last 7 days of training data from KV (`training_data_YYYY-MM-DD`)
2. Loads existing production models
3. Trains incrementally on new data
4. Validates against test dataset
5. Auto-deploys to canary if validation passes
6. Monitors metrics and auto-promotes if successful

### Training Configuration

Stored in `CONFIG` KV namespace as `training_config`:

```json
{
  "orders": [2],
  "adaptationRate": 0.3,
  "minSamplesPerClass": 100
}
```

**Parameters**:
- `orders`: N-gram orders to train (1, 2, or 3)
- `adaptationRate`: Skip samples within 0.3 std dev (prevents retraining on familiar patterns)
- `minSamplesPerClass`: Minimum samples required per class

### Data Collection

Training data is collected from production traffic by the data extraction worker. Each request with `decision: "block"` or `decision: "allow"` is stored with its label for future training.

**Note**: Currently, the data extraction worker needs to be deployed separately.

## Model Quality Metrics

### Current Production Models

Check model statistics:

```bash
# Remote (production)
npx wrangler kv key get MM_legit_2gram --binding MARKOV_MODEL --remote | jq '{trainingCount, order}'

# Local (development)
npx wrangler kv key list --binding MARKOV_MODEL
```

### Expected Metrics

**Good model indicators**:
- Training count: >10,000 samples per class
- Precision: >90%
- Recall: >90%
- F1 Score: >90%

**Warning signs**:
- Training count: <1,000 samples (undertrained)
- High false positive rate (>10%)
- Markov confidence consistently low (<0.2)

## Testing Models

### Live Production Tests

```bash
npm run cli test:live
```

Runs 49 comprehensive test cases against production API:
- Legitimate emails (names, birth years, professional)
- Fraudulent patterns (sequential, dated, keyboard walks)
- Edge cases (plus addressing, international names)

### Expected Results
- Overall accuracy: >90%
- Precision: >90%
- Recall: >90%
- False positives: <5%
- False negatives: <5%

## Troubleshooting

### Models Are Undertrained

**Symptoms**: Low training counts (<1,000), high false positive rate

**Solution**:
```bash
# Train from scratch using CSV datasets
npm run cli train:markov -- --orders "2" --upload --remote
```

### Automated Training Not Working

**Symptoms**: Models not updating, no new training data

**Check**:
1. Verify cron trigger is active: `wrangler deployments list`
2. Check for training data: `npx wrangler kv key list --binding CONFIG --remote | grep training_data`
3. View worker logs: `npx wrangler tail`
4. Check last training metadata: `npx wrangler kv key get latest_training --binding CONFIG --remote`

### High False Positive Rate

**Symptoms**: Legitimate emails being blocked

**Solutions**:
1. Check if `actionOverride: "block"` is escalating warnings
2. Verify risk thresholds are reasonable (block: 0.6, warn: 0.3)
3. Retrain with more diverse legitimate samples
4. Review pattern detectors for false positives

### Training Fails

**Common issues**:
1. Insufficient samples: Need at least `minSamplesPerClass` (default: 100)
2. No training data available: Data extraction worker not deployed
3. KV namespace access: Check bindings in `wrangler.toml`

## Best Practices

### Initial Setup
1. Train from large CSV datasets (>10,000 samples each)
2. Validate on test set before deploying
3. Monitor production metrics for first week
4. Adjust thresholds based on observed behavior

### Ongoing Maintenance
1. Let automated training handle incremental updates
2. Review training metrics monthly
3. Retrain from scratch quarterly with full dataset
4. Keep backup of previous models

### Model Hygiene
1. Clean up old versioned models (keep last 10)
2. Monitor model file sizes (should be <5MB each)
3. Track training sample counts over time
4. Validate after major dataset additions

## API Reference

### Training Functions

```typescript
// Load production models for incremental training
export async function loadProductionModels(
  kv: KVNamespace,
  orders: number[]
): Promise<Models | null>

// Train models (incremental if existingModels provided)
export function trainModels(
  legitSamples: string[],
  fraudSamples: string[],
  config: TrainingConfig,
  existingModels?: Models
): Models

// Save with versioning and backup
export async function saveTrainedModels(
  kv: KVNamespace,
  trainedModels: TrainedModels,
  updateProduction: boolean = true
): Promise<void>

// Complete training pipeline
export async function runTrainingPipeline(
  kv: KVNamespace,
  config: TrainingConfig,
  days: number = 7,
  incremental: boolean = true
): Promise<TrainedModels>
```

## See Also

- [Configuration Guide](./CONFIGURATION.md)
- [Architecture Overview](../README.md#architecture)
- [Testing Guide](./TESTING.md)
