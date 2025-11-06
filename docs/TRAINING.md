# Model Training Guide

## Overview

The fraud detection system uses NGram Markov Chain models trained on large datasets of legitimate and fraudulent email patterns. This guide covers training, deployment, and maintenance of these models.

## ⚠️ CRITICAL: Pattern-Based vs Content-Based Labels

**Most spam/phishing datasets label emails based on MESSAGE CONTENT (spam/phishing), not ADDRESS PATTERNS (bot-generated).** This causes severe training issues:

**The Problem:**
- Email like `taylor@s3.serveimage.com` might be labeled "fraud" because the message was spam
- But the pattern `taylor@[domain]` is a **legitimate name pattern**!
- Training on content-based labels teaches models the WRONG patterns

**Our Solution: Pattern-Based Re-labeling**
Before training Markov models, **always re-label your dataset** using pattern analysis:

```bash
# Re-label dataset based on email ADDRESS PATTERNS (not message content)
npm run cli train:relabel --input ./dataset/raw_emails.csv --output ./dataset/pattern_labeled_emails.csv

# Review changes
# Typical result: 40-50% of labels change!
# - Fraud → Legit: ~36,000 emails (legitimate names mislabeled as fraud)
# - Legit → Fraud: ~7,000 emails (truly suspicious patterns)
```

**What Re-labeling Does:**
1. Analyzes each email address with pattern detectors (keyboard walks, sequential, gibberish, etc.)
2. Assigns label based on **address pattern**, ignoring message content
3. Outputs CSV with: `email`, `label`, `original_label`, `reason`, `confidence`, `changed`

**Pattern Analysis Heuristics:**
- ✅ Legitimate: `john.doe`, `first_last`, simple names
- ⚠️ Suspicious: Very short (<3 chars), high entropy gibberish
- 🚫 Fraud: Keyboard walks (qwerty, asdf), sequential (abc123), pure random

**Always use pattern-labeled data for training!** This ensures models learn actual fraud patterns, not message content.

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

## Automated Training (Currently Disabled)

### ⚠️ Status: Disabled Due to Data Quality Issues

**Automated online training is currently disabled** (as of 2025-01-06) to prevent model degradation.

### The Problem: Circular Reasoning

The online training pipeline had a critical flaw where it used the model's own predictions to label training data:

```typescript
// Labels fraud based on the model's OWN risk_score
if (sample.risk_score >= 0.7 && (sample.decision === 'block')) {
    fraudSamples.push(sample.email_local_part);  // Labeled as fraud
}
```

**This creates a feedback loop:**
1. Model predicts high risk → Email blocked
2. Blocked email labeled as "fraud"
3. Model trains on this label
4. False positives get reinforced
5. Model quality degrades over time

### Ground Truth Requirement

**Proper training requires ground truth labels** - human-verified fraud vs legitimate classifications, not model predictions.

### Current Approach

Until a proper ground truth mechanism is implemented (e.g., user feedback, manual review), **only manual training with labeled CSV datasets is used**:

```bash
# Train with verified ground truth data
npm run cli train:markov -- --orders "2,3" --upload --remote
```

### Previous Automated Approach (Disabled)

The automated training worker previously ran every 6 hours via Cloudflare cron:

```yaml
# wrangler.jsonc (currently disabled in src/index.ts)
triggers = { crons = ["0 */6 * * *"] }
```

**Previous Process** (now disabled):
1. Loaded last 7 days of validation data from D1
2. Labeled samples based on risk_score and decision
3. Trained incrementally on new data
4. Deployed updated models

**Why Disabled**: No ground truth verification - relied entirely on model's own decisions.

### Future Implementation

To safely re-enable automated training, we need:

**Option 1: User Feedback Loop**
- API endpoint for false positive/negative reports
- Human verification of edge cases
- Ground truth labels from corrections

**Option 2: Conservative Semi-Supervised**
- Very high confidence threshold (0.95+) for auto-labeling
- Multiple detectors must agree
- Manual training weighted much higher
- Quality metrics monitoring

**Option 3: Hybrid Approach**
- Manual training for model updates (quarterly)
- Online training only for adaptive scoring adjustments
- Separate tracking of online vs manual trained components

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

### Automated Training Not Running

**Note**: Automated training is intentionally disabled (see "Automated Training (Currently Disabled)" section above).

**If you need to update models**:
```bash
# Use manual training with labeled CSV data
npm run cli train:markov -- --orders "2,3" --upload --remote
```

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
1. ~~Let automated training handle incremental updates~~ (Currently disabled - use manual training)
2. Retrain models monthly with updated CSV datasets
3. Review production metrics and false positive/negative reports
4. Retrain from scratch quarterly with full dataset
5. Keep backup of previous models

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
