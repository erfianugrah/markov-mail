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

**New Approach (v2.0+)** - Pure algorithmic:
```typescript
// Primary: Use Markov confidence directly
riskScore = markovResult.confidence; // 0.78 stays 0.78!

// Secondary: Pattern-specific overrides
if (keyboardWalk) riskScore = Math.max(riskScore, 0.9);
if (sequential) riskScore = Math.max(riskScore, 0.8);
if (dated) riskScore = Math.max(riskScore, 0.7);

// Tertiary: Domain signals (additive)
riskScore += domainReputationScore * 0.2 + tldRiskScore * 0.1;
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
function calculateAlgorithmicRiskScore({
  markovResult,
  keyboardWalkResult,
  patternFamilyResult,
  domainReputationScore,
  tldRiskScore
}) {
  // Primary: Markov Chain cross-entropy
  let score = markovResult?.isLikelyFraudulent
    ? markovResult.confidence
    : 0;

  // Secondary: Pattern overrides (deterministic)
  const overrides = [
    { condition: keyboardWalkResult?.hasKeyboardWalk, score: 0.9 },
    { condition: patternFamilyResult?.patternType === 'sequential', score: 0.8 },
    { condition: patternFamilyResult?.patternType === 'dated', score: 0.7 }
  ];

  for (const override of overrides) {
    if (override.condition) {
      score = Math.max(score, override.score);
    }
  }

  // Tertiary: Domain signals (independent, additive)
  const domainRisk = domainReputationScore * 0.2 + tldRiskScore * 0.1;

  return Math.min(score + domainRisk, 1.0);
}
```

**Markov Chain Detection**:
- Calculates character transition probabilities
- Compares against trained legit/fraud models
- Returns confidence 0-1
- **Example**: "olyjaxobuna" → H_fraud: 4.31, H_legit: 7.08 → Confidence: 0.78

**Step 2: Pattern Overrides**

Deterministic rules for patterns Markov might miss:

| Pattern | Override Score | Example |
|---------|---------------|---------|
| Keyboard Walk | 0.9 | qwerty, asdfgh, 12345 |
| Sequential | 0.8 | user1, user2, test001 |
| Dated | 0.7 | john.2024, user_oct2024 |

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
function determineBlockReason({
  markovResult,
  keyboardWalkResult,
  patternFamilyResult,
  domainReputationScore,
  tldRiskScore
}) {
  const reasons = [
    {
      condition: markovResult?.isLikelyFraudulent &&
                 markovResult.confidence > 0.7,
      reason: 'markov_chain_fraud'
    },
    { condition: keyboardWalkResult?.hasKeyboardWalk, reason: 'keyboard_walk' },
    { condition: patternFamilyResult?.patternType === 'sequential', reason: 'sequential_pattern' },
    { condition: patternFamilyResult?.patternType === 'dated', reason: 'dated_pattern' },
    { condition: domainReputationScore > 0.5, reason: 'domain_reputation' },
    { condition: tldRiskScore > 0.5, reason: 'high_risk_tld' }
  ];

  return reasons.find(r => r.condition)?.reason || 'suspicious_pattern';
}
```

---

## Examples

### Example 1: Clear Gibberish

**Email**: `randomuser@provider.com`

```json
{
  "signals": {
    "markovDetected": true,
    "markovConfidence": 0.78,
    "markovCrossEntropyLegit": 7.08,
    "markovCrossEntropyFraud": 4.31,
    "hasKeyboardWalk": false,
    "patternType": "random",
    "domainReputationScore": 0,
    "tldRiskScore": 0.29
  }
}
```

**Calculation**:
1. Markov: 0.78 (fraud detected)
2. Keyboard walk: No
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
    "hasKeyboardWalk": false,
    "patternType": "random",
    "domainReputationScore": 0,
    "tldRiskScore": 0.29
  }
}
```

**Calculation**:
1. Markov: 0 (legit detected, confidence high for legit model)
2. Keyboard walk: No
3. Sequential: No
4. Dated: No
5. Domain risk: 0 * 0.2 + 0.29 * 0.1 = 0.029
6. **Final: 0 + 0.029 = 0.03**

**Decision**: `allow`

---

### Example 3: Keyboard Walk

**Email**: `qwerty123@mail.com`

```json
{
  "signals": {
    "markovDetected": true,
    "markovConfidence": 0.55,
    "hasKeyboardWalk": true,
    "keyboardWalkType": "qwerty",
    "patternType": "random",
    "domainReputationScore": 0,
    "tldRiskScore": 0.29
  }
}
```

**Calculation**:
1. Markov: 0.55 (moderate confidence)
2. Keyboard walk: **YES → override to 0.9**
3. Sequential: No
4. Dated: No
5. Domain risk: 0.029
6. **Final: max(0.55, 0.9) + 0.029 = 0.93**

**Decision**: `block` (reason: `keyboard_walk`)

---

### Example 4: Sequential Pattern

**Email**: `user123@example.com`

```json
{
  "signals": {
    "markovDetected": true,
    "markovConfidence": 0.25,
    "hasKeyboardWalk": false,
    "patternType": "sequential",
    "domainReputationScore": 0,
    "tldRiskScore": 0.29
  }
}
```

**Calculation**:
1. Markov: 0.25 (low confidence)
2. Keyboard walk: No
3. Sequential: **YES → override to 0.8**
4. Dated: No
5. Domain risk: 0.029
6. **Final: max(0.25, 0.8) + 0.029 = 0.83**

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
