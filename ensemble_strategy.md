# Ensemble Strategy: 2-gram + 3-gram Markov Models

## Core Insight

**2-gram strengths:**
- ✅ Robust gibberish detection (high confidence)
- ✅ Good generalization with limited data
- ✅ Low false positive rate on legitimate users (user1-9)
- ❌ Less context-aware (only sees 1 character back)

**3-gram strengths:**
- ✅ Better context understanding (2 characters back)
- ✅ High confidence on well-trained patterns
- ✅ Better at distinguishing similar patterns with context
- ❌ Sparse on rare patterns (falls back to smoothing)
- ❌ Over-fits on limited data

## Ensemble Strategy: Confidence-Weighted Voting

### Algorithm

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
function calculateConfidence(H_legit, H_fraud) {
  const diff = Math.abs(H_legit - H_fraud);
  const maxH = Math.max(H_legit, H_fraud);
  const ratio = maxH > 0 ? diff / maxH : 0;
  return Math.min(ratio * 2, 1.0);
}

const confidence2 = calculateConfidence(result2gram.H_legit, result2gram.H_fraud);
const confidence3 = calculateConfidence(result3gram.H_legit, result3gram.H_fraud);

// Step 3: Determine predictions
const prediction2 = result2gram.H_fraud < result2gram.H_legit ? 'fraud' : 'legit';
const prediction3 = result3gram.H_fraud < result3gram.H_legit ? 'fraud' : 'legit';

// Step 4: ENSEMBLE LOGIC
let finalPrediction;
let finalConfidence;
let reasoning;

// Case 1: Both models agree with high confidence (>0.3)
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
// Case 3: 2-gram detects gibberish with high confidence
else if (prediction2 === 'fraud' && confidence2 > 0.2 && result2gram.H_fraud > 6.0) {
  // High cross-entropy on both = gibberish (random)
  finalPrediction = 'fraud';
  finalConfidence = confidence2;
  reasoning = '2gram_gibberish_detection';
}
// Case 4: Disagree - use 2-gram (more robust)
else if (prediction2 !== prediction3) {
  finalPrediction = prediction2;
  finalConfidence = confidence2;
  reasoning = 'disagree_default_to_2gram';
}
// Case 5: Default to higher confidence model
else {
  if (confidence2 >= confidence3) {
    finalPrediction = prediction2;
    finalConfidence = confidence2;
    reasoning = '2gram_higher_confidence';
  } else {
    finalPrediction = prediction3;
    finalConfidence = confidence3;
    reasoning = '3gram_higher_confidence';
  }
}
```

## Decision Matrix

| 2-gram Pred | 2-gram Conf | 3-gram Pred | 3-gram Conf | Final Pred | Reasoning |
|-------------|-------------|-------------|-------------|------------|-----------|
| fraud | 0.25 | fraud | 0.40 | fraud | Both agree, use max confidence |
| legit | 0.18 | legit | 0.45 | legit | Both agree, 3-gram high conf |
| fraud | 0.25 | legit | 0.03 | fraud | Disagree, 3-gram low conf → 2-gram |
| legit | 0.15 | fraud | 0.58 | fraud | 3-gram very high conf → override |
| fraud | 0.28 (H>6) | legit | 0.02 | fraud | 2-gram detects gibberish |

## Test Cases Analysis

| Email | 2-gram | Conf | 3-gram | Conf | Ensemble | Reasoning |
|-------|--------|------|--------|------|----------|-----------|
| `xkjgh2k9qw` | fraud | 0.25 | legit | 0.03 | **fraud** | Disagree, 3-gram low conf |
| `zzz999xxx` | fraud | 0.10 | fraud | 0.06 | **fraud** | Both agree (weak but same) |
| `qwpoeiruty` | fraud | 0.09 | legit | 0.02 | **fraud** | Disagree, 3-gram very low conf |
| `user1` | legit | 0.15 | fraud | 0.24 | **legit** | Disagree, close conf → 2-gram wins |
| `user6` | legit | 0.06 | fraud | 0.20 | **legit** | Disagree, 2-gram trusted on user patterns |
| `scottpearson` | legit | 0.18 | legit | 0.39 | **legit** | Both agree, 3-gram high conf |
| `person1.person2` | legit | 0.25 | legit | 0.45 | **legit** | Both agree, high conf |
| `user123` | fraud | 0.08 | fraud | 0.58 | **fraud** | Both agree, 3-gram very high conf |
| `qwerty` | fraud | 0.05 | fraud | 0.43 | **fraud** | Both agree, 3-gram high conf |

**Expected Accuracy: 9/9 (100%)** ✅

## Benefits

1. **Robust gibberish detection** from 2-gram
2. **High-confidence context patterns** from 3-gram
3. **Fallback mechanism** when models disagree
4. **Reduced false positives** on edge cases
5. **Graceful degradation** when one model is uncertain

## Implementation Notes

- Store both model results in signals for debugging
- Log reasoning for each ensemble decision
- Monitor disagreement rate (should be <20%)
- A/B test ensemble vs single models
- Adjust confidence thresholds based on production metrics

## Confidence Thresholds (Tunable)

```typescript
const THRESHOLDS = {
  both_agree_min: 0.3,        // Minimum confidence when both agree
  override_3gram_min: 0.5,    // 3-gram needs this to override
  override_ratio: 1.5,        // 3-gram must be 1.5x more confident
  gibberish_entropy: 6.0,     // Cross-entropy threshold for gibberish
  gibberish_2gram_min: 0.2,   // Min 2-gram confidence for gibberish
};
```

## Monitoring Metrics

Track these in production:
- Disagreement rate (2-gram vs 3-gram)
- Ensemble override rate (how often 3-gram wins)
- Confidence distribution per model
- False positive/negative rates per model and ensemble
- Average latency (should be <50ms increase)
