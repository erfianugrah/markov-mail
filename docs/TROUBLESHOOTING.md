# Troubleshooting Guide

**Version**: 3.0.1
**Last Updated**: 2025-12-01

Comprehensive troubleshooting guide for Markov Mail fraud detection system, including common issues, diagnostic procedures, and historical problem analyses.

## Table of Contents

- [Quick Diagnosis](#quick-diagnosis)
- [Feature Extraction Issues](#feature-extraction-issues)
- [Model Performance Problems](#model-performance-problems)
- [Production Validation Failures](#production-validation-failures)
- [Training Data Issues](#training-data-issues)
- [Historical Problem Analyses](#historical-problem-analyses)

## Quick Diagnosis

### Symptoms Checklist

| Symptom | Likely Cause | Section |
|---------|--------------|---------|
| Training 95% recall, production 77% | Feature extraction mismatch | [Feature Extraction](#feature-extraction-issues) |
| High false positive rate (>10%) | Threshold too low or training data imbalance | [Model Performance](#model-performance-problems) |
| High false negative rate (>10%) | Threshold too high or missing fraud patterns | [Model Performance](#model-performance-problems) |
| Model not loading errors | KV upload failed or corrupt model | [Operations Guide](./OPERATIONS.md#model-not-loading) |
| Validation hangs/timeouts | MX lookup timeouts or rate limiting | [Feature Extraction](#mx-lookup-failures) |

### Quick Checks

```bash
# 1. Verify production model version
wrangler kv key get random_forest.json \
  --namespace-id e24fcc002bc64157a1940650c348d335 \
  --remote | jq '.meta.version'

# 2. Check config thresholds
wrangler kv key get config.json \
  --namespace-id e24fcc002bc64157a1940650c348d335 \
  --remote | jq '.riskThresholds'

# 3. Test single email with debug
npm run cli test:api test@example.com --debug

# 4. Check recent error rate
wrangler d1 execute DB --remote --command="
  SELECT COUNT(*) as errors
  FROM validations
  WHERE timestamp >= datetime('now', '-1 hour')
    AND error IS NOT NULL
"
```

## Feature Extraction Issues

### MX Lookup Failures

**Problem**: MX DNS lookups timeout or fail, causing feature extraction mismatch between training and production.

#### Symptoms

- Production metrics significantly worse than training (>10% degradation)
- Risk scores consistently lower than expected
- False negative rate higher in production

#### Diagnosis

1. **Test MX lookup directly**:
```bash
npm run cli test:api user@gmail.com --debug
# Look for MX-related features in output
```

2. **Check MX feature population**:
```bash
# Training: All MX features should be populated
npm run cli features:export -- --input data/test-sample.csv --output /tmp/test-features.csv
head /tmp/test-features.csv | grep mx_

# Production: Compare MX features from API debug output
```

3. **Measure timeout rate**:
Look for `null` MX analysis in production logs.

#### Root Cause

**Training** (cli/commands/features/export.ts:232-298):
- Pre-fetches ALL MX records with no timeout
- 100% MX feature population rate

**Production** (src/middleware/fraud-detection.ts:226-270):
- MX lookup with timeout (default: 350ms, increased to: 1500ms)
- On timeout/failure: All MX features become 0/false
- Feature distribution shift causes misclassification

**Impact**: MX features account for ~6.3% of model importance:
- `mx_record_count`: 3.21% (7th most important overall)
- `mx_has_records`: 0.78%
- `mx_provider_google`: 0.76%
- `mx_provider_microsoft`: 0.72%
- `mx_provider_self_hosted`: 0.54%
- Other MX features: ~0.4%

#### Solutions

**Implemented**: Hybrid MX resolution with increased timeout (1500ms)

```typescript
// src/middleware/fraud-detection.ts
const MX_LOOKUP_TIMEOUT_MS = 1500; // Increased from 350ms

// 1. Check well-known provider cache (instant)
const wellKnown = getWellKnownMX(domain);
if (wellKnown) return wellKnown;

// 2. Live DNS with extended timeout (1.5s)
const mxPromise = resolveMX(domain);
const timeoutPromise = new Promise(resolve =>
  setTimeout(() => resolve(null), MX_LOOKUP_TIMEOUT_MS)
);
const lookupResult = await Promise.race([mxPromise, timeoutPromise]);
```

**Alternative Solutions**:
1. **Pre-populate MX Cache**: Store MX records in KV, update via cron
2. **Train Without MX Features**: Eliminates dependency (loses 6.3% signal)
3. **MX Fallback Values**: Use domain reputation as proxy for MX features

#### Expected Outcome

With hybrid MX resolution:
- MX lookup success: 350ms ~70% → 1.5s ~95%+
- Well-known providers: 100% instant (Gmail, Outlook, Yahoo, etc.)
- Production recall: 77% → 90%+ (matching training)
- Production FPR: 12% → ~4% (matching training)

### Feature Computation Mismatches

**Problem**: Feature extraction differs between training and runtime.

#### Common Causes

1. **Normalization differences**
2. **Missing feature dependencies**
3. **Version mismatches in detectors**
4. **Encoding issues (Unicode handling)**

#### Diagnosis

1. **Compare feature vectors**:
```bash
# Export features for known email
echo "email,name,label" > /tmp/test-single.csv
echo "test@example.com,Test User,legitimate" >> /tmp/test-single.csv
npm run cli features:export -- --input /tmp/test-single.csv --output /tmp/features-training.csv

# Get production features via API
npm run cli test:api test@example.com --debug > /tmp/features-production.txt

# Compare manually or use diff tool
```

2. **Check detector versions**:
```bash
grep "version" src/detectors/*.ts
```

3. **Verify feature alignment**:
Ensure feature order matches between training export and runtime extraction.

#### Solutions

- Ensure same detector code used in training and production
- Add feature extraction tests comparing training/runtime output
- Document feature computation dependencies

## Model Performance Problems

### High False Positive Rate

**Problem**: Legitimate emails being incorrectly classified as fraud.

#### Symptoms

- FPR >10% in production
- Customer complaints about blocked emails
- Specific patterns incorrectly flagged

#### Investigation Steps

1. **Analyze false positive samples**:
```bash
npm run cli -- test:batch -- \
  --input data/synthetic-validation.csv \
  --endpoint https://fraud.erfi.dev/validate \
  --save-samples

# Check /tmp/batch-test-results-*.json for falsePositives array
cat /tmp/batch-test-results-latest.json | jq '.samples.falsePositives[] | {email, riskScore, reason}'
```

2. **Check risk score distribution**:
Look for legitimate emails clustered near block threshold.

3. **Review risk heuristics**:
```bash
wrangler kv key get risk-heuristics.json \
  --namespace-id e24fcc002bc64157a1940650c348d335 \
  --remote | jq '.'
```

#### Common Causes

1. **Threshold too aggressive**: Block threshold too low
2. **Training data bias**: Not enough diverse legitimate examples
3. **Overly strict heuristics**: Risk heuristics too harsh
4. **Domain reputation issues**: Legitimate domains misclassified

#### Solutions

**Immediate**:
```bash
# Raise block threshold
npm run cli -- config:update-thresholds -- --block 0.5 --remote
```

**Medium-term**:
1. Review and adjust risk heuristic weights
2. Add false positive examples to training data
3. Retrain with more balanced dataset

**Long-term**:
1. Implement feedback loop for corrections
2. A/B test threshold adjustments
3. Add domain whitelist for known legitimate providers

### High False Negative Rate

**Problem**: Fraudulent emails passing through undetected.

#### Symptoms

- FNR >10% in production
- Known fraud patterns not caught
- Low recall (<90%)

#### Investigation Steps

1. **Analyze false negative samples**:
```bash
# Check false negatives from batch test
cat /tmp/batch-test-results-latest.json | jq '.samples.falseNegatives[] | {email, riskScore, reason}'
```

2. **Identify common patterns**:
Look for shared characteristics in missed fraud:
- Typosquatting (e.g., yaho0.com, 0utlook.com)
- Plus-addressing abuse
- Sequential/gibberish patterns
- Disposable domains

3. **Check feature importance**:
```bash
# View feature contributions
cat config/production/random-forest.auto.json | jq '.featureImportance | to_entries | sort_by(-.value) | .[0:10]'
```

#### Common Causes

1. **Threshold too lenient**: Block threshold too high
2. **Missing fraud patterns**: Training data lacks variety
3. **Weak heuristics**: Risk heuristics not covering new fraud types
4. **Feature gaps**: Important fraud signals not captured

#### Solutions

**Immediate**:
```bash
# Lower block threshold
npm run cli -- config:update-thresholds -- --block 0.3 --remote
```

**Medium-term**:
1. Add targeted heuristics for missed patterns
2. Enhance synthetic data generator with more fraud variety
3. Review and strengthen weak detectors

**Long-term**:
1. Retrain with enhanced fraud patterns (see [Training Data Issues](#training-data-issues))
2. Add new detectors for emerging fraud patterns
3. Implement ensemble approach with multiple models

## Production Validation Failures

### Training Metrics Don't Match Production

**Problem**: Training shows excellent performance, production significantly worse.

#### Example Case

**Training**: 95.82% recall, 4.03% FPR
**Production**: 77.2% recall, 12.11% FPR

#### Systematic Investigation

1. **Verify remote state**:
```bash
# Check model checksum
wrangler kv key get random_forest.json \
  --namespace-id e24fcc002bc64157a1940650c348d335 \
  --remote > /tmp/remote.json
shasum -a 256 /tmp/remote.json config/production/random-forest.auto.json

# Verify config sync
wrangler kv key get config.json \
  --namespace-id e24fcc002bc64157a1940650c348d335 \
  --remote | jq '.riskThresholds'
```

2. **Test with training dataset**:
```bash
# Use exact same data for validation
npm run cli -- test:batch -- \
  --input data/main.csv \
  --endpoint https://fraud.erfi.dev/validate
```

3. **Compare feature extraction**:
See [Feature Extraction Issues](#feature-extraction-issues).

#### Root Causes

1. **Feature extraction mismatch** (most common)
   - MX lookup failures
   - Detector version differences
   - Normalization issues

2. **Config not synced**
   - Thresholds don't match
   - Risk heuristics outdated
   - Model version mismatch

3. **Data distribution shift**
   - Validation data doesn't match training distribution
   - Synthetic data not representative

## Training Data Issues

### Insufficient Fraud Pattern Variety

**Problem**: Model fails to detect certain fraud patterns not well-represented in training data.

#### Example Case (2025-12-01)

**Observed**: Typosquatting patterns (yaho0.com, 0utlook.com) scored 0.01-0.21 instead of >0.8

**Root Cause**: Training data only had 12 hardcoded typosquatting variants

#### Solution

Enhanced synthetic data generator to dynamically generate 393 typosquatted variants:

```typescript
// cli/commands/data/synthetic.ts

// Character substitutions (homoglyphs)
const substitutions: Record<string, string[]> = {
  'a': ['a', '@', '4'],
  'e': ['e', '3'],
  'i': ['i', '1', 'l', '!'],
  'o': ['o', '0'],
  's': ['s', '5', '$'],
  'l': ['l', '1', 'i'],
  't': ['t', '7'],
  'g': ['g', '9', 'q'],
  'm': ['m', 'n', 'rn'],
  'n': ['n', 'm']
};

// Generate variants for all major providers
const legitimateProviders = [
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com",
  "live.com", "msn.com", "aol.com", "icloud.com", // ...
];

for (const provider of legitimateProviders) {
  typosquattedDomains.push(...generateTyposquattedVariants(provider));
}

// Weighted fraud distribution (typosquatting at 3x weight)
const fraudGenerators = [
  { generator: generateTyposquattedDomainFraud, weight: 30 },
  { generator: generateHomoglyphFraud, weight: 30 },
  // ... other generators with lower weights
];
```

**Result**: 393 typosquatted domain variants covering:
- Character substitutions (homoglyphs)
- Character swaps (transpositions)
- Double letters
- Missing letters
- TLD variations

#### Training Data Best Practices

1. **Diverse fraud patterns**: Ensure all fraud types well-represented
2. **Weighted distribution**: Give critical patterns higher weight (3x for typosquatting)
3. **Real-world data**: Supplement synthetic with real fraud examples (Enron dataset)
4. **Balanced classes**: Maintain ~70% legit, ~30% fraud ratio
5. **Regular updates**: Regenerate training data as new fraud patterns emerge

### Data Quality Issues

**Common Problems**:
1. Duplicate emails
2. Mislabeled examples
3. Unrealistic synthetic data
4. Missing feature values

**Cleanup Commands**:
```bash
# Deduplicate dataset
npm run cli -- data:clean --input data/main.csv --output data/main-clean.csv

# Validate labels
npm run cli -- data:validate --input data/main.csv

# Check for missing values
awk -F',' 'NF!=3' data/main.csv | head
```

## Historical Problem Analyses

### Case Study: MX Lookup Timeout (2025-12-01)

**Timeline**:
- **08:52**: Completed automated training (95.82% recall)
- **08:56**: Production validation showed 77.1% recall
- **09:00**: Diagnosed MX lookup timeout as root cause
- **09:15**: Implemented hybrid MX resolution (350ms → 1500ms timeout)
- **09:30**: Deployed fix, validation improved to 85.74% recall
- **10:00**: Identified secondary issue (training data mismatch)

**Findings**:
1. Training pre-fetches all MX records (100% success)
2. Production has 350ms timeout (estimated ~70% success)
3. MX features = 6.3% of model importance
4. 30% MX failure rate × 6.3% importance ≈ 18% performance loss

**Solution**: Hybrid MX resolution with well-known provider cache + 1500ms timeout

**Outcome**: Partial improvement (77% → 85.7% recall), identified need for better training data

### Case Study: Training Data Mismatch (2025-12-01)

**Timeline**:
- **09:30**: After MX fix, recall improved but still below target (85.7% vs 90%)
- **09:45**: Analyzed false negatives, found typosquatting not detected
- **10:00**: Identified training data only had 12 typosquatting variants
- **10:30**: Enhanced synthetic generator with 393 variants
- **11:00**: Generated 500k enhanced synthetic emails
- **11:30**: Merged with 172k Enron emails (672k total)
- **12:00**: Started retraining with comprehensive dataset

**False Negative Examples**:
```json
[
  {"email": "khalid_al-kaabi@yaho0.com", "expected": "fraud", "actual": "allow", "riskScore": 0.01},
  {"email": "matti_korhonen@0utlook.com", "expected": "fraud", "actual": "allow", "riskScore": 0.01},
  {"email": "elizabeth.l0pez@hotmail.com", "expected": "fraud", "actual": "allow", "riskScore": 0.07}
]
```

**Solution**: Dynamically generate typosquatted variants with weighted distribution

**Expected Outcome**: Model trained on 672k emails with comprehensive fraud patterns should achieve >90% recall in production

### Case Study: Data Leakage & Sampling Bias (2025-12-01)

**Critical Lessons**: Two subtle training pitfalls discovered that caused 5x worse production performance than expected.

#### Timeline

- **09:30**: Training completed with `noSplit=true` - 6.98% FPR on training data
- **10:20**: Production validation showed 42% FPR (6x worse!)
- **10:30**: Identified **data leakage**: model trained and calibrated on same data
- **10:50**: Fixed with proper 80/20 train/test split (`noSplit=false`)
- **10:52**: New model showed 7.69% FPR on held-out test set ✓
- **10:55**: Production validation STILL showed 38.89% FPR (5x worse!)
- **11:00**: Hypothesis test revealed **sampling bias**: test set not representative
- **11:06**: Solution implemented with `noSplit=true` but proper understanding

#### Problem #1: Data Leakage (The Obvious Issue)

**What Happened**:
```
Training approach: noSplit=true
├── Train on 100% of data (1.17M samples)
├── Calibrate thresholds on same 100% of data
└── Result: Model memorized data, thresholds optimized for seen data

Production reality: New emails don't match memorized patterns
└── Result: 42% FPR (vs 6.98% on training data)
```

**Root Cause**:
- Threshold optimization on training data creates circular reasoning
- Model learns specific emails, not general patterns
- Thresholds (warn=0.3, block=0.35) worked perfectly for training data
- Same thresholds catastrophically failed on unseen data

**Initial Fix**: Use proper 80/20 train/test split with `noSplit=false`
```bash
npm run pipeline -- \
  --dataset data/main-final.csv \
  --search '[{"label":"proper-split","nTrees":100,"noSplit":false}]'
```

**Result**: 7.69% FPR on held-out test set (excellent!)

#### Problem #2: Sampling Bias (The Hidden Issue)

**The Irony**: Fixing data leakage introduced a WORSE problem.

**What Happened**:
```
Proper 80/20 split (random, not stratified):
├── Training: 938,276 samples (80%)
├── Test: 234,569 samples (20%)
└── By chance, test set got "easier" legitimate emails

Score distribution mismatch:
├── Test set legit: Mean raw score 0.22, only 7.81% in high-risk range
├── Full population: ~40% of legit emails score in high-risk range
└── Thresholds optimized for test set fail on full population
```

**Evidence**:

| Dataset | FPR at threshold 0.35 | Representative? |
|---------|----------------------|-----------------|
| Held-out test set (20%) | 7.69% ✓ | ❌ Biased sample |
| Real Enron training data | 39.6% ✗ | ✓ Representative |
| Synthetic validation data | 38.9% ✗ | ✓ Representative |

**Critical Discovery**: Model flagged **39.6% of its own training data** as fraud!

**Root Cause Analysis**:

1. **Random Split Created Selection Bias**:
   - Test set happened to get legitimate emails with lower raw scores
   - Training set got legitimate emails with higher raw scores (~0.40)
   - Model trained correctly, but threshold optimization used biased sample

2. **Score Distribution**:
   ```
   Raw score ~0.40 → Calibrated 0.37 (via Platt scaling)

   Test set: Only 10,470 / 134,035 legit emails (7.81%) score in this range
   Full population: ~540,000 / 1,172,845 emails (~40%) score in this range

   Threshold 0.35 blocks all scores >= 0.35:
   - Test set: 7.69% FPR (looks great!)
   - Production: 40% FPR (catastrophic!)
   ```

3. **The Math**:
   ```
   Platt scaling: calibrated = 1 / (1 + exp(-(intercept + coef * raw)))
   With intercept=-6.65, coef=15.12:

   Raw 0.35 → Calibrated 0.204 (below threshold, ALLOW)
   Raw 0.40 → Calibrated 0.353 (below threshold, ALLOW)
   Raw 0.405 → Calibrated 0.370 (above threshold, BLOCK)

   Many legitimate emails naturally score raw ~0.40-0.41
   After calibration: 0.37-0.39 (just above 0.35 block threshold)
   ```

#### The Fundamental Problem

**Proper train/test split is necessary for model validation**, but **threshold calibration requires representative score distribution**.

When these goals conflict:
- ❌ DON'T use biased test set for threshold optimization
- ✓ DO use held-out test for model metrics
- ✓ DO use full training set (or stratified test) for threshold optimization

#### Solution: Hybrid Approach

**Correct Training Strategy**:
```bash
# Option 1: Use noSplit=true with full understanding
npm run pipeline -- \
  --dataset data/main-final.csv \
  --search '[{"label":"full-calibration","nTrees":100,"noSplit":true}]'

# Model trains on 100% (1.17M samples)
# Thresholds calibrated on same 100% (representative!)
# Accept mild overfitting for accurate threshold optimization

# Option 2: Use stratified test split (future enhancement)
# Split by score percentiles to ensure representative test set
```

**Key Insight**: Training data leakage is acceptable for **threshold calibration** but not for **model training**. We separate concerns:
- Model structure: Train once with proper validation
- Threshold optimization: Calibrate on representative sample (even if it's training data)

#### Impact on Production

**Before fix** (biased test set, noSplit=false):
- Test set: 7.69% FPR ✓
- Production: 39.6% FPR ✗ (blocks 40% of legitimate users!)

**After fix** (full dataset calibration, noSplit=true):
- Training set: ~10% FPR (properly calibrated on full distribution)
- Production: ~10% FPR (expected, representative)

#### Lessons Learned

1. **Random splitting != Representative splitting**
   - Use stratified splits for threshold calibration
   - Check if test set score distribution matches full population

2. **Multiple validation datasets required**:
   - Held-out test: For model generalization metrics
   - Full training set: For threshold calibration
   - Production sample: For final validation

3. **Always test on training data**:
   - If model fails on its own training data, something is fundamentally wrong
   - Our "properly validated" model scored 39.6% FPR on training data
   - This immediately revealed the sampling bias

4. **Beware correlation of fixes**:
   - Fixing data leakage (good) introduced sampling bias (worse)
   - Second problem was harder to detect because first fix looked successful
   - Always validate fixes against multiple independent datasets

#### Commands for Validation

```bash
# 1. Check test set representativeness
awk -F',' 'NR>1 && $2==0 {
  if ($1 >= 0.35 && $1 <= 0.45) high++
  total++
}
END {print "High-risk legit:", high, "/", total, "(" 100*high/total "%)"
}' data/calibration/latest.csv

# 2. Test model on its own training data (should have low FPR)
grep ",legitimate$" data/main-final.csv | head -10000 > /tmp/training-sample.csv
npm run cli -- test:batch --input /tmp/training-sample.csv \
  --endpoint https://fraud.erfi.dev/validate

# 3. Compare score distributions
npm run cli model:analyze -- \
  --training-scores data/calibration/latest.csv \
  --production-scores /tmp/prod-scores.csv \
  --compare-distributions
```

#### Prevention Checklist

Before deploying a new model:

- [ ] Train with proper train/test split for model validation
- [ ] Verify test set score distribution matches full population
- [ ] Calibrate thresholds on representative sample (full training set OK)
- [ ] Test model on its own training data (should recognize it!)
- [ ] Test on multiple independent validation sets
- [ ] Compare production score distribution with calibration distribution
- [ ] Document any sampling assumptions in manifest.json

## Diagnostic Tools

### Feature Extraction Debug Mode

```bash
npm run cli test:api user@example.com --debug
```

**Output includes**:
- Raw feature vector
- Detector execution times
- MX lookup results
- Risk score breakdown

### Batch Test with Sampling

```bash
npm run cli -- test:batch -- \
  --input data/validation.csv \
  --endpoint https://fraud.erfi.dev/validate \
  --save-samples \
  --sample-size 100
```

**Saves**:
- All false positives
- All false negatives
- Random sample of correct classifications

### Model Introspection

```bash
# View feature importance
cat config/production/random-forest.auto.json | \
  jq '.featureImportance | to_entries | sort_by(-.value) | .[0:20]'

# View model metadata
cat config/production/random-forest.auto.json | \
  jq '{version: .meta.version, trees: .meta.nTrees, depth: .meta.maxDepth, features: .meta.nFeatures}'

# View calibration parameters
cat config/production/random-forest.auto.json | \
  jq '.meta.calibration'
```

### Analytics Queries

```bash
# Distribution of risk scores
wrangler d1 execute DB --remote --command="
  SELECT
    CASE
      WHEN risk_score < 0.35 THEN '0.00-0.35'
      WHEN risk_score < 0.65 THEN '0.35-0.65'
      ELSE '0.65-1.00'
    END as score_range,
    COUNT(*) as count
  FROM validations
  WHERE timestamp >= datetime('now', '-24 hours')
  GROUP BY score_range
"

# Emails near decision boundary
wrangler d1 execute DB --remote --command="
  SELECT email_local_part, domain, risk_score, decision, block_reason
  FROM validations
  WHERE risk_score BETWEEN 0.3 AND 0.5
    AND timestamp >= datetime('now', '-1 hour')
  LIMIT 20
"
```

## Escalation

### When to Escalate

- Production metrics degraded >15% vs training
- Unable to diagnose root cause after 2 hours
- Data loss or corruption suspected
- Emergency circuit breaker needed

### Escalation Checklist

Gather this information before escalating:

1. **Symptoms**: What's broken? Include metrics.
2. **Timeline**: When did it start?
3. **Changes**: Recent deployments, config changes, data updates?
4. **Diagnostics**: What have you tried?
5. **Impact**: How many users affected?
6. **Urgency**: Is immediate action needed?

### Emergency Contacts

See [OPERATIONS.md](./OPERATIONS.md#emergency-procedures) for emergency procedures.

---

**Last Updated**: 2025-12-01
**Version**: 3.0.1
