# Online Learning Architecture Plan

**Version**: 1.0
**Date**: 2025-11-01
**Status**: Planning Phase

---

## Executive Summary

This document outlines the architecture for implementing **online self-evolving Markov Chain models** in the Cloudflare Workers fraud detection system. The design leverages the existing Analytics Engine data pipeline to enable continuous model improvement without manual intervention.

### Key Insight

**Data is already flowing through Analytics Engine** - we just need to:
1. Query it periodically
2. Train models with high-confidence samples
3. Update models in KV
4. Edge workers automatically pick up new models

---

## Current Architecture (Offline Learning)

```
┌─────────────────┐
│  Edge Workers   │  ← Validate emails (fast, read-only)
│  (200+ global)  │  ← Read models from KV (static, pre-trained)
└────────┬────────┘
         │ Write validation results
         ▼
┌─────────────────┐
│ Analytics Engine│  ← Accumulates data (23 fields per validation)
│  (Time-series)  │  ← 6-month retention
└─────────────────┘

⚠️  PROBLEM: Models never learn from production data
⚠️  PROBLEM: Detection accuracy frozen at training time
```

---

## Proposed Architecture (Online Learning)

```
┌─────────────────┐
│  Edge Workers   │  ← Validate emails (fast, read-only)
│  (200+ global)  │  ← Read models from KV ✨ (auto-updated)
└────────┬────────┘
         │ Write validation results (23 fields)
         ▼
┌─────────────────┐
│ Analytics Engine│  ← Accumulates labeled data
│  (Time-series)  │  ← blob1=decision, blob14=email, double1=risk_score
└────────┬────────┘
         │ Query every 6 hours
         ▼
┌─────────────────┐
│ Cron Worker     │  ← Trains models (scheduled)
│ (Scheduled)     │  ← SELECT high-confidence samples
│                 │  ← Incremental learning (EMA updates)
└────────┬────────┘
         │ Update models (JSON)
         ▼
┌─────────────────┐
│   KV Storage    │  ← Stores trained models (global CDN)
│   (Global)      │  ← Instantly replicated to all edge locations
└─────────────────┘

✅ Models continuously improve from real-world data
✅ No downtime, no manual intervention
✅ Edge workers automatically use latest models
```

---

## Data Flow

### 1. **Validation Phase** (Edge Workers - 50-200ms)

```typescript
POST /validate { "email": "user123@gmail.com" }
  ↓
Load Markov models from KV (cached in worker memory)
  ↓
Detect fraud patterns (8 detectors including Markov)
  ↓
Calculate risk score (Markov = 25% weight)
  ↓
Write to Analytics Engine:
  - blob1: decision ("allow", "warn", "block")
  - blob14: email_local_part ("user123")
  - double1: risk_score (0.0-1.0)
  - blob7: pattern_type ("sequential", "gibberish", etc.)
  ↓
Return validation result
```

### 2. **Training Phase** (Cron Worker - 30-120 seconds)

```typescript
Cron Trigger: Every 6 hours
  ↓
Query Analytics Engine:
  SELECT email_local_part, decision, risk_score
  FROM ANALYTICS
  WHERE timestamp >= NOW() - INTERVAL '7' DAY
    AND (risk_score >= 0.6 OR risk_score <= 0.3)  -- High confidence
  LIMIT 50000
  ↓
Separate into fraud vs legitimate:
  - Fraud: decision = 'block'/'warn' AND risk_score >= 0.6
  - Legit: decision = 'allow' AND risk_score <= 0.3
  ↓
Load existing models from KV
  ↓
Incremental training (exponential moving average):
  new_matrix = 0.1 * new_data + 0.9 * old_matrix
  ↓
Save updated models to KV:
  - markov_legit_model
  - markov_fraud_model
  - markov_training_history (last 10 runs)
  ↓
Next validation requests use new models automatically
```

### 3. **Model Loading** (Edge Workers - cached)

```typescript
// First request in worker instance:
Load models from KV → Cache in global variables

// Subsequent requests (same worker instance):
Use cached models (no KV read)

// After model update in KV:
Workers gradually reload models on cold start (0-30 minutes)
```

---

## Key Components

### 1. **Scheduled Worker** (Cron Trigger)

**File**: `src/training/online-learning.ts`

**Trigger**: Every 6 hours via `wrangler.toml`:
```toml
[triggers]
crons = ["0 */6 * * *"]  # Every 6 hours
```

**Responsibilities**:
- Query Analytics Engine for high-confidence samples
- Separate fraud vs legitimate emails
- Train/update Markov transition matrices
- Save models to KV
- Log training metadata

**Execution Time**: 30-120 seconds (acceptable for scheduled workers)

---

### 2. **Analytics Engine Queries**

**Dataset**: `ANALYTICS` (already configured)

**Query for Training Data**:
```sql
SELECT
  blob14 as email_local_part,    -- "user123", "john.doe"
  blob1 as decision,              -- "allow", "warn", "block"
  double1 as risk_score,          -- 0.0-1.0
  blob7 as pattern_type           -- "sequential", "gibberish"
FROM ANALYTICS
WHERE timestamp >= NOW() - INTERVAL '7' DAY
  AND blob14 IS NOT NULL
  AND blob14 != ''
  AND (
    (double1 >= 0.6 AND blob1 IN ('block', 'warn'))  -- High-confidence fraud
    OR (double1 <= 0.3 AND blob1 = 'allow')          -- High-confidence legitimate
  )
ORDER BY timestamp DESC
LIMIT 50000
```

**Why 7 days?**
- Captures recent fraud trends
- Balances data volume vs. relevance
- ~10,000-50,000 samples (sufficient for retraining)

**Why high-confidence filter?**
- Reduces label noise
- Prevents feedback loops (borderline cases ignored)
- Focuses on clear examples

---

### 3. **Incremental Learning Algorithm**

**Challenge**: Full retraining from scratch is expensive (minutes to hours)

**Solution**: Exponential Moving Average (EMA) updates

```typescript
// Pseudocode
function incrementalUpdate(
  existingMatrix: TransitionMatrix,
  newSamples: string[],
  learningRate: number = 0.1
): TransitionMatrix {

  // Build transition counts from new samples
  const newCounts = countTransitions(newSamples);

  // Merge with existing matrix using EMA
  for (char1, char2, newCount in newCounts) {
    const oldCount = existingMatrix[char1][char2];

    // EMA formula: new = α * new + (1 - α) * old
    const updated = learningRate * newCount + (1 - learningRate) * oldCount;

    existingMatrix[char1][char2] = updated;
  }

  return existingMatrix;
}
```

**Learning Rate (α = 0.1)**:
- 10% weight to new data
- 90% weight to existing model
- Prevents sudden model shifts
- Gradually adapts to trends

**Benefits**:
- Fast: Seconds instead of minutes
- Stable: Gradual adaptation, no sudden changes
- Memory-efficient: No need to store all historical data

---

### 4. **KV Storage Schema**

**Keys**:

1. **`markov_legit_model`** (JSON, ~50-200 KB)
   ```json
   {
     "transitions": {
       "a": { "b": 0.12, "c": 0.08, "d": 0.05, ... },
       "b": { "a": 0.15, "e": 0.10, ... },
       ...
     },
     "updated_at": "2025-11-01T12:00:00Z",
     "sample_count": 25000,
     "version": "1.0"
   }
   ```

2. **`markov_fraud_model`** (JSON, ~50-200 KB)
   - Same structure as legit model

3. **`markov_training_history`** (JSON array, ~10 KB)
   ```json
   [
     {
       "timestamp": "2025-11-01T12:00:00Z",
       "fraud_count": 1200,
       "legit_count": 8500,
       "duration_ms": 45000,
       "detection_rate_improvement": "+2.3%"
     },
     ...  // Last 10 runs
   ]
   ```

4. **`markov_training_config`** (JSON, ~1 KB)
   ```json
   {
     "learning_rate": 0.1,
     "min_samples": 100,
     "confidence_threshold_fraud": 0.6,
     "confidence_threshold_legit": 0.3,
     "enabled": true
   }
   ```

**Total KV Storage**: ~300 KB (negligible)

---

## Security & Safety

### 1. **Label Poisoning Protection**

**Risk**: Attackers could submit fraudulent emails marked as legitimate to poison the model.

**Mitigation**:
```typescript
// Only use HIGH-CONFIDENCE samples
const FRAUD_CONFIDENCE_MIN = 0.6;  // 60% risk score
const LEGIT_CONFIDENCE_MAX = 0.3;  // 30% risk score

// Borderline cases (0.3-0.6) are IGNORED for training
// This creates a "safety buffer" against mislabeling
```

**Additional Protection**:
- Limit training data to last 7 days (reduces long-term poisoning)
- Monitor training metadata for anomalies
- Admin endpoint to rollback models

### 2. **Model Drift Monitoring**

**Metrics to Track** (in `markov_training_history`):
- Fraud sample count (should be stable)
- Legit sample count (should be stable)
- Training duration (should be consistent)
- Detection rate changes (should improve gradually)

**Alerts**:
- If fraud samples suddenly increase 10x → Investigate
- If detection rate drops >5% → Rollback model
- If training fails 3 times → Disable auto-training

### 3. **Rollback Mechanism**

```typescript
// Admin endpoint: POST /admin/markov/rollback
app.post('/admin/markov/rollback', async (c) => {
  // Load previous model from history
  const history = await c.env.CONFIG.get('markov_training_history', 'json');
  const previousRun = history[1];  // Second-to-last run

  // Restore models from backup
  await restoreModelsFromTimestamp(c.env, previousRun.timestamp);

  return c.json({ success: true, rolled_back_to: previousRun.timestamp });
});
```

### 4. **Rate Limiting Training**

**Problem**: Cron could accidentally trigger multiple times

**Solution**:
```typescript
async function retrainMarkovModels(env: Env) {
  // Check if training is already running
  const lock = await env.CONFIG.get('markov_training_lock');
  if (lock) {
    console.log('Training already in progress, skipping...');
    return;
  }

  // Acquire lock
  await env.CONFIG.put('markov_training_lock', 'true', { expirationTtl: 600 });

  try {
    // ... training logic ...
  } finally {
    // Release lock
    await env.CONFIG.delete('markov_training_lock');
  }
}
```

---

## Performance Considerations

### 1. **Edge Worker Impact**

**Validation Latency** (per request):
- KV read (cached): 0ms (after first load)
- Markov detection: 0.07ms (unchanged)
- Total: No impact on latency

**Memory Usage**:
- Models cached in worker memory: ~500 KB
- No memory increase (models already loaded today)

**Cold Start**:
- First request after model update: +50-100ms (KV read)
- All subsequent requests: No overhead

### 2. **Cron Worker Performance**

**Query Analytics Engine**: 5-15 seconds
- Scans 7 days of data (~100K-1M rows)
- Returns 10K-50K samples

**Training**: 15-45 seconds
- Incremental update (EMA)
- Two models (fraud + legit)

**Save to KV**: 1-2 seconds
- Two model JSON files (~100 KB each)

**Total**: 30-120 seconds (acceptable for scheduled workers)

### 3. **KV Costs**

**Reads** (per validation):
- First request in worker: 1 read (cached thereafter)
- ~1,000 workers globally
- After model update: 1,000 reads over 30 minutes

**Cost**: $0.50 per million reads = **$0.0005 per model update**

**Writes** (per training run):
- 3 writes (legit model, fraud model, history)
- Every 6 hours = 4 runs/day

**Cost**: $5 per million writes = **$0.00006 per day**

**Total KV Cost**: **~$0.02 per month** (negligible)

---

## Rollout Plan

### **Phase 1: Foundation** (Week 1)

**Goal**: Set up training infrastructure without auto-updating models

**Tasks**:
1. ✅ Create `src/training/online-learning.ts`
2. Add cron trigger to `wrangler.toml`
3. Add `scheduled` handler to `src/index.ts`
4. Test Analytics Engine queries locally

**Success Criteria**:
- Cron worker runs every 6 hours
- Successfully queries Analytics Engine
- Trains models (but doesn't update KV yet)
- Logs training metadata

**Deployment**: Deploy to staging, monitor for 1 week

---

### **Phase 2: Manual Training** (Week 2)

**Goal**: Enable manual training via admin API

**Tasks**:
1. Add admin endpoint: `POST /admin/markov/train`
2. Test incremental learning with production data
3. Compare old vs new model accuracy
4. Implement rollback mechanism

**Success Criteria**:
- Admin can manually trigger training
- Models improve detection rate by 2-5%
- Rollback works correctly
- No performance degradation

**Deployment**: Deploy to production, test with manual triggers

---

### **Phase 3: Auto-Learning** (Week 3)

**Goal**: Enable fully automatic online learning

**Tasks**:
1. Update cron worker to auto-update KV
2. Add monitoring dashboard
3. Set up alerts for anomalies
4. Enable auto-training in config

**Success Criteria**:
- Models update every 6 hours automatically
- Detection rate improves 5-10% over 2 weeks
- No false positive increase
- Training completes in <2 minutes

**Deployment**: Enable gradually (10% → 50% → 100% of traffic)

---

### **Phase 4: Optimization** (Week 4+)

**Goal**: Fine-tune learning parameters

**Tasks**:
1. Adjust learning rate (0.1 → 0.05 or 0.15)
2. Experiment with training frequency (6h → 12h or 3h)
3. Add A/B testing (old model vs new model)
4. Implement model versioning

**Success Criteria**:
- Detection rate reaches 95%+
- False positive rate <1%
- Training cost <$0.10/month
- Models stable (no drift)

---

## Monitoring & Metrics

### **Dashboard** (Analytics Engine + Grafana)

**Graphs to Track**:

1. **Detection Rate Over Time**
   ```sql
   SELECT
     toStartOfHour(timestamp) as hour,
     SUM(_sample_interval * IF(blob1 IN ('block', 'warn'), 1, 0)) / SUM(_sample_interval) as detection_rate
   FROM ANALYTICS
   WHERE timestamp >= NOW() - INTERVAL '7' DAY
   GROUP BY hour
   ORDER BY hour
   ```

2. **Model Update Impact**
   ```sql
   SELECT
     toStartOfDay(timestamp) as day,
     SUM(_sample_interval * IF(blob1 = 'block' AND double8 > 0.7, 1, 0)) as high_confidence_blocks
   FROM ANALYTICS
   WHERE timestamp >= NOW() - INTERVAL '30' DAY
   GROUP BY day
   ORDER BY day
   ```

3. **Training Job Success Rate**
   - From `markov_training_history` in KV
   - Alert if 2+ consecutive failures

4. **Fraud Pattern Distribution**
   ```sql
   SELECT
     blob7 as pattern_type,
     SUM(_sample_interval) as count
   FROM ANALYTICS
   WHERE timestamp >= NOW() - INTERVAL '1' DAY
     AND blob1 IN ('block', 'warn')
   GROUP BY pattern_type
   ORDER BY count DESC
   ```

### **Alerts**

1. **Training Failure**: Training job fails 2+ times in a row
2. **Detection Rate Drop**: Rate drops >5% after model update
3. **Label Anomaly**: Fraud samples suddenly increase 10x
4. **Model Drift**: Cross-entropy scores change >20%

---

## Configuration

### **wrangler.toml**

```toml
[triggers]
crons = ["0 */6 * * *"]  # Every 6 hours at :00

[[env.production.triggers]]
crons = ["0 2,8,14,20 * * *"]  # 2am, 8am, 2pm, 8pm UTC
```

### **src/config.ts** (add to DEFAULT_CONFIG)

```typescript
markovChain: {
  enabled: true,
  autoTraining: true,          // Enable auto-learning
  learningRate: 0.1,            // EMA weight for new data
  minSamples: 100,              // Minimum samples needed for training
  confidenceThresholdFraud: 0.6,  // Only use samples with risk >= 0.6
  confidenceThresholdLegit: 0.3,  // Only use samples with risk <= 0.3
  trainingLookbackDays: 7,      // Query last 7 days from Analytics
  maxTrainingSamples: 50000,    // Limit query size
}
```

### **Admin Endpoints**

```
POST /admin/markov/train         - Manually trigger training
GET  /admin/markov/status        - Show training history & next run
POST /admin/markov/rollback      - Rollback to previous model
GET  /admin/markov/compare       - Compare old vs new model accuracy
PUT  /admin/markov/config        - Update training config
```

---

## Alternatives Considered

### **Alternative 1: Real-time Learning**

**Idea**: Update models after every validation

**Pros**:
- Immediate adaptation to new patterns
- No scheduled jobs needed

**Cons**:
- ❌ Too expensive (KV write on every request)
- ❌ High latency (50-100ms per request)
- ❌ Synchronization issues (200+ workers updating simultaneously)

**Decision**: Rejected - periodic batch training is more efficient

---

### **Alternative 2: Separate Training Service**

**Idea**: Use Durable Objects or external service for training

**Pros**:
- More control over training environment
- Can use ML libraries (Python, TensorFlow)

**Cons**:
- ❌ More complex architecture
- ❌ Additional cost (Durable Objects or external VM)
- ❌ Network latency between services

**Decision**: Rejected - Cron Workers are simpler and sufficient

---

### **Alternative 3: Client-Side Labeling**

**Idea**: Let API consumers provide feedback on decisions

**Pros**:
- Direct feedback from users
- Can correct false positives/negatives

**Cons**:
- ❌ Vulnerable to poisoning attacks
- ❌ Most users won't provide feedback
- ❌ Requires new API endpoints

**Decision**: Deferred to Phase 4 (optional enhancement)

---

## Cost Analysis

### **Current Costs** (Offline Learning)

- KV reads: 1 per worker cold start (~1,000/day) = $0.0005/day
- Analytics Engine: $5/month (included in Pro plan)
- **Total**: **~$5.01/month**

### **With Online Learning**

- KV reads: Same as above (cached after first load)
- KV writes: 12 per day (4 cron runs × 3 writes) = $0.00006/day
- Analytics Engine queries: 4 per day (~50K rows each) = $0 (included)
- Cron Worker CPU: 4 × 60 seconds = $0.0001/day
- **Total**: **~$5.02/month** (+$0.01/month)

**ROI**:
- Cost increase: +0.2%
- Expected detection improvement: +5-10%
- **Break-even**: Immediate (prevents 1+ fraudulent signup per month)

---

## Success Metrics

### **Phase 1-2** (Manual Training)

- ✅ Training job completes in <2 minutes
- ✅ Models improve detection rate by 2-5%
- ✅ No increase in false positives
- ✅ Rollback mechanism works

### **Phase 3** (Auto-Learning)

- ✅ Detection rate reaches 95%+ (from current ~85%)
- ✅ False positive rate <1%
- ✅ Training cost <$0.10/month
- ✅ Models update every 6 hours without issues

### **Phase 4** (Optimization)

- ✅ Detection rate plateaus at 97-98%
- ✅ Models stable for 30+ days
- ✅ Zero manual interventions needed
- ✅ A/B testing shows new models consistently outperform old

---

## Risks & Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **Label poisoning** | High | Medium | High-confidence filtering (0.3-0.6 buffer) |
| **Model drift** | Medium | Low | Monitoring dashboard + alerts |
| **Training job failure** | Low | Medium | Retry logic + fallback to existing models |
| **KV propagation delay** | Low | Low | Accept 0-30 min delay (gradual rollout) |
| **False positive spike** | High | Low | Rollback mechanism + manual approval gate |
| **Cost overrun** | Low | Very Low | KV costs capped at $0.10/month |

---

## Open Questions

1. **Learning Rate**: Should we start at 0.1 or be more conservative (0.05)?
   - **Recommendation**: Start at 0.05 (safer), increase to 0.1 after 1 week

2. **Training Frequency**: Every 6 hours or every 12 hours?
   - **Recommendation**: Every 6 hours (more responsive to new patterns)

3. **Confidence Thresholds**: Are 0.6 (fraud) and 0.3 (legit) appropriate?
   - **Recommendation**: Test with 0.7/0.2 first (stricter), relax if needed

4. **Model Versioning**: Should we keep multiple model versions?
   - **Recommendation**: Phase 4 feature (keep last 3 versions in KV)

---

## Next Steps

**If you approve this plan**, we'll proceed with:

1. ✅ **Phase 1 Implementation** (this session):
   - Create `src/training/online-learning.ts`
   - Add `scheduled` handler to `src/index.ts`
   - Update `wrangler.toml` with cron trigger
   - Add admin endpoints for manual training

2. **Testing** (next session):
   - Test training with production data
   - Verify model updates propagate correctly
   - Measure detection rate improvement

3. **Deployment** (next week):
   - Deploy to staging for 3 days
   - Monitor training jobs
   - Enable auto-training gradually

---

## Conclusion

Online learning in Cloudflare Workers is **not only feasible but ideal** for this use case:

✅ **Data already in Analytics Engine** - no new data pipeline needed
✅ **Cron Workers handle heavy computation** - no impact on validation latency
✅ **KV provides instant global propagation** - all edge workers get new models
✅ **Incremental learning is efficient** - updates take seconds, not minutes
✅ **Cost is negligible** - adds $0.01/month

The architecture leverages Cloudflare's strengths (global edge, KV propagation, scheduled workers) while avoiding its limitations (CPU time, statelessness).

**Recommendation**: Proceed with Phase 1 implementation.

---

**Questions? Concerns? Ready to implement?**
