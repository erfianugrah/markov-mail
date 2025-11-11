# Out-of-Distribution (OOD) Detection

**Version**: 2.4.0
**Status**: Production

## What is OOD Detection?

Out-of-Distribution (OOD) detection identifies patterns that don't match anything the models were trained on. When BOTH the legitimate and fraudulent Markov models have high cross-entropy (above 3.0 nats), it means the pattern is unfamiliar to both - this is a red flag.

## The Problem

Before v2.4.0:
```
Email: oarnimstiaremtn@gmail.com
H_legit = 4.51 nats
H_fraud = 4.32 nats
Confidence = 0.08 (low difference)
Decision = ALLOW  ← WRONG
```

Both models were confused (high entropy on both sides), but the small difference in entropies resulted in low confidence, so the system allowed it. This was incorrect - when both models are confused, that's abnormal regardless of which is "less confused."

## Two-Dimensional Risk Model

### Dimension 1: Classification Risk

This is the differential signal - which model fits better?

```typescript
const differenceRatio = (H_legit - H_fraud) / H_legit;
const confidence = Math.abs(differenceRatio);
const classificationRisk = isLikelyFraudulent ? confidence : 0;
```

If the fraud model fits significantly better → fraud classification.
If they're similar → low classification risk.

### Dimension 2: Abnormality Risk

This is the consensus signal - are BOTH models confused?

```typescript
const minEntropy = Math.min(H_legit, H_fraud);
const abnormalityScore = Math.max(0, minEntropy - 3.0);
const abnormalityRisk = Math.min(abnormalityScore * 0.15, 0.6);
```

If both entropies are high → high abnormality risk.

### Final Risk Calculation

```typescript
finalRisk = Math.max(classificationRisk, abnormalityRisk) + domainRisk;
```

We take the WORST case between classification and abnormality, then add domain risk signals.

## Threshold: 3.0 Nats

**Why 3.0?**

Cross-entropy thresholds from information theory:
- **0.69 nats**: log₂ baseline (random guessing)
- **< 0.2 nats**: good predictions
- **> 1.0 nats**: poor predictions
- **> 3.0 nats**: severely confused (out of distribution)

The 3.0 threshold means the model needs ~8× more bits to encode the pattern than it expects (2^3 = 8). This indicates the pattern structure is fundamentally different from training data.

## Risk Scaling

```typescript
abnormalityRisk = min((minEntropy - 3.0) × 0.15, 0.6)
```

Scaling factor: **0.15** risk per nat above threshold
Maximum: **0.6** (block threshold)

### Examples:

| minEntropy | abnormalityScore | abnormalityRisk | Likely Decision |
|-----------|------------------|-----------------|-----------------|
| 2.1 | 0.00 | 0.00 | ALLOW |
| 3.0 | 0.00 | 0.00 | ALLOW |
| 3.5 | 0.50 | 0.07 | ALLOW |
| 4.0 | 1.00 | 0.15 | ALLOW/WARN |
| 4.5 | 1.50 | 0.22 | WARN |
| 5.0 | 2.00 | 0.30 | WARN |
| 6.0 | 3.00 | 0.45 | WARN/BLOCK |
| 7.0+ | 4.00+ | 0.60 | BLOCK |

## Real Examples

### Case 1: Severe OOD (Anagram Shuffle)

```
Email: inearkstioarsitm2mst@gmail.com
H_legit = 4.45 nats
H_fraud = 4.68 nats
```

**Classification Analysis:**
- differenceRatio = (4.45 - 4.68) / 4.45 = -0.05
- confidence = 0.05 (very low)
- classificationRisk = 0 (models agree it's not fraud)

**Abnormality Analysis:**
- minEntropy = 4.45 nats
- abnormalityScore = 4.45 - 3.0 = 1.45
- abnormalityRisk = 1.45 × 0.15 = 0.22

**Final Risk:**
- finalRisk = max(0, 0.22) + 0.08 (domain) = 0.30
- Decision: **WARN** (suspicious_abnormal_pattern)

### Case 2: Moderate OOD

```
Email: inearkstioaermst@gmail.com
H_legit = 3.99 nats
H_fraud = 4.17 nats
```

**Analysis:**
- minEntropy = 3.99 nats
- abnormalityScore = 0.99
- abnormalityRisk = 0.15
- finalRisk = 0.23
- Decision: **ALLOW** (below 0.25 threshold)

### Case 3: Normal Pattern (No OOD)

```
Email: person1@gmail.com
H_legit = 2.1 nats
H_fraud = 3.8 nats
```

**Analysis:**
- minEntropy = 2.1 nats (below 3.0)
- abnormalityScore = 0
- abnormalityRisk = 0
- oodDetected = false
- Decision: **ALLOW**

## Database Schema

Migration `0005_add_ood_detection.sql` added:

```sql
ALTER TABLE validations ADD COLUMN min_entropy REAL;
ALTER TABLE validations ADD COLUMN abnormality_score REAL;
ALTER TABLE validations ADD COLUMN abnormality_risk REAL;
ALTER TABLE validations ADD COLUMN ood_detected INTEGER DEFAULT 0;
```

### Querying OOD Data

**Find all OOD detections:**
```sql
SELECT
  timestamp,
  email_local_part,
  decision,
  risk_score,
  min_entropy,
  abnormality_score,
  abnormality_risk
FROM validations
WHERE ood_detected = 1
ORDER BY min_entropy DESC
LIMIT 100;
```

**OOD detection rate:**
```sql
SELECT
  COUNT(*) FILTER (WHERE ood_detected = 1) * 100.0 / COUNT(*) as ood_rate_percent,
  AVG(CASE WHEN ood_detected = 1 THEN min_entropy END) as avg_ood_entropy
FROM validations
WHERE timestamp >= datetime('now', '-24 hours');
```

**Highest abnormality patterns:**
```sql
SELECT
  email_local_part,
  min_entropy,
  abnormality_risk,
  decision,
  block_reason
FROM validations
WHERE ood_detected = 1
ORDER BY abnormality_risk DESC
LIMIT 20;
```

## API Response Fields

New fields in `/validate` endpoint response (v2.4.0):

```json
{
  "signals": {
    "markovCrossEntropyLegit": 4.45,
    "markovCrossEntropyFraud": 4.68,
    "minEntropy": 4.45,
    "abnormalityScore": 1.45,
    "abnormalityRisk": 0.22,
    "oodDetected": true
  }
}
```

## Block Reasons

New block reasons related to OOD:

- `out_of_distribution`: Abnormality risk alone drives the decision
- `suspicious_abnormal_pattern`: OOD combined with other signals

## Testing

Test suite: `cli/commands/test-live.ts`

OOD-specific test categories:
- `ood-severe`: Very high entropy (> 4.0 nats)
- `ood-moderate`: Above threshold (3.0-4.0 nats)
- `ood-near-threshold`: Just above 3.0 nats
- `ood-cross-language`: Unicode mixing patterns
- `ood-novel-bot`: New bot patterns not in training
- `ood-low-entropy`: Should NOT trigger OOD

Run tests:
```bash
npm run cli test:live -- --endpoint https://fraud.erfi.dev/validate
```

## What Patterns Trigger OOD?

### Typical OOD Patterns:
- **Anagrams**: `oarnimstiaremtn` (familiar letters, unfamiliar order)
- **Novel shuffles**: `rtmaenisoartmstien` (cross-shuffle patterns)
- **Random gibberish**: `ksjdnfpqowiemznxc` (completely novel)
- **Mixed scripts**: `user用户test` (Latin + Chinese)
- **Novel bot patterns**: `usr#20250110#a1b` (new delimiter styles)

### Not OOD (Familiar Patterns):
- **Common names**: `person1`, `user2` (low entropy)
- **Standard patterns**: `test@company.com` (known structure)
- **Birth years**: `person1985` (number patterns in training data)
- **Common sequences**: `user123` (seen during training)

## Performance Impact

- **Latency**: +0ms (calculations done during existing Markov evaluation)
- **Database**: +4 columns (REAL + INTEGER types)
- **Index overhead**: Minimal (2 new indexes on rare condition)

## Monitoring

Key metrics to track:

1. **OOD Detection Rate**
   ```sql
   SELECT
     DATE(timestamp) as date,
     COUNT(*) FILTER (WHERE ood_detected = 1) * 100.0 / COUNT(*) as ood_rate
   FROM validations
   GROUP BY date
   ORDER BY date DESC
   LIMIT 30;
   ```

2. **Average Abnormality by Decision**
   ```sql
   SELECT
     decision,
     AVG(abnormality_risk) as avg_abnormality,
     COUNT(*) FILTER (WHERE ood_detected = 1) as ood_count
   FROM validations
   WHERE timestamp >= datetime('now', '-24 hours')
   GROUP BY decision;
   ```

3. **OOD False Positives** (OOD detected but ALLOW)
   ```sql
   SELECT
     email_local_part,
     min_entropy,
     abnormality_risk,
     risk_score
   FROM validations
   WHERE ood_detected = 1 AND decision = 'allow'
   ORDER BY abnormality_risk DESC
   LIMIT 50;
   ```

## Research Basis

The OOD detection approach is grounded in established information theory:

1. **Cross-Entropy**: Measures how well a probability distribution predicts data
2. **Baseline (log 2)**: 0.69 nats for random guessing
3. **Threshold (3.0)**: 4.3× baseline indicates severe confusion
4. **Linear Scaling**: Simple, interpretable risk contribution

This is not a novel ML technique - it's applying standard statistical thresholds to identify when models encounter patterns outside their training distribution.

## Future Improvements

Potential enhancements:

1. **Adaptive Thresholds**: Adjust 3.0 threshold based on production data distribution
2. **Per-Language Baselines**: Different thresholds for different character sets
3. **Temporal Tracking**: Flag sudden spikes in OOD patterns (attack detection)
4. **Model Expansion**: Retrain on OOD patterns once labeled

## See Also

- [TRAINING.md](./TRAINING.md) - Complete training documentation with OOD section
- [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture with OOD details
- [SCORING.md](./SCORING.md) - Risk scoring with two-dimensional model
- [DETECTORS.md](./DETECTORS.md) - All detection algorithms
