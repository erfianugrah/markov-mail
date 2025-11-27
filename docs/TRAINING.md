# Model Training Guide

## Overview

The fraud detection system uses NGram Markov Chain models trained on large datasets of legitimate and fraudulent email patterns. This guide covers training, deployment, and maintenance of these models.

## ⚠️ CRITICAL: Pattern-Based vs Content-Based Labels

**Most spam/phishing datasets label emails based on MESSAGE CONTENT (spam/phishing), not ADDRESS PATTERNS (bot-generated).** This causes severe training issues:

**The Problem:**
- Email like `name@subdomain.example.com` might be labeled "fraud" because the message was spam
- But the pattern `name@[domain]` is a **legitimate name pattern**!
- Training on content-based labels teaches models the WRONG patterns

**Our Solution: Pattern-Based Re-labeling**
Before training Markov models, **always re-label your dataset** using pattern analysis:

```bash
# Re-label dataset based on email ADDRESS PATTERNS (not message content)
# Note: Replace paths with your actual dataset files
npm run cli train:relabel --input ./dataset/raw_emails.csv --output ./dataset/pattern_labeled_emails.csv

# Review changes
# Typical result: 40-50% of labels change!
# - Fraud → Legit: ~36,000 emails (legitimate names mislabeled as fraud)
# - Legit → Fraud: ~7,000 emails (truly suspicious patterns)
```

> **Note**: All file paths in examples (`dataset/raw_emails.csv`, etc.) are **placeholders**. Use your actual dataset file paths.

**What Re-labeling Does:**
1. Analyzes each email address with pattern detectors (Markov chain, sequential, etc.)
2. Assigns label based on **address pattern**, ignoring message content
3. Outputs CSV with: `email`, `label`, `original_label`, `reason`, `confidence`, `changed`

**Pattern Analysis Heuristics:**
- ✅ Legitimate: `person1.person2`, `first_last`, simple names
- ⚠️ Suspicious: Very short (<3 chars), high entropy gibberish
- 🚫 Fraud: Sequential (abc123), pure random, keyboard patterns (detected by Markov)

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

## Online Training

### ⚠️ Status: Partially Disabled

**Training Status (as of 2025-01-06):**

| Method | Status | Location | Use Case |
|--------|--------|----------|----------|
| **Scheduled/Cron** (every 6h) | ❌ DISABLED | `src/index.ts:448-467` | Fully automated training |
| **Manual API Endpoint** | ✅ ENABLED | `POST /admin/markov/train` | On-demand training |
| **CLI Training** | ✅ ENABLED | `npm run cli train:markov` | Recommended |

**TL;DR**: Automatic scheduled training is disabled, but you can still manually trigger online training via the API endpoint if needed. **CLI training with labeled CSV data is the recommended approach.**

---

### The Problem: Circular Reasoning

The online training pipeline has a critical flaw where it uses the model's own predictions to label training data:

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

**Ground Truth Requirement**: Proper training requires human-verified fraud vs legitimate classifications, not model predictions.

---

### Manual API Training (Available with Caution)

While scheduled training is disabled, you can still manually trigger the online training pipeline via the admin API:

```bash
# Manually trigger online training (uses last 7 days of production data)
curl -X POST "https://your-worker.workers.dev/admin/markov/train" \
  -H "X-API-Key: $X_API_KEY"
```

**Response:**
```json
{
  "success": true,
  "message": "Training completed successfully",
  "result": {
    "success": true,
    "fraud_count": 1234,
    "legit_count": 5678,
    "version": "v1762063221887_69",
    "duration_ms": 8542
  }
}
```

**⚠️ Use with Caution:**
- Training uses model's own predictions as labels (circular reasoning risk)
- May reinforce false positives if model is already making mistakes
- No human verification of training labels
- Only use if you understand the implications

**When to use:**
- Quick model updates when you trust current production accuracy
- Testing the training pipeline
- Emergency model refreshes

**Recommended instead:** Use CLI training with human-labeled CSV data.

---

### Scheduled Training (Disabled)

The cron trigger still fires every 6 hours but only updates the disposable domain list:

```jsonc
// wrangler.jsonc
"triggers": {
  "crons": ["0 */6 * * *"]  // Fires, but training code is commented out
}
```

**Previous Process** (now disabled in `src/index.ts:448-467`):
1. ✅ Updates disposable domain list from GitHub
2. ❌ ~~Trains models on last 7 days of D1 data~~ (commented out)
3. ❌ ~~Validates and deploys new models~~ (commented out)

**Why Training Was Disabled**: No ground truth verification - relies entirely on model's own decisions.

---

### Recommended Approach

**Use CLI training with pattern-labeled CSV data:**

```bash
# 1. Prepare dataset with pattern-based labels
npm run cli train:relabel --input ./dataset/raw.csv --output ./dataset/labeled.csv

# 2. Train models from labeled CSV
npm run cli train:markov -- --orders "2,3" --upload --remote

# 3. Verify models
npm run cli test:live
```

This approach avoids circular reasoning by using pattern analysis (not model predictions) to label training data.

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
- Fraudulent patterns (sequential, dated, keyboard patterns)
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

**Note**: Scheduled training is intentionally disabled (see "Online Training" section above).

**If you need to update models**:

**Option 1: CLI Training (Recommended)**
```bash
# Use manual training with labeled CSV data
npm run cli train:markov -- --orders "2,3" --upload --remote
```

**Option 2: Manual API Training (Use with caution)**
```bash
# Trigger online training via API (uses production data)
curl -X POST "https://your-worker.workers.dev/admin/markov/train" \
  -H "X-API-Key: $X_API_KEY"
```

Note: API training uses model predictions as labels (circular reasoning risk). CLI training with labeled CSV data is preferred.

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

## Model Ensemble Strategy

### Overview

The system can use an ensemble approach combining multiple n-gram orders (2-gram + 3-gram) to leverage the strengths of each model while mitigating their weaknesses.

### Why Ensemble?

**2-gram Model (Bigram):**
- ✅ Robust gibberish detection
- ✅ Good generalization with limited data (44K samples sufficient)
- ✅ Low false positive rate on legitimate users
- ❌ Limited context awareness (only 1 character back)

**3-gram Model (Trigram):**
- ✅ Better context understanding (2 characters back)
- ✅ High confidence on well-trained patterns
- ✅ Better at distinguishing similar patterns
- ❌ Requires 200K-1M samples to avoid sparsity
- ❌ Prone to overfitting with limited data

### Ensemble Algorithm

The ensemble uses **confidence-weighted voting** with intelligent fallback logic:

```typescript
// Step 1: Get predictions from both models
const result2gram = {
  H_legit: legit2gram.crossEntropy(localPart),
  H_fraud: fraud2gram.crossEntropy(localPart),
};

const result3gram = {
  H_legit: legit3gram.crossEntropy(localPart),
  H_fraud: fraud3gram.crossEntropy(localPart),
};

// Step 2: Calculate confidence for each model
const confidence2 = calculateConfidence(result2gram.H_legit, result2gram.H_fraud);
const confidence3 = calculateConfidence(result3gram.H_legit, result3gram.H_fraud);

// Step 3: Ensemble decision logic
let finalPrediction, finalConfidence, reasoning;

// Case 1: Both agree with high confidence (>0.3)
if (prediction2 === prediction3 && Math.min(confidence2, confidence3) > 0.3) {
  finalPrediction = prediction2;
  finalConfidence = Math.max(confidence2, confidence3);
  reasoning = 'both_agree_high_confidence';
}
// Case 2: 3-gram has VERY high confidence (>0.5) - trust it
else if (confidence3 > 0.5 && confidence3 > confidence2 * 1.5) {
  finalPrediction = prediction3;
  finalConfidence = confidence3;
  reasoning = '3gram_high_confidence_override';
}
// Case 3: 2-gram detects gibberish (high cross-entropy)
else if (prediction2 === 'fraud' && confidence2 > 0.2 && result2gram.H_fraud > 6.0) {
  finalPrediction = 'fraud';
  finalConfidence = confidence2;
  reasoning = '2gram_gibberish_detection';
}
// Case 4: Disagree - default to 2-gram (more robust)
else if (prediction2 !== prediction3) {
  finalPrediction = prediction2;
  finalConfidence = confidence2;
  reasoning = 'disagree_default_to_2gram';
}
// Case 5: Use higher confidence model
else {
  finalPrediction = confidence2 >= confidence3 ? prediction2 : prediction3;
  finalConfidence = Math.max(confidence2, confidence3);
  reasoning = confidence2 >= confidence3 ? '2gram_higher_confidence' : '3gram_higher_confidence';
}
```

### Configuration Thresholds

```typescript
const ENSEMBLE_THRESHOLDS = {
  both_agree_min: 0.3,        // Minimum confidence when both agree
  override_3gram_min: 0.5,    // 3-gram needs this to override
  override_ratio: 1.5,        // 3-gram must be 1.5x more confident
  gibberish_entropy: 6.0,     // Cross-entropy threshold for gibberish
  gibberish_2gram_min: 0.2,   // Min 2-gram confidence for gibberish
};
```

### Validation

Test model performance before deploying:

```bash
# Validate production models with ensemble
npm run cli model:validate --remote --ensemble --verbose

# Test specific category
npm run cli model:validate --remote --category gibberish --ensemble

# Compare model orders
npm run cli model:validate --remote --orders "2,3" --verbose
```

### Expected Performance

Based on validation testing:
- **2-gram alone:** 87.5% accuracy
- **3-gram alone:** 79.2% accuracy (data sparsity issues)
- **Ensemble:** 87.5% accuracy with intelligent reasoning

**Ensemble reasoning distribution:**
- 37.5% → Use 3-gram (higher confidence)
- 20.8% → Disagree, default to 2-gram
- 16.7% → 3-gram high confidence override
- 12.5% → Both agree with high confidence

### Monitoring

Track these metrics in production:
- Disagreement rate between models
- Ensemble override frequency
- Confidence distribution per reasoning type
- False positive/negative rates
- Per-category accuracy

### When to Use Ensemble

**Use ensemble when:**
- You have both 2-gram and 3-gram models trained
- You want maximum accuracy across diverse patterns
- You can tolerate slightly higher latency (~20-30ms)

**Use single model when:**
- Minimizing latency is critical
- You only have one well-trained model
- Simplicity is preferred over marginal gains

## Out-of-Distribution (OOD) Detection

### Overview (v2.4+)

The fraud detection system uses a **two-dimensional risk model** that combines classification (fraud vs legit) with anomaly detection (out-of-distribution patterns).

### The Problem

Traditional Markov models only ask: **"Is this fraud or legit?"**

But what if the pattern is **neither** - something the model has never seen before?

**Example:** `oarnimstiaremtn@gmail.com`
- Cross-entropy (legit): 4.51 (very high!)
- Cross-entropy (fraud): 4.32 (very high!)
- Difference: Only 0.19
- **Both models are confused** - this is an out-of-distribution pattern (likely an anagram)

Traditional confidence calculation:
```typescript
confidence = diff / max = 0.19 / 4.51 = 0.04 (4%)
risk = 0.04 → ALLOW ❌
```

### The Solution: Two-Dimensional Risk

Instead of just classification, measure two independent signals:

**Dimension 1: Classification Risk** (Which class?)
- Differential signal: Is fraud cross-entropy lower than legit?
- Formula: `diff / (diff + BASELINE_ENTROPY)`
- Answers: "Which type of pattern is this?"

**Dimension 2: Abnormality Risk** (Is this normal?)
- Consensus signal: Are BOTH cross-entropies high?
- Formula: `max(0, minEntropy - OOD_THRESHOLD) * SCALING_FACTOR`
- Answers: "Is this pattern outside training distribution?"

**Final Risk:**
```typescript
finalRisk = max(classificationRisk, abnormalityRisk) + domainRisk
```

### Research-Backed Thresholds

Based on information theory for binary classification:

```typescript
const OOD_DETECTION = {
  BASELINE_ENTROPY: 0.69,       // Random guessing (log 2 in nats)
  OOD_WARN_THRESHOLD: 3.8,      // Warn zone start
  OOD_BLOCK_THRESHOLD: 5.5,     // Block zone start
  MAX_OOD_RISK: 0.65,           // Maximum risk (v2.4.1: was 0.6)
};
```

**Cross-Entropy Ranges (nats):**
- Random guessing: 0.69 (log 2)
- Good predictions: < 0.2
- Poor predictions: > 1.0
- **Severely confused (OOD): > 3.0**

### Algorithm

```typescript
// 1. Calculate both dimensions
const minEntropy = Math.min(crossEntropyLegit, crossEntropyFraud);
const abnormalityScore = Math.max(0, minEntropy - 3.0);
const abnormalityRisk = Math.min(abnormalityScore * 0.15, 0.6);

const diff = Math.abs(crossEntropyLegit - crossEntropyFraud);
const classificationRisk = prediction === 'fraud' ?
  diff / (diff + 0.69) : 0;

// 2. Take stronger signal
const finalRisk = Math.max(classificationRisk, abnormalityRisk);
```

### Results

**For "oarnimstiaremtn@gmail.com":**
```
Classification Risk:
  diff = 0.19
  confidence = 0.19 / 0.88 = 0.22

Abnormality Risk:
  minEntropy = 4.32
  abnormalityScore = 4.32 - 3.0 = 1.32
  abnormalityRisk = 1.32 * 0.15 = 0.20

Final Risk: max(0.22, 0.20) + domainRisk(0.09) = 0.31 → WARN ✅
```

**For normal fraud (entropy ~2.0-2.5):**
```
minEntropy = 2.0 < 3.0
abnormalityRisk = 0
Uses classification risk only → unchanged behavior ✅
```

**For legitimate patterns (entropy ~1.5-2.0):**
```
minEntropy = 1.5 < 3.0
abnormalityRisk = 0
Predicted legit → risk = 0 ✅
```

### Database Tracking

OOD detections are tracked in the database:

```sql
-- New columns (migration 0005)
min_entropy REAL               -- min(H_legit, H_fraud)
abnormality_score REAL         -- How far above threshold
abnormality_risk REAL          -- Risk contribution
ood_detected INTEGER           -- Boolean flag
```

Query OOD patterns:

```sql
-- Find all OOD detections
SELECT email_local_part, min_entropy, abnormality_risk, decision
FROM validations
WHERE ood_detected = 1
ORDER BY min_entropy DESC;

-- Analyze OOD by decision
SELECT decision, COUNT(*) as count, AVG(abnormality_risk) as avg_risk
FROM validations
WHERE ood_detected = 1
GROUP BY decision;
```

### Block Reasons

New OOD-specific block reasons:

- `out_of_distribution`: Very high abnormality (score > 1.5)
- `high_abnormality`: High risk block (abnormality > 0.4)
- `suspicious_abnormal_pattern`: Medium risk warning (abnormality > 0.2)

### Performance Impact

- **Latency:** +1-2ms (minimal overhead)
- **Accuracy:** Catches novel patterns missed by classification alone
- **False Positives:** No increase (abnormality threshold is conservative)
- **Use Cases:** Detects anagrams, shuffles, novel bot patterns

### When OOD Helps

**Catches:**
- Anagrams: `oarnimstiaremtn` (martinsonear shuffled)
- Character shuffles: `aeimnorst` → `mtorsiean`
- Novel bot patterns not in training data
- Hybrid human/bot patterns

**Doesn't affect:**
- Normal fraud patterns (classification dominant)
- Legitimate names (low entropy)
- Well-trained patterns (classification confident)

### Monitoring

Track OOD metrics:

```bash
# Check OOD detection rate
SELECT
  COUNT(CASE WHEN ood_detected = 1 THEN 1 END) * 100.0 / COUNT(*) as ood_rate
FROM validations
WHERE timestamp > datetime('now', '-7 days');

# OOD risk distribution
SELECT
  ROUND(abnormality_risk, 1) as risk_bucket,
  COUNT(*) as count
FROM validations
WHERE ood_detected = 1
GROUP BY risk_bucket
ORDER BY risk_bucket;
```

**Expected rates:**
- OOD detection: 1-3% of total validations
- Most OOD: 0.15-0.35 risk range (warning level)
- High OOD (>0.4): <0.5% (block level)

## See Also

- [Configuration Guide](./CONFIGURATION.md)
- [Architecture Overview](../README.md#architecture)
- [Testing Guide](./TESTING.md)
