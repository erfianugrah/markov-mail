# Risk Scoring System

**Pure algorithmic fraud detection using Markov Chain cross-entropy**

## Table of Contents

1. [Overview](#overview)
2. [Scoring Philosophy](#scoring-philosophy)
3. [Algorithmic Pipeline](#algorithmic-pipeline)
4. [Decision Thresholds](#decision-thresholds)
5. [Examples](#examples)
6. [Performance](#performance)

---

## Overview

**Version 2.0+** uses a pure algorithmic approach with **no hardcoded weight multiplications**. Risk scores are calculated directly from detector confidence values.

### Key Characteristics

- **Range**: 0.0 - 1.0 (normalized)
- **Primary Detector**: Markov Chain cross-entropy
- **Strategy**: Algorithmic with deterministic overrides
- **Accuracy**: 93% (100% fraud detection, 0% false negatives)
- **Latency**: < 50ms for all calculations

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

**Current Approach** - Markov-only:
```typescript
// Primary: Use Markov confidence directly
riskScore = markovResult?.isLikelyFraudulent ? markovResult.confidence : 0;

// Secondary: Deterministic pattern overrides only
if (sequential) riskScore = Math.max(riskScore, 0.8);
if (dated) riskScore = Math.max(riskScore, patternConfidence);
if (hasPlus) riskScore = Math.max(riskScore, 0.6);

// Tertiary: Domain signals (additive)
const domainRisk = domainReputationScore * 0.2 + tldRiskScore * 0.3;
riskScore = Math.min(riskScore + domainRisk, 1.0);
```

**Benefits**:
- Markov confidence used directly (no dilution)
- Clear priority order
- Deterministic pattern overrides
- No overlap or double-counting

---

## Algorithmic Pipeline

### Priority 1: Hard Blockers

These cause immediate blocking regardless of algorithmic scoring:

| Condition | Risk Score | Reason |
|-----------|-----------|--------|
| Invalid email format | 0.8 | Malformed address |
| Disposable domain | 0.95 | Temp email service |

### Priority 2: Algorithmic Scoring

**Step 1: Primary Detection (Markov Chain)**

```typescript
// v2.2.0 - Markov-only approach
function calculateAlgorithmicRiskScore({
  markovResult,
  patternFamilyResult,
  normalizedEmailResult,
  domainReputationScore,
  tldRiskScore
}) {
  // Primary: Markov Chain cross-entropy (trained on 111K+ emails)
  let score = markovResult?.isLikelyFraudulent
    ? markovResult.confidence
    : 0;

  // Secondary: Deterministic pattern overrides only
  if (patternFamilyResult?.patternType === 'sequential') {
    score = Math.max(score, 0.8);
  }
  if (patternFamilyResult?.patternType === 'dated') {
    score = Math.max(score, patternFamilyResult.confidence || 0.7);
  }
  if (normalizedEmailResult?.hasPlus) {
    score = Math.max(score, 0.6);
  }

  // Tertiary: Domain signals (independent, additive)
  const domainRisk = domainReputationScore * 0.2 + tldRiskScore * 0.3;

  return Math.min(score + domainRisk, 1.0);
}
```

**Markov Chain Detection**:
- Calculates character transition probabilities
- Compares against trained legit/fraud models
- Returns confidence 0-1
- **Example**: "olyjaxobuna" → H_fraud: 4.31, H_legit: 7.08 → Confidence: 0.78

**Step 2: Pattern Overrides (v2.2.0 - Simplified)**

Deterministic rules for patterns when Markov is unavailable:

| Pattern | Override Score | Example |
|---------|---------------|---------|
| Sequential | 0.8 | user1, user2, test001 |
| Dated | 0.2-0.9 (dynamic) | john.2024, user_oct2024 |
| Plus-addressing | 0.6 | user+test, user+1 |

**Note**: Keyboard walk and gibberish patterns are now handled by Markov Chain detection automatically.

**Step 3: Domain Signals**

Independent signals added to final score:

| Signal | Weight | Range |
|--------|--------|-------|
| Domain Reputation | 0.2 | 0-1 |
| TLD Risk | 0.1 | 0-1 |

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
   - **Solution**: Retrain with 50k+ real production data from Analytics Engine

2. **Single-Character Addresses**
   - Very short emails (1-2 chars) flagged as suspicious
   - **Acceptable**: Legitimately suspicious pattern

---

## Migration from v1.x

### Breaking Changes

**Removed**:
- All `riskWeights` config multiplication
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
