# Online Learning Implementation Roadmap

**Status**: In Progress - Phase 1
**Started**: 2025-11-01
**Target Completion**: 2025-11-30 (4 weeks)

---

## Plan Review Summary

### ✅ **Architecture Validated**

**Strengths**:
- ✅ Separate KV namespace (MARKOV_MODEL) already configured
- ✅ Fingerprint has IP and userAgent fields
- ✅ Analytics Engine has room for new fields (blob15-20, double12-20)
- ✅ Cron triggers supported in wrangler.jsonc
- ✅ A/B testing architecture is sound
- ✅ Security layers are comprehensive

**Potential Issues Identified**:
1. **Blob15 conflict**: Currently used for `markovDetected`, need to remap
2. **Model size**: Need to verify 50-200KB fits in KV value (limit: 25MB ✓)
3. **Cron cold start**: First run may be slow (acceptable for scheduled workers)
4. **Training lock**: Need distributed lock (KV TTL sufficient)

**Adjustments Made**:
- Remap Analytics schema: markovDetected → blob19
- Add blob15-18 for new fields
- Implement distributed lock with KV TTL
- Add validation before every model save

---

## Phase 1: Foundation (Week 1) - IN PROGRESS

**Goal**: Set up infrastructure without auto-deployment

### **Tasks**

#### ✅ 1.1 Update Analytics Schema

**File**: `src/utils/metrics.ts`

**Changes**:
```typescript
// OLD schema (blob15):
blob15: markovDetected

// NEW schema (blob15-19):
blob15: clientIp           // NEW
blob16: userAgent          // NEW
blob17: modelVersion       // NEW (for A/B testing)
blob18: excludeFromTraining // NEW (security)
blob19: markovDetected     // MOVED from blob15

// NEW double fields:
double12: ipReputationScore // NEW (0-100)
```

**Dependencies**: None
**Estimated Time**: 30 minutes
**Testing**: Unit test for writeValidationMetric

---

#### 1.2 Create Training Module

**File**: `src/training/online-learning.ts`

**Functions to implement**:
```typescript
export async function retrainMarkovModels(env: Env): Promise<TrainingResult>
async function fetchTrainingData(env: Env): Promise<TrainingData[]>
async function validateModel(env: Env, newModel, prodModel): Promise<ValidationResult>
async function detectTrainingAnomalies(...): Promise<AnomalyDetectionResult>
async function saveModelWithIntegrity(env: Env, key, model, metadata): Promise<void>
async function safeLoadModel(env: Env, key): Promise<DynamicMarkovChain | null>
function computeSHA256(data: string): Promise<string>
function isValidMarkovModel(data: any): boolean
```

**Dependencies**:
- `src/detectors/markov-chain.ts` (existing)
- Crypto API (built-in)

**Estimated Time**: 4 hours
**Testing**: Unit tests for each function

---

#### 1.3 Add Scheduled Handler

**File**: `src/index.ts`

**Changes**:
```typescript
// Add at bottom of file
export default {
  fetch: app.fetch,
  scheduled: async (event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(retrainMarkovModels(env));
  }
};
```

**Dependencies**: `src/training/online-learning.ts`
**Estimated Time**: 15 minutes
**Testing**: Manual trigger test

---

#### 1.4 Update Cron Configuration

**File**: `wrangler.jsonc`

**Changes**:
```jsonc
{
  // ... existing config ...
  "triggers": {
    "crons": ["0 */6 * * *"]  // Every 6 hours
  }
}
```

**Dependencies**: None
**Estimated Time**: 5 minutes
**Testing**: `wrangler dev --test-scheduled`

---

#### 1.5 Add Admin Training Endpoint

**File**: `src/routes/admin.ts`

**New endpoints**:
```typescript
POST /admin/markov/train           // Manual trigger
GET  /admin/markov/status          // Training status
GET  /admin/markov/history         // Last 10 runs
```

**Dependencies**: `src/training/online-learning.ts`
**Estimated Time**: 1 hour
**Testing**: Integration tests

---

### **Phase 1 Success Criteria**

- [ ] Analytics Engine writes all new fields correctly
- [ ] Training pipeline fetches data from Analytics
- [ ] Models train successfully (saved to KV with checksums)
- [ ] Cron trigger runs every 6 hours
- [ ] Manual training works via admin API
- [ ] All unit tests pass
- [ ] No models deployed to production yet (0% traffic)

**Deliverables**:
- Updated `src/utils/metrics.ts`
- New `src/training/online-learning.ts` (1000+ lines)
- Updated `src/index.ts` (scheduled handler)
- Updated `wrangler.jsonc` (cron trigger)
- Updated `src/routes/admin.ts` (3 new endpoints)
- Test suite for training module

---

## Phase 2: Validation & Security (Week 2)

**Goal**: Add model validation and security checks

### **Tasks**

#### 2.1 Implement Model Validation

**Function**: `validateModel()` in `src/training/online-learning.ts`

**Validation checks**:
- Detection rate ≥ 95%
- False positive rate ≤ 2%
- Accuracy better than current production model
- Minimum 1000 validation samples

**Testing**: Unit tests with mock data

---

#### 2.2 Implement Anomaly Detection

**Function**: `detectTrainingAnomalies()` in `src/training/online-learning.ts`

**Checks**:
- Volume spike (fraud/legit samples)
- Pattern diversity ratio
- Distribution shift
- Entropy analysis
- IP concentration
- Time pattern analysis

**Testing**: Unit tests with synthetic attack data

---

#### 2.3 Add Checksum Verification

**Functions**: `computeSHA256()`, `saveModelWithIntegrity()`, `safeLoadModel()`

**Features**:
- SHA-256 checksum on model save
- Verify checksum on model load
- Fall back to backup if corrupted

**Testing**: Corruption tests (truncated JSON, invalid checksum)

---

#### 2.4 Implement Backup Strategy

**Logic**: Rotate last 3 model versions

**KV keys**:
- `markov_model_production`
- `markov_model_production_backup_1`
- `markov_model_production_backup_2`
- `markov_model_production_backup_3`

**Testing**: Promotion and rollback tests

---

### **Phase 2 Success Criteria**

- [ ] Bad models rejected by validation gate
- [ ] Anomalies detected and training aborted
- [ ] Checksums prevent corrupted models
- [ ] Backup fallback works automatically
- [ ] All security tests pass
- [ ] No false positives in anomaly detection

---

## Phase 3: A/B Testing (Week 3)

**Goal**: Implement traffic splitting and canary deployments

### **Tasks**

#### 3.1 Model Version Management

**KV keys**:
- `markov_model_production` (100% traffic, version A)
- `markov_model_candidate` (10% traffic, version B)

**Metadata**:
- version, status, accuracy, traffic_percent, created_at

---

#### 3.2 Traffic Splitting Logic

**Function**: `selectMarkovModel()` in `src/index.ts`

**Logic**:
```typescript
const bucket = hashValue % 100;
if (bucket < trafficPercent) {
  return candidateModel;  // Canary
} else {
  return productionModel;  // Stable
}
```

**Testing**: Verify consistent model assignment per fingerprint

---

#### 3.3 Canary Metrics Collection

**Analytics field**: blob17 = modelVersion ("A" or "B")

**Queries**: Compare detection rate, FPR, latency between A and B

**Testing**: Verify model version logged correctly

---

#### 3.4 Admin API Expansion

**New endpoints**:
```typescript
POST /admin/markov/promote-to-canary      // Deploy to 10%
GET  /admin/markov/canary-metrics         // Compare A vs B
POST /admin/markov/promote-to-production  // Deploy to 100%
POST /admin/markov/rollback               // Instant rollback
```

**Testing**: Integration tests for each endpoint

---

### **Phase 3 Success Criteria**

- [ ] Traffic splits correctly (90/10)
- [ ] Model version tracked in Analytics
- [ ] Canary metrics available via admin API
- [ ] Promotion/rollback works correctly
- [ ] No traffic disruption during deployment

---

## Phase 4: Automation (Week 4)

**Goal**: Enable auto-promotion with safety checks

### **Tasks**

#### 4.1 Auto-Promotion Logic

**Config**: `AUTO_PROMOTE_TO_CANARY` environment variable

**Rules**:
- Only promote if validation passed
- Only promote if anomaly score < 0.2
- Only promote if improvement ≥ 2%

**Testing**: Test auto and manual modes

---

#### 4.2 Monitoring Dashboard

**Grafana/Analytics queries**:
- Detection rate over time
- Model performance comparison
- Training success rate
- Anomaly alerts

**Testing**: Verify all queries work

---

#### 4.3 Alerting System

**Alerts**:
- Training failure (2+ consecutive)
- Detection rate drop (>5%)
- Anomaly score high (>0.5)
- Model corruption detected

**Implementation**: Webhook or email via admin notifications

**Testing**: Trigger test alerts

---

### **Phase 4 Success Criteria**

- [ ] Auto-promotion works safely
- [ ] Monitoring dashboard shows all metrics
- [ ] Alerts triggered correctly
- [ ] No manual intervention needed for 1 week
- [ ] Detection rate improves by 5-10%

---

## Testing Strategy

### **Unit Tests**

**New test files**:
```
tests/unit/training/
├── online-learning.test.ts         # Core training logic
├── anomaly-detection.test.ts       # Security checks
├── model-validation.test.ts        # Validation logic
└── checksum-verification.test.ts   # Data integrity
```

**Coverage target**: 90%+

---

### **Integration Tests**

**New test files**:
```
tests/integration/
├── training-pipeline.test.ts       # End-to-end training
├── a-b-testing.test.ts             # Traffic splitting
├── canary-deployment.test.ts       # Promotion flow
└── rollback.test.ts                # Rollback scenarios
```

**Scenarios**:
- Happy path (training → validation → deployment)
- Validation failure (bad model rejected)
- Anomaly detection (attack prevented)
- Corruption recovery (backup fallback)
- A/B testing (traffic split verification)

---

### **Load Tests**

**Scenarios**:
- 10,000 validations/sec with A/B testing
- Training with 50,000 samples
- Model load under cold start

**Tools**: `wrk`, `k6`, or custom scripts

---

### **Security Tests**

**Attack simulations**:
```typescript
// Volume spike attack
async function simulateVolumeSpike(env: Env)

// Pattern flooding attack
async function simulatePatternFlooding(env: Env)

// Distributed poisoning
async function simulateSlowPoisoning(env: Env)

// Data corruption
async function simulateCorruption(env: Env)
```

**Expected**: All attacks blocked by security layers

---

## Deployment Plan

### **Week 1: Staging**
- Deploy Phase 1 to staging
- Test cron trigger
- Verify training pipeline
- Run unit tests

### **Week 2: Staging + Security**
- Deploy Phase 2 to staging
- Run attack simulations
- Verify anomaly detection
- Test backup recovery

### **Week 3: Staging + Canary**
- Deploy Phase 3 to staging
- Test A/B splitting
- Verify metrics collection
- Test promotion/rollback

### **Week 4: Production**
- Deploy to production (0% auto-promotion)
- Monitor for 3 days
- Enable 10% canary for 3 days
- Enable 100% if metrics improve
- Monitor for 1 week

---

## Rollback Plan

### **If Phase 1 Fails**
- Disable cron trigger
- Revert code changes
- Analytics still works (backward compatible)

### **If Phase 2 Fails**
- Disable auto-training
- Keep manual training available
- Fix validation issues

### **If Phase 3 Fails**
- Set candidate traffic_percent to 0
- Fall back to production model only
- Fix A/B logic

### **If Phase 4 Fails**
- Disable AUTO_PROMOTE_TO_CANARY
- Require manual approval
- Investigate alerts

---

## Success Metrics

### **Technical Metrics**
- ✅ Detection rate: 90% → 95-98%
- ✅ False positive rate: <2%
- ✅ Training time: <2 minutes
- ✅ Model load time: <50ms
- ✅ Attack prevention: >99%

### **Operational Metrics**
- ✅ Zero production incidents
- ✅ Training success rate: >95%
- ✅ Manual interventions: <1 per week
- ✅ Uptime: 99.99%

### **Cost Metrics**
- ✅ KV costs: <$0.10/month
- ✅ Analytics costs: $0 (included)
- ✅ Cron costs: <$0.01/month
- ✅ Total increase: <$0.15/month

---

## Current Status

**Phase 1: Foundation** - 🟡 IN PROGRESS (10% complete)

**Completed**:
- [x] Plan review and validation
- [x] Architecture design finalized
- [x] Security design finalized
- [x] Current codebase analyzed

**In Progress**:
- [ ] Update Analytics schema (metrics.ts)
- [ ] Create training module (online-learning.ts)
- [ ] Add scheduled handler (index.ts)
- [ ] Update cron config (wrangler.jsonc)
- [ ] Add admin endpoints (admin.ts)

**Next Steps**:
1. Update `src/utils/metrics.ts` (30 min)
2. Create `src/training/online-learning.ts` (4 hours)
3. Update `src/index.ts` (15 min)
4. Update `wrangler.jsonc` (5 min)
5. Add admin endpoints (1 hour)
6. Write tests (2 hours)

**Estimated Completion**: End of Week 1

---

## Risk Register

| Risk | Impact | Likelihood | Mitigation | Owner |
|------|--------|------------|------------|-------|
| KV propagation delay | Medium | Low | Accept 0-30min delay | System |
| Training job timeout | High | Medium | Set 10min timeout, retry logic | Dev |
| Anomaly false positives | Medium | Medium | Tune thresholds, manual override | Dev |
| Model corruption | High | Low | Checksums + 3 backups | System |
| Attack success | High | Low | 8 security layers | Security |
| Cost overrun | Low | Very Low | Budget alerts at $1/month | Ops |

---

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2025-11-01 | Use separate KV namespace (MARKOV_MODEL) | Better isolation, already configured |
| 2025-11-01 | Remap blob15 (markovDetected → blob19) | Need blob15-18 for new fields |
| 2025-11-01 | 3-stage promotion (candidate→canary→prod) | Safer than direct deployment |
| 2025-11-01 | Manual approval by default | Conservative approach, enable auto later |
| 2025-11-01 | Learning rate 0.05 (not 0.1) | More stable, less prone to drift |
| 2025-11-01 | Training every 6 hours (not 12) | More responsive to new patterns |

---

## Open Questions

1. **Q**: Should we enable auto-promotion from day 1?
   **A**: No - require manual approval for first 2 weeks

2. **Q**: What should the anomaly score threshold be?
   **A**: 0.5 (reject if >50% confidence of attack)

3. **Q**: Should we store raw training data in KV?
   **A**: No - query Analytics Engine directly (no storage overhead)

4. **Q**: How long should canary phase last?
   **A**: 24 hours (sufficient for statistical significance)

5. **Q**: Should we integrate with external threat intel?
   **A**: Phase 5 enhancement (not MVP)

---

**Last Updated**: 2025-11-01 22:45 UTC
**Next Review**: 2025-11-08 (end of Week 1)
