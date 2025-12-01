# Scoring Engine

**Version**: 3.0.0
**Last Updated**: 2025-11-30

## Overview

The scoring engine evaluates email submissions using Machine Learning models (Random Forest or Decision Tree) to produce fraud risk scores. The system follows a feature-extraction pipeline where raw email attributes are transformed into numeric features, evaluated by trained models, and translated into actionable risk levels.

## Scoring Architecture

```
Request → Feature Extraction → Model Evaluation → Risk Score → Action
```

### 1. Feature Extraction

**Source**: `src/utils/feature-vector.ts:buildFeatureVector()`

All email attributes are normalized into a **45-feature vector**:

```typescript
const features = {
  sequential_confidence: 0.85,
  plus_risk: 0.2,
  local_length: 12,
  digit_ratio: 0.25,
  pronounceability: 0.7,
  has_word_boundaries: 1,
  mx_has_records: 1,
  tld_risk_score: 0.3,
  // ... 31 more features
};
```

**Feature Categories**:
- Sequential/Pattern (2 features)
- Linguistic (6 features)
- Structural (4 features)
- Statistical (4 features)
- Identity (3 features)
- Geo (3 features)
- MX (9 features)
- Domain (3 features)
- N-Gram (6 features)
- Basic (5 features)

See [DETECTORS.md](./DETECTORS.md) for detailed feature descriptions.

### 2. Model Evaluation

**Source**: `src/middleware/fraud-detection.ts`

The system attempts to load models in priority order:

```typescript
// 1. Try Random Forest (primary)
const rfLoaded = await loadRandomForestModel(c.env);
if (rfLoaded) {
  rfResult = evaluateRandomForest(featureVector);
  riskScore = rfResult.score;
}

// 2. Fall back to Decision Tree
if (!rfResult) {
  const dtLoaded = await loadDecisionTreeModel(c.env);
  if (dtLoaded) {
    dtResult = evaluateDecisionTree(featureVector);
    riskScore = dtResult.score;
  }
}
```

**Model Types**:

| Model | KV Key | Size | Inference | Accuracy | Use Case |
|-------|--------|------|-----------|----------|----------|
| Random Forest (20 trees) | `random_forest.json` | ~55KB | 1-2ms | 90.1% | Production |
| Decision Tree (1 tree) | `decision_tree.json` | ~3.3KB | <1ms | 75.0% | Fallback |

**Model Format**: JSON with minified keys (`t`, `f`, `v`, `l`, `r`) for size optimization.

### 3. Risk Score

**Output**: Number between 0.0 (legitimate) and 1.0 (fraud)

```typescript
{
  score: 0.92,           // Risk score (0-1)
  reason: "high_seq",    // Human-readable reason
  path: [
    "sequential_confidence <= 0.5 :: right",
    "domain_reputation_score <= 0.6 :: left"
  ]
}
```

### 4. Action Determination

**Source**: `src/middleware/fraud-detection.ts:271-283`

Risk scores are mapped to actions using configurable thresholds:

```typescript
const config = {
  blockThreshold: 0.65,  // ≥ 0.65 = BLOCK
  warnThreshold: 0.35,   // ≥ 0.35 = WARN
};

if (riskScore >= config.blockThreshold) {
  action = 'block';
  allowed = false;
} else if (riskScore >= config.warnThreshold) {
  action = 'warn';
  allowed = true;  // Allow but flag for review
} else {
  action = 'allow';
  allowed = true;
}
```

**Action Types**:

| Action | Risk Range | Response | Use Case |
|--------|-----------|----------|----------|
| `block` | ≥0.65 | HTTP 403 | Clear fraud (bot accounts, sequential patterns) |
| `warn` | 0.35-0.64 | HTTP 200 + flag | Suspicious but uncertain |
| `allow` | <0.35 | HTTP 200 | Legitimate users |

## Short-Circuit Rules

Before ML evaluation, the system applies **hard blockers** that bypass the model:

### 1. Invalid Format
- Malformed email addresses
- Empty fields
- SQL injection attempts

### 2. Disposable Domains (71,000+ patterns)
**Source**: `src/validators/domain.ts`

```typescript
if (isDisposableDomain(domain)) {
  return {
    allowed: false,
    action: 'block',
    reason: 'disposable_domain',
    score: 1.0,
  };
}
```

**Database**: `data/disposable_domains.txt` (71,388 domains)

### 3. No MX Records
If a domain has no MX records (undeliverable email), it's automatically suspicious:

```typescript
if (!mxAnalysis.hasRecords) {
  // Still evaluate with model, but MX features signal risk
  features.mx_has_records = 0;
  features.mx_record_count = 0;
}
```

## Score Interpretation

### Fraud Indicators (High Score)

| Score Range | Typical Causes | Examples |
|-------------|---------------|----------|
| 0.95-1.00 | Sequential pattern + free provider + bot score | `user123@gmail.com`, `test001@hotmail.com` |
| 0.90-0.94 | High entropy + disposable / risky TLD | `xkzqwrtpl@mail.ru`, `asjdhkjah@tk` |
| 0.85-0.89 | Exceeds block threshold after calibration | Auto-block region |
| 0.60-0.84 | Warn zone – requires additional heuristics / rate limits |

### Legitimate Indicators (Low Score)

| Score Range | Typical Causes | Examples |
|-------------|---------------|----------|
| 0.00-0.24 | Structured name + trusted provider | `john.smith@company.com` |
| 0.25-0.44 | Real name + standard TLD | `jsmith1985@gmail.com` (birth year) |
| 0.45-0.59 | Mixed signals (no automatic action) |

## Calibration

**Status**: Platt scaling is applied at runtime (since v3.0.0, Nov 2025).

Workflow:

1. `npm run cli model:train` keeps a validation split (unless `--no-split`) and emits `data/calibration/latest.csv`.
2. The trainer fits a single-variable logistic regression (`calibrated = σ(intercept + coef * raw_score)`) and records the coefficients in the model metadata.
3. `src/models/random-forest.ts` reads `meta.calibration` and converts every forest vote into a calibrated probability before the middleware compares it with the warn/block thresholds.

Use `npm run cli model:calibrate -- --input data/calibration/latest.csv --output data/calibration/calibrated.csv` if you need to recompute calibrations on a newer dataset or generate ROC/PR reports. Follow it with `npm run cli model:thresholds` to derive warn/block cutoffs that satisfy your recall/FPR targets, then `npm run cli config:update-thresholds` (optionally `--dry-run`) to persist the new numbers everywhere. For CI, `npm run cli model:guardrail` chains these steps and fails if the resulting thresholds no longer meet the configured recall/FPR/FNR constraints. Always embed the final coefficients in the JSON (`meta.calibration`) so the Worker stays synchronized with the published thresholds.

## Logging & Analytics

All scoring decisions are logged to **D1 database** for analysis:

**Table**: `ANALYTICS_DATASET`

```sql
INSERT INTO ANALYTICS_DATASET (
  email,
  risk_score,
  action,
  random_forest_score,
  decision_tree_score,
  reason,
  timestamp
) VALUES (?, ?, ?, ?, ?, ?, ?);
```

**Dashboard**: Access analytics at `https://fraud.erfi.dev/dashboard`
- Time series visualization
- Precision/recall metrics
- Model version tracking
- Score distribution histograms

## Performance

### Latency Breakdown

| Stage | Latency | Optimization |
|-------|---------|--------------|
| Feature extraction | 1-3ms | In-memory computation |
| Model loading (cache hit) | <0.1ms | 60s TTL in-memory cache |
| Model loading (cache miss) | 10-50ms | KV fetch with edge caching |
| Random Forest evaluation | 1-2ms | Optimized tree traversal |
| Decision Tree evaluation | <1ms | Single tree, fast fallback |
| Total (typical) | **5-10ms** | Including logging |

### Caching Strategy

1. **Model cache**: 60-second TTL in Worker memory
2. **KV edge cache**: Cloudflare's global cache
3. **Hot reload**: Models update within 60s without redeployment

## Configuration

### Thresholds

**File**: `config/production/config.json` (stored in KV)

```json
{
  "blockThreshold": 0.65,
  "warnThreshold": 0.35,
  "modelVersion": "3.0.0-forest"
}
```

**Update via CLI**:
```bash
wrangler kv key put config.json \
  --binding CONFIG \
  --path config/production/config.json \
  --remote
```

### Model Selection

The system automatically selects the best available model:

1. **Random Forest** (if available) → Primary scoring
2. **Decision Tree** (if RF unavailable) → Fallback
3. **Hard rules** (if no models) → Safe default (block disposable only)

## Troubleshooting

### Score Too High (False Positives)

**Symptom**: Legitimate users blocked

**Diagnosis**:
```bash
npm run cli test:api user@example.com --debug
```

**Common Causes**:
- Sequential numbering in email (e.g., "john1985@gmail.com")
- Uncommon TLD (.xyz, .info)
- Name mismatch (submission name ≠ email name)

**Solutions**:
1. Adjust `blockThreshold` upward (0.65 → 0.70)
2. Retrain model with more diverse legitimate samples
3. Add feature weights to downweight less reliable signals

### Score Too Low (False Negatives)

**Symptom**: Fraud getting through

**Diagnosis**: Check analytics dashboard for missed fraud patterns

**Common Causes**:
- Novel fraud patterns not in training data
- Sophisticated bots mimicking real users
- Model drift (training data outdated)

**Solutions**:
1. Adjust `blockThreshold` downward (0.65 → 0.60)
2. Add new fraud samples to training dataset
3. Retrain model with conflict zone weighting

### Model Not Loading

**Symptom**: `decision_tree_version: "unavailable"` in logs

**Diagnosis**:
```bash
wrangler kv key list --binding CONFIG --remote
wrangler kv key get decision_tree.json --binding CONFIG --remote
```

**Solutions**:
1. Verify KV binding in `wrangler.jsonc`
2. Upload model: `npm run cli model:train -- --n-trees 1 --upload`
3. Check KV size limits (25MB max)

## References

- [DETECTORS.md](./DETECTORS.md) - Feature extraction details
- [MODEL_TRAINING_v3.md](./MODEL_TRAINING_v3.md) - Training workflow
- [CONFIGURATION.md](./CONFIGURATION.md) - KV and D1 setup
- [ARCHITECTURE.md](./ARCHITECTURE.md) - System overview

## Changelog

### v3.0.0 (2025-11-30)
- ✅ Unified Random Forest + Decision Tree inference
- ✅ 45-feature vector with MX, geo, identity, and multilingual n-gram signals
- ✅ Conflict zone weighting for high-entropy fraud
- ✅ KV-backed models with hot-reload
- ✅ Comprehensive logging to D1

### v2.x
- Legacy rule-based scoring (deprecated)
