# Analytics Engine Data Audit

**Date**: 2025-11-02 07:04 UTC
**Account**: 25f21f141824546aa72c74451a11b419 (Miau)
**Dataset**: ANALYTICS

---

## Summary

**Total Validations**: 861
**Date Range**: 2025-11-01 08:47:47 to 2025-11-02 06:34:10 (~ 22 hours)
**Average Rate**: ~39 validations/hour

---

## Data Breakdown

| Decision | Count | Percentage | Avg Risk Score |
|----------|-------|------------|----------------|
| **warn** | 716 | 83.2% | 0.479 (47.9%) |
| **block** | 132 | 15.3% | 0.882 (88.2%) |
| **allow** | 13 | 1.5% | 0.240 (24.0%) |

---

## Training Data Assessment

### Current Status
- **Available samples**: 861 total validations
- **Required for training**: 1000+ labeled samples
- **Gap**: 139 more samples needed (minimum threshold)
- **ETA at current rate**: ~3-4 hours to reach 1000

### Critical Issue: NO GROUND TRUTH LABELS ⚠️

**Problem**: The analytics data contains model predictions (`warn`, `block`, `allow`), not human-verified labels.

**What we have**:
- `blob1 = decision` → Model's automated decision (warn/block/allow)
- `double1 = riskScore` → Model's calculated risk (0.0-1.0)
- Based on **heuristic rules**, not human verification

**What we need for supervised learning**:
- Ground truth labels: `is_fraudulent: true/false`
- Human-verified or rules-based classification
- Separate from model predictions

### Why This Matters

The current training code (src/training/online-learning.ts:243) expects:
```typescript
interface TrainingData {
    email: string;
    is_fraudulent: boolean;  // ← Ground truth label
    timestamp: string;
}
```

But Analytics Engine stores:
```typescript
{
    blob14: emailLocalPart,  // ✅ We have this
    blob1: decision,         // ⚠️ This is MODEL OUTPUT, not ground truth
    double1: riskScore       // ⚠️ This is MODEL OUTPUT, not ground truth
}
```

---

## Data Schema (Analytics Engine)

### Categorical Fields (blobs)
| Field | Description | Example Values |
|-------|-------------|----------------|
| `blob1` | Decision | allow, warn, block |
| `blob2` | Block reason | none, entropy, sequential |
| `blob3` | Country | US, UK, unknown |
| `blob4` | Risk bucket | very_low, low, medium, high, very_high |
| `blob5` | Domain | gmail.com, yahoo.com |
| `blob6` | TLD | com, org, tk |
| `blob7` | Pattern type | sequential, dated, none |
| `blob8` | Pattern family | numeric, alpha, mixed |
| `blob9` | Is disposable | disposable, normal |
| `blob10` | Is free provider | free, normal |
| `blob11` | Has plus-addressing | yes, no |
| `blob12` | Has keyboard walk | yes, no |
| `blob13` | Is gibberish | yes, no |
| `blob14` | Email local part | user123, john.doe |
| `blob15` | Client IP | IP address or "unknown" |
| `blob16` | User agent | Browser/bot signature |
| `blob17` | Model version | production, A, B |
| `blob18` | Training exclusion | include, exclude |
| `blob19` | Markov detected | yes, no |

### Numeric Fields (doubles)
| Field | Description | Typical Range |
|-------|-------------|---------------|
| `double1` | Risk score | 0.0 - 1.0 |
| `double2` | Entropy score | 0.0 - 5.0 |
| `double3` | Bot score | 0 - 100 |
| `double4` | ASN | 0 - 65535 |
| `double5` | Latency (ms) | 0.01 - 100 |
| `double6` | TLD risk score | 0.0 - 1.0 |
| `double7` | Domain reputation | 0.0 - 1.0 |
| `double8` | Pattern confidence | 0.0 - 1.0 |
| `double9` | Markov confidence | 0.0 - 1.0 |
| `double10` | Markov cross-entropy (legit) | 0.0 - 20.0 |
| `double11` | Markov cross-entropy (fraud) | 0.0 - 20.0 |
| `double12` | IP reputation score | 0 - 100 |

### Index Fields
| Field | Description |
|-------|-------------|
| `index1` | Fingerprint hash (first 32 chars) |

---

## Options for Training Data

### Option 1: Use Heuristic Labels (Quick, Lower Quality)

**Approach**: Convert decisions to labels based on thresholds

```sql
SELECT
    blob14 as email_local_part,
    CASE
        WHEN blob1 = 'block' THEN true
        WHEN blob1 = 'allow' THEN false
        WHEN blob1 = 'warn' AND double1 >= 0.6 THEN true
        WHEN blob1 = 'warn' AND double1 < 0.4 THEN false
        ELSE NULL  -- Uncertain, exclude
    END as is_fraudulent
FROM ANALYTICS
WHERE blob14 != 'unknown'
    AND blob18 = 'include'  -- Not flagged for exclusion
```

**Result**:
- 132 block → fraudulent (100%)
- 13 allow → legitimate (100%)
- 716 warn → 60% split based on risk score
  - ~430 fraudulent (warn + risk >= 0.6)
  - ~286 legitimate (warn + risk < 0.4)

**Estimated**:
- **~562 fraudulent samples**
- **~299 legitimate samples**
- **Total: ~861 samples** (all usable)

**Pros**:
- ✅ Can start training immediately
- ✅ Uses all available data
- ✅ No human labeling required

**Cons**:
- ⚠️ Labels based on model predictions (circular logic risk)
- ⚠️ "Warn" zone is ambiguous
- ⚠️ May reinforce existing biases

---

### Option 2: Conservative Labels (Higher Quality, Less Data)

**Approach**: Only use high-confidence samples

```sql
SELECT
    blob14 as email_local_part,
    CASE
        WHEN blob1 = 'block' AND double1 >= 0.8 THEN true
        WHEN blob1 = 'allow' AND double1 <= 0.3 THEN false
        ELSE NULL  -- Exclude ambiguous
    END as is_fraudulent
FROM ANALYTICS
WHERE blob14 != 'unknown'
    AND blob18 = 'include'
```

**Result**:
- 132 block (avg 88.2% risk) → ~132 fraudulent
- 13 allow (avg 24% risk) → ~13 legitimate

**Estimated**:
- **~132 fraudulent samples**
- **~13 legitimate samples**
- **Total: ~145 samples** (high confidence only)

**Pros**:
- ✅ Higher quality labels
- ✅ Less circular logic
- ✅ Clear separation

**Cons**:
- ❌ Only ~145 samples (far below 1000 target)
- ❌ Severely imbalanced (91% fraud, 9% legit)
- ❌ Not enough data for meaningful training

---

### Option 3: Wait for Human-Labeled Data (Best Quality, Slow)

**Approach**: Implement labeling interface

1. Build admin dashboard showing `warn` emails
2. Human reviewer marks each as fraud/legit
3. Store labels in separate KV namespace
4. Use labels for training

**Pros**:
- ✅ Ground truth labels
- ✅ No circular logic
- ✅ Can correct model mistakes

**Cons**:
- ❌ Requires human time
- ❌ Slow (weeks to label 1000+)
- ❌ Not scalable

---

### Option 4: Hybrid Approach (Recommended)

**Approach**: Mix high-confidence auto-labels + human verification

**Phase 1**: Auto-label clear cases
```sql
-- Clear fraud (block + high risk)
WHERE blob1 = 'block' AND double1 >= 0.8  -- ~132 samples

-- Clear legitimate (allow + low risk)
WHERE blob1 = 'allow' AND double1 <= 0.3  -- ~13 samples
```

**Phase 2**: Human review ambiguous cases
```sql
-- Ambiguous (warn zone)
WHERE blob1 = 'warn'
    AND double1 BETWEEN 0.4 AND 0.6  -- ~300 samples
ORDER BY RANDOM()
LIMIT 100  -- Review 100 manually
```

**Result**:
- **~132 fraudulent** (auto)
- **~13 legitimate** (auto)
- **~100 mixed** (human-labeled)
- **Total: ~245 high-quality samples**

Still below 1000, but higher quality.

---

## Recommendation

**Short Term** (Next 48 hours):
1. **Wait** for 1000+ total validations (~3-4 more hours at current rate)
2. Use **Option 1 (Heuristic Labels)** to create initial training dataset
3. **Acknowledge limitations** in training metadata (label_source: "heuristic_v1")
4. Train first Markov model as **proof of concept**

**Medium Term** (Next 2 weeks):
1. Monitor model performance on new data
2. Implement **Option 4 (Hybrid)** for higher-quality retraining
3. Build simple admin interface for labeling ambiguous cases
4. Retrain with improved labels

**Long Term** (Month 2+):
1. Implement feedback loop (users report false positives/negatives)
2. Use production feedback as ground truth
3. Continuous retraining with human-verified labels

---

## SQL Queries for Training Data Extraction

### Query 1: Extract Training Data (Heuristic Labels)

```sql
SELECT
    blob14 as email_local_part,
    CASE
        WHEN blob1 = 'block' THEN 1
        WHEN blob1 = 'allow' THEN 0
        WHEN blob1 = 'warn' AND double1 >= 0.6 THEN 1
        WHEN blob1 = 'warn' AND double1 < 0.4 THEN 0
        ELSE NULL
    END as is_fraudulent,
    double1 as risk_score,
    blob1 as decision,
    timestamp
FROM ANALYTICS
WHERE blob14 != 'unknown'
    AND blob18 = 'include'
    AND timestamp >= NOW() - INTERVAL '7' DAY
    AND CASE
        WHEN blob1 = 'block' THEN 1
        WHEN blob1 = 'allow' THEN 0
        WHEN blob1 = 'warn' AND double1 >= 0.6 THEN 1
        WHEN blob1 = 'warn' AND double1 < 0.4 THEN 0
        ELSE NULL
    END IS NOT NULL
ORDER BY timestamp DESC
```

### Query 2: Check Label Distribution

```sql
SELECT
    CASE
        WHEN blob1 = 'block' THEN 'fraud_high_conf'
        WHEN blob1 = 'allow' THEN 'legit_high_conf'
        WHEN blob1 = 'warn' AND double1 >= 0.6 THEN 'fraud_medium_conf'
        WHEN blob1 = 'warn' AND double1 < 0.4 THEN 'legit_medium_conf'
        ELSE 'uncertain'
    END as label_type,
    COUNT() as count,
    AVG(double1) as avg_risk
FROM ANALYTICS
WHERE blob14 != 'unknown'
GROUP BY label_type
ORDER BY count DESC
```

---

## Action Items

1. **Wait ~3-4 hours** for 1000+ validations
2. **Update training code** to use heuristic labeling from Analytics Engine
3. **Add metadata** to models indicating label source
4. **Train first model** as proof of concept
5. **Monitor accuracy** on new unlabeled data
6. **Plan** human labeling interface for Phase 2

---

**Next Review**: After reaching 1000 validations (ETA: ~2025-11-02 10:00 UTC)
