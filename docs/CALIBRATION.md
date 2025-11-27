# Calibration Layer Documentation

## Overview

The calibration layer is a logistic regression model trained on top of Markov Chain outputs and metadata features. It refines the raw Markov fraud probability into a calibrated score that better matches real-world fraud rates.

## Quick Start

**New to Markov Mail?** Use the pre-trained production configuration:
- See [`config/production/README.md`](../config/production/README.md) for ready-to-deploy models and calibration
- **Production Performance**: 97.96% F1, 100% recall, 96% precision (99-email validation)
- **No Training Data Required**: Just upload to KV and start using immediately

The rest of this document covers the training workflow for advanced users who want to retrain calibration on their own data.

## Architecture

### Design Principles

1. **Boost-Only Design**: Calibration can only *increase* risk scores, never decrease them
   - Implementation: `classificationRisk = max(markovConfidence, calibratedProbability)`
   - Rationale: Prevents bad calibration data from disabling fraud detection
   - The Markov model remains the authoritative floor

2. **Safeguards**:
   - Short local-part guardrail: Clamps OOD abnormality risk based on length
     - ≤4 chars: 0 risk (full protection for emails like `tim@company.com`)
     - 5-12 chars: gradual ramp (proportional protection)
     - ≥12 chars: unchanged (full OOD signal)
   - Feature sanitization: Clamps all input features to valid ranges
   - Graceful degradation: Falls back to Markov-only if calibration unavailable

## Feature Set

The calibration model uses 15 features:

### Markov Chain Features (6)
- `ce_legit2`: Cross-entropy against 2-gram legitimate model
- `ce_fraud2`: Cross-entropy against 2-gram fraud model
- `ce_diff2`: Difference (legit - fraud) for 2-gram
- `ce_legit3`: Cross-entropy against 3-gram legitimate model
- `ce_fraud3`: Cross-entropy against 3-gram fraud model
- `ce_diff3`: Difference (legit - fraud) for 3-gram

### Pattern Features (3)
- `sequential_confidence`: Sequential pattern detector confidence [0-1]
- `plus_risk`: Plus-addressing abuse risk score [0-1]
- `abnormality_risk`: Out-of-distribution risk score [0-1]

### Structural Features (3)
- `local_length`: Length of email local part [0-128]
- `digit_ratio`: Ratio of digits to total characters [0-1]
- `min_entropy`: Minimum cross-entropy across all models

### Domain Features (3)
- `provider_is_free`: Binary indicator (Gmail, Outlook, etc.)
- `provider_is_disposable`: Binary indicator (temporary email services)
- `tld_risk`: Risk score for top-level domain [0-1]

## Performance Baselines

### Training Metrics

Expected performance on `dataset/training_compiled/training_compiled.csv` (baseline dataset):

| Metric | Target | Acceptable Range | Red Flag |
|--------|--------|------------------|----------|
| **Precision** | ≥ 0.85 | 0.80 - 1.00 | < 0.80 |
| **Recall** | ≥ 0.80 | 0.75 - 1.00 | < 0.75 |
| **F1 Score** | ≥ 0.82 | 0.77 - 1.00 | < 0.77 |
| **Accuracy** | ≥ 0.85 | 0.80 - 1.00 | < 0.80 |

### Interpretation

- **Precision** measures false positive rate
  - 0.85 = max 15% false positives (legitimate emails blocked)
  - Drop > 5% indicates model is getting too aggressive

- **Recall** measures false negative rate
  - 0.80 = max 20% false negatives (fraud emails missed)
  - Drop > 5% indicates model is getting too lenient

- **F1 Score** balances precision and recall
  - Harmonic mean of precision and recall
  - Both dropping simultaneously indicates model degradation

### Production Monitoring

Monitor calibration drift using the drift analysis tool:

```bash
FRAUD_API_KEY=xxx npm run cli analytics:drift --hours 24
```

#### Drift Health Alerts

| Alert Level | Condition | Threshold | Action Required |
|-------------|-----------|-----------|-----------------|
| **ERROR** | Large avg suppression | > 0.15 | Retrain immediately |
| **WARNING** | High suppression rate | > 10% | Review training data |
| **WARNING** | Low calibration usage | < 50% | Check config deployment |
| **INFO** | Very high boost rate | > 80% | Monitor, may be expected |

## Training Workflow

### 1. Update Worker Code

Ensure the latest safeguards are deployed:
- Short-local guardrail in `fraud-detection.ts:clampAbnormalityRiskForLocalLength()`
- Boost-only calibration in `fraud-detection.ts:calculateAlgorithmicRiskScore()`

### 2. Train Calibration Model

```bash
cd markov-mail/

# Train on the compiled training dataset
npm run cli train:calibrate \
  --dataset dataset/training_compiled/training_compiled.csv \
  --models models \
  --output calibration.json \
  --orders "2,3"
```

Expected output:
```
🎯 Calibration Training
Dataset: dataset/training_compiled/training_compiled.csv
Models dir: models
Loaded 111,234 labeled emails
Processed 111,234 samples
Final samples with features: 111,234

Calibration metrics:
  accuracy=0.872
  precision=0.855
  recall=0.814
  f1=0.834

✅ Calibration coefficients saved to calibration.json
```

### 3. Upload to KV

```bash
# Upload to production KV
npm run cli train:calibrate \
  --dataset dataset/training_compiled/training_compiled.csv \
  --models models \
  --output calibration.json \
  --upload --remote
```

This merges calibration into the existing `config.json` in KV.

### 4. Verify Deployment

```bash
# Verify config integrity
npm run cli config:verify --remote

# Should output:
# ✓ config.json found and valid JSON
# ✓ Calibration block present
# ✓ Calibration has all required fields
# ✓ Calibration is 2 hours old (fresh)
# ✓ All 15 expected features present
# ✓ Calibration metrics: accuracy=0.872, precision=0.855, recall=0.814, f1=0.834
# ✅ Verification PASSED - all checks OK
```

### 5. Run Batch Tests

```bash
# Test against legacy dataset to spot regressions
npm run cli test:batch \
  --input dataset/training_compiled/training_compiled.csv \
  --endpoint https://fraud.erfi.dev/validate \
  --concurrency 10
```

Compare precision/recall against baselines. If metrics drop > 5%, investigate.

### 6. Monitor Drift

```bash
# Monitor drift over next 24 hours
FRAUD_API_KEY=xxx npm run cli analytics:drift --hours 24
```

Look for:
- Suppression rate < 10% (calibration not undermining Markov)
- Average suppression < 0.15 (no large divergence)
- Boost rate reasonable (typically 30-60%)

## Retraining Schedule

### When to Retrain

**Required (retrain immediately):**
- Precision or recall drops below red flags (< 0.80 / < 0.75)
- Drift alerts show ERROR level (avg suppression > 0.15)
- Calibration > 7 days old and dataset distribution has shifted
- New fraud patterns emerge that aren't captured

**Recommended (retrain within 48 hours):**
- Drift alerts show WARNING level
- Calibration > 14 days old
- Significant traffic pattern changes (e.g., new geographic regions)
- After updating detector logic or feature extraction

**Optional (retrain at convenience):**
- Calibration > 30 days old
- Want to incorporate newly collected production data
- Testing new feature combinations

### Retraining Process

1. Extract fresh production data:
   ```bash
   npm run cli training:extract --days 30 --remote
   ```

2. Combine with existing training set:
   ```bash
   npm run cli train:dataset \
     --base dataset/training_compiled/training_compiled.csv \
     --augment extracted_data.csv \
     --output dataset/training_compiled/training_v2.csv
   ```

3. Train new models:
   ```bash
   npm run cli train:markov \
     --dataset dataset/training_compiled/training_v2.csv \
     --output models
   ```

4. Train calibration on new models:
   ```bash
   npm run cli train:calibrate \
     --dataset dataset/training_compiled/training_v2.csv \
     --models models \
     --upload --remote
   ```

5. Verify and monitor as above

## Debugging

### Calibration Not Being Used

Check `/validate` response for `metadata.calibration`:

```json
{
  "metadata": {
    "calibration": {
      "version": "calibration_20251127143022",
      "createdAt": "2025-11-27T14:30:22.145Z",
      "calibrationUsed": false  // ← Problem!
    }
  }
}
```

Possible causes:
- Markov result missing (models not loaded)
- Config doesn't have calibration block
- Feature extraction failed (check logs)

### Calibration Always Suppressing

Check drift monitor:
```bash
FRAUD_API_KEY=xxx npm run cli analytics:drift
```

If suppression rate > 10%, calibration is frequently lower than Markov **but is being clamped** by the boost-only safeguard. This indicates:
- Training data may have distribution shift
- Need to retrain calibration
- Current safeguard is preventing harm

### Features Mismatch

```bash
npm run cli config:verify --remote
```

If features don't match:
```
✗ Missing expected features: abnormality_risk
✗ Unexpected features: old_feature_name
```

Calibration was trained on old code. Retrain with current feature set.

## API Response Format

The `/validate` endpoint includes calibration metadata:

```json
{
  "decision": "block",
  "riskScore": 0.87,
  "signals": {
    "markovConfidence": 0.82,
    "calibratedFraudProbability": 0.91,
    "classificationRisk": 0.91
  },
  "metadata": {
    "calibration": {
      "version": "calibration_20251127143022",
      "createdAt": "2025-11-27T14:30:22.145Z",
      "calibrationUsed": true,
      "calibrationBoosted": true,
      "boostAmount": 0.09,
      "metrics": {
        "accuracy": 0.872,
        "precision": 0.855,
        "recall": 0.814,
        "f1": 0.834
      }
    }
  }
}
```

### Field Descriptions

- `calibrationUsed`: Whether calibration was applied to this request
- `calibrationBoosted`: Whether calibration increased risk above Markov
- `boostAmount`: How much calibration increased risk (0 if not boosted)
- `metrics`: Training performance metrics from calibration

## Version History

### v1.0 (2025-11-12)
- Initial calibration layer implementation
- 15 features from Markov + patterns + domain

### v2.0 (2025-11-27)
- Added boost-only safeguard (`max(markov, calibration)`)
- Added short-local guardrail for OOD risk
- Added drift monitoring CLI tool
- Added calibration metadata to API responses
- Documented performance baselines and retraining workflow
