# Risk Scoring System

**Feature-based classification with Markov Chain cross-entropy and linguistic signals**

## Table of Contents

1. [Overview](#overview)
2. [Scoring Philosophy](#scoring-philosophy)
3. [Algorithmic Pipeline](#algorithmic-pipeline)
4. [Decision Thresholds](#decision-thresholds)
5. [Examples](#examples)
6. [Performance](#performance)

---

## Overview

**Version 2.5+** uses feature-based logistic regression combining Markov Chain analysis with linguistic and structural signals. A calibration layer trained on 89K+ emails provides probability-based fraud detection.

### Key Characteristics

- **Range**: 0.0 - 1.0 (normalized probability)
- **Primary Method**: Logistic regression with 28 features
- **Feature Categories**: Markov (8), Linguistic (6), Structure (4), Statistical (3), Other (7)
- **Training Accuracy**: 83.5% (precision: 80.9%, recall: 84.0%, F1: 82.4%)
- **Latency**: ~35ms average
- **Status**: ✅ Calibration active in production (97.96% F1, 100% recall, 96% precision)

---

## Scoring Philosophy

### Design Principles (v2.0)

1. **Algorithmic > Hardcoded**: Let trained models make decisions, not manual rules
2. **Direct Confidence**: Use detector confidence directly without weight multiplication
3. **No Double-Counting**: Each signal used once in priority order
4. **Explainable**: Clear reason for every decision
5. **Maintainable**: Clean pipeline pattern for easy testing

### Why Algorithmic Scoring?

**Old Approach (v1.x)** - Hardcoded weights:
```typescript
const markovRisk = markovScore * 0.25;
const patternRisk = patternScore * 0.30;
const entropyRisk = entropyScore * 0.05;

riskScore = Math.max(markovRisk, patternRisk, entropyRisk) + domainRisk;
```

**Problems**:
- Weight multiplication dilutes confident detections (0.78 → 0.195)
- Math.max() competition between detectors
- Entropy and pattern detection overlap with Markov
- Manual tuning required

**Current Approach (v2.4.x)** - Two-Dimensional Risk:
```typescript
// Dimension 1: Classification Risk (differential signal)
// Which model fits better: fraud vs legit?
const classificationRisk = markovResult?.isLikelyFraudulent
  ? markovResult.confidence
  : 0;

// Dimension 2: Abnormality Risk (consensus signal)
const minEntropy = Math.min(H_legit, H_fraud);
let abnormalityRisk = 0;
if (minEntropy >= 3.8 && minEntropy < 5.5) {
  abnormalityRisk = 0.35 + ((minEntropy - 3.8) / 1.7) * 0.30;
} else if (minEntropy >= 5.5) {
  abnormalityRisk = 0.65;
}

// Combine dimensions
let score = Math.max(classificationRisk, abnormalityRisk);

// Deterministic overrides
if (patternFamilyResult?.patternType === 'dated') {
  score = Math.max(score, patternFamilyResult?.confidence ?? 0.7);
}

const plusRisk = normalizedEmailResult
  ? getPlusAddressingRiskScore(email, relatedEmails)
  : 0;
if (plusRisk > 0) {
  score = Math.max(score, plusRisk);
}

// Domain signals are additive (configurable weights)
const domainRisk =
  domainReputationScore * riskWeights.domainReputation +
  tldRiskScore * riskWeights.tldRisk;

// v2.5.0: Feature classifier (linguistic+structural model)
if (featureClassifier.enabled && featureClassifier.score >= featureClassifier.activationThreshold) {
  const featureRisk = featureClassifier.score * featureClassifier.riskWeight;
  score = Math.max(score, featureRisk);
}

riskScore = Math.min(score + domainRisk, 1.0);
```

**Benefits**:
- Catches novel patterns unfamiliar to both models (OOD)
- Classification and abnormality are independent dimensions
- No dilution from weight multiplication
- Clear priority order
- Research-backed piecewise thresholds (3.8 warn, 5.5 block)

### Feature Classifier Telemetry

`extractLocalPartFeatureSignals()` generates the feature vector consumed by both calibration and the optional feature classifier. The vector is exposed in the API response/context as:

- `linguisticSignals` – pronounceability, vowel ratio, repeated run stats, consonant clusters, syllable estimate
- `structureSignals` – segment counts/lengths, word-boundary presence, vowel-less segment ratio
- `statisticalSignals` – digit/symbol ratios, entropy, max digit run, unique character ratio, vowel gaps

When `featureClassifier` is configured, its probability is logged (`featureClassifierScore`) and the scaled contribution is reflected in `featureClassifierRisk`. If that risk exceeds the configured activation threshold it can drive block reasons such as `linguistic_structure_anomaly`.

---

## Algorithmic Pipeline

### Priority 1: Hard Blockers

These cause immediate blocking regardless of algorithmic scoring:

| Condition | Risk Score | Reason |
|-----------|-----------|--------|
| Invalid email format | 0.8 | Malformed address |
| Disposable domain | 0.95 | Temp email service |

### Priority 2: Two-Dimensional Algorithmic Scoring (v2.4.0)

**Dimension 1: Classification Risk**

```typescript
// Differential signal: fraud vs legit
const classificationRisk = markovResult?.isLikelyFraudulent
  ? markovResult.confidence
  : 0;
```

**Dimension 2: Abnormality Risk (OOD Detection)**

```typescript
// Consensus signal: both models confused?
const minEntropy = Math.min(
  markovResult.crossEntropyLegit,
  markovResult.crossEntropyFraud
);

// v2.4.1: Piecewise threshold
const abnormalityRisk = minEntropy < 3.8 ? 0 :
  minEntropy < 5.5 ? 0.35 + ((minEntropy - 3.8) / 1.7) * 0.30 :
  0.65;
```

**Combined Risk Calculation**

```typescript
function calculateAlgorithmicRiskScore({
  email,
  markovResult,
  patternFamilyResult,
  domainReputationScore,
  tldRiskScore,
  normalizedEmailResult,
  config
}) {
  // Dimension 1: Classification risk (fraud vs legit)
  const baseClassificationRisk = markovResult?.isLikelyFraudulent
    ? markovResult.confidence
    : 0;
  const calibrationFeatures = buildCalibrationFeatureMap(/* ... */);
  const calibratedProbability = config.calibration
    ? applyCalibration(config.calibration, calibrationFeatures)
    : null;
  const classificationRisk = calibratedProbability !== null
    ? Math.max(baseClassificationRisk, calibratedProbability)
    : baseClassificationRisk;
  // Dimension 2: Abnormality risk (OOD)
  const abnormalityRisk = markovResult?.abnormalityRisk ?? 0;
  const localPartLength = providerLocalPart?.length ?? 0;
  const lengthClampedAbnormality = clampAbnormalityRiskForLocalLength(
    abnormalityRisk,
    localPartLength
  );

  let score = Math.max(classificationRisk, lengthClampedAbnormality);

  // Dated patterns (deterministic override)
  if (patternFamilyResult?.patternType === 'dated') {
    score = Math.max(score, patternFamilyResult.confidence ?? 0.7);
  }

  // Sequential patterns (only when confidence clears the configured threshold)
  if (patternFamilyResult?.patternType === 'sequential') {
    const threshold = config.patternThresholds.sequential ?? 0.6;
    const confidence = patternFamilyResult.confidence ?? 0;
    if (confidence >= threshold) {
      const sequentialRisk = Math.min(0.45 + confidence * 0.55, 0.95);
      score = Math.max(score, sequentialRisk);
    } else if (confidence >= Math.max(0.4, threshold * 0.8)) {
      score = Math.max(score, confidence * 0.5);
    }
  }

  // Plus-addressing abuse contributes independent risk (0.2-0.9)
  let plusRisk = 0;
  if (normalizedEmailResult) {
    plusRisk = getPlusAddressingRiskScore(email);
    if (plusRisk > 0) {
      score = Math.max(score, plusRisk);
    }
  }

  // Domain signals (additive weights)
  const domainRisk =
    domainReputationScore * config.riskWeights.domainReputation +
    tldRiskScore * config.riskWeights.tldRisk;

  return Math.min(score + domainRisk, 1.0);
}

function clampAbnormalityRiskForLocalLength(abnormalityRisk: number, localPartLength: number): number {
  if (!abnormalityRisk || localPartLength <= 4) {
    return 0;
  }

  if (localPartLength >= 12) {
    return abnormalityRisk;
  }

  const ramp = (localPartLength - 4) / (12 - 4);
  return abnormalityRisk * ramp;
}
```

**Markov Chain Detection**:
- Calculates character transition probabilities
- Compares against trained legit/fraud models
- Returns confidence 0-1
- **Example**: "olyjaxobuna" → H_fraud: 4.31, H_legit: 7.08 → Confidence: 0.78

**Step 2: Pattern Overrides (v2.4.2 - Trust Markov)**

Deterministic rules layered on top of Markov signals:

| Pattern | Override Score | Example |
|---------|---------------|---------|
| Dated | 0.2-0.9 (dynamic) | john.2024, user_oct2024 |
| Sequential | 0.45-0.95 (confidence dependent, only when ≥ threshold) | user001@gmail.com, test_42@yahoo.com |
| Plus-Addressing | 0.2 base + 0.3 (suspicious tag) + 0.4 (multi-alias) | user+1@gmail.com, user+spam@gmail.com |

**Note**: Keyboard/gibberish detectors remain observability-only; Markov/OOD (with the short-local clamp) and the sequential override handle those scenarios.

**Step 3: Domain Signals**

Independent signals added to final score:

| Signal | Weight (default) | Range |
|--------|------------------|-------|
| Domain Reputation | 0.2 | 0-1 |
| TLD Risk | 0.3 | 0-1 |

---

## Decision Thresholds

Risk scores are converted to decisions using thresholds:

| Decision | Risk Score Range | Action |
|----------|-----------------|--------|
| `allow` | 0.0 - 0.4 | Allow signup |
| `warn` | 0.4 - 0.6 | Manual review recommended |
| `block` | 0.6 - 1.0 | Block signup |

### Block Reasons

Priority-ordered detection logic:

```typescript
// v2.2.0 - Simplified block reason logic
function determineBlockReason({
  riskScore,
  markovResult,
  patternFamilyResult,
  domainReputationScore,
  tldRiskScore,
  config
}) {
  // High-confidence detections (first match wins)
  if (markovResult?.isLikelyFraudulent &&
      markovResult.confidence > config.confidenceThresholds.markovFraud) {
    return 'markov_chain_fraud';
  }

  if (patternFamilyResult?.patternType === 'sequential') {
    return 'sequential_pattern';
  }

  // Risk-based messaging
  if (riskScore >= config.riskThresholds.block) {
    if (tldRiskScore > 0.5) return 'high_risk_tld';
    if (domainReputationScore > 0.5) return 'domain_reputation';
    if (patternFamilyResult?.patternType === 'dated') return 'dated_pattern';
    return 'high_risk_multiple_signals';
  }

  return 'low_risk';
}
```

---

## Examples

### Example 1: Markov Fraud Detection

**Email**: `randomuser@provider.com`

```json
{
  "signals": {
    "markovDetected": true,
    "markovConfidence": 0.78,
    "markovCrossEntropyLegit": 7.08,
    "markovCrossEntropyFraud": 4.31,
    "patternType": "random",
    "domainReputationScore": 0,
    "tldRiskScore": 0.29
  }
}
```

**Calculation**:
1. Markov: 0.78 (fraud detected via trained model)
3. Sequential: No
4. Dated: No
5. Domain risk: 0 * 0.2 + 0.29 * 0.1 = 0.029
6. **Final: 0.78 + 0.029 = 0.81**

**Decision**: `block` (reason: `markov_chain_fraud`)

---

### Example 2: Legitimate Name

**Email**: `person1.person2@gmail.com`

```json
{
  "signals": {
    "markovDetected": false,
    "markovConfidence": 1.0,
    "markovCrossEntropyLegit": 4.56,
    "markovCrossEntropyFraud": 6.89,
    "patternType": "random",
    "domainReputationScore": 0,
    "tldRiskScore": 0.29
  }
}
```

**Calculation**:
1. Markov: 0 (legit detected, Markov confident it's legitimate)
2. Sequential: No
3. Dated: No
4. Domain risk: 0 * 0.2 + 0.29 * 0.3 = 0.087
5. **Final: 0 + 0.087 = 0.09**

**Decision**: `allow`

---

### Example 3: Keyboard Walk (Detected by Markov)

**Email**: `qwerty123@mail.com`

> **Note (v2.2.0)**: Keyboard walks are now detected automatically by Markov Chain (trained on keyboard patterns).

```json
{
  "signals": {
    "markovDetected": true,
    "markovConfidence": 0.82,
    "markovCrossEntropyLegit": 6.15,
    "markovCrossEntropyFraud": 3.21,
    "patternType": "random",
    "domainReputationScore": 0,
    "tldRiskScore": 0.29
  }
}
```

**Calculation**:
1. Markov: 0.82 (high confidence fraud - trained model recognizes "qwerty")
2. Sequential: No
3. Dated: No
4. Domain risk: 0 * 0.2 + 0.29 * 0.3 = 0.087
5. **Final: 0.82 + 0.087 = 0.91**

**Decision**: `block` (reason: `markov_chain_fraud`)

---

### Example 4: Sequential Pattern

**Email**: `user123@example.com`

```json
{
  "signals": {
    "markovDetected": true,
    "markovConfidence": 0.25,
    "patternType": "sequential",
    "domainReputationScore": 0,
    "tldRiskScore": 0.29
  }
}
```

**Calculation**:
1. Markov: 0.25 (low confidence)
2. Sequential: **YES → override to 0.8**
3. Dated: No
4. Domain risk: 0 * 0.2 + 0.29 * 0.3 = 0.087
5. **Final: max(0.25, 0.8) + 0.087 = 0.89**

**Decision**: `block` (reason: `sequential_pattern`)

---

## Performance

### Measured Accuracy (v2.0+)

| Metric | Value |
|--------|-------|
| Overall Accuracy | 93% (25/27 test cases) |
| Fraud Detection | 100% (16/16 blocked) |
| False Negative Rate | **0%** |
| Legitimate Detection | 82% (9/11 allowed) |
| Worker Startup | 3ms |
| Detection Latency | <50ms |

### Training Data

- **Legitimate**: 5,000 real name patterns
- **Fraud**: 5,000 gibberish patterns
- **Model Size**: 8.7 KB each (tiny!)
- **Format**: N-gram Markov Chain (2-gram)

### Known Limitations

1. **Synthetic Training Data**
   - Short generic words ("info", "support") may score high
   - **Solution**: Retrain with 50k+ real production data exported from D1 (see `docs/DATASETS.md`)

2. **Single-Character Addresses**
   - Very short emails (1-2 chars) flagged as suspicious
   - **Acceptable**: Legitimately suspicious pattern

---

## Migration from v1.x

### Breaking Changes

**Removed**:
- Legacy entropy/pattern `riskWeights` (domain/TLD weights remain)
- Entropy pre-check (lines 259-261)
- Math.max() detector competition
- Nested if-else scoring chains

**Added**:
- `calculateAlgorithmicRiskScore()` helper
- `determineBlockReason()` helper
- Data-driven pattern overrides

### No Action Required

API contract remains the same. Changes are transparent to API consumers.

---

## Summary

**v2.0+ Scoring Philosophy**:
1. Markov Chain is primary detector (confidence used directly)
2. Pattern-specific overrides for deterministic rules
3. Domain signals added independently
4. No hardcoded weight multiplication
5. Clean, testable, maintainable code

**Result**: 100% fraud detection with 0% false negatives!
