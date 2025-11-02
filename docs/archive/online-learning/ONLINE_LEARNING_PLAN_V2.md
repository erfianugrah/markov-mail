# Online Learning Architecture Plan v2

**Version**: 2.0 (Revised)
**Date**: 2025-11-01
**Status**: Planning Phase - Ready for Review

---

## Revisions from V1

1. ✅ **A/B Testing**: New models must prove better performance before deployment
2. ✅ **KV Metadata**: Store model metadata (version, timestamp, metrics) in KV metadata field
3. ✅ **Enhanced Analytics**: Include client IP and user agent (not just fingerprint hash)
4. ✅ **Validation Gate**: Prevent bad models from being deployed automatically

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│  Edge Workers (200+ global locations)                             │
│                                                                    │
│  ┌────────────────┐           ┌────────────────┐                 │
│  │ Model A (90%)  │           │ Model B (10%)  │  ← A/B Testing  │
│  │ Current Prod   │           │ New Candidate  │                 │
│  └────────────────┘           └────────────────┘                 │
│                                                                    │
│  Writes: IP, User-Agent, Decision, Risk Score, Email Local Part   │
└────────────────────────────┬───────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  Analytics Engine (Time-Series Database)                          │
│                                                                    │
│  Fields per validation:                                           │
│  - blob15: client_ip (NEW)                                        │
│  - blob16: user_agent (NEW)                                       │
│  - blob17: model_version (NEW - "A" or "B")                       │
│  - blob1: decision, blob14: email, double1: risk_score            │
│  - ...23 fields total (up from 21)                                │
└────────────────────────────┬───────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  Cron Worker (Every 6 hours)                                      │
│                                                                    │
│  Step 1: Query Analytics for high-confidence samples              │
│  Step 2: Train NEW model (Model C)                                │
│  Step 3: A/B TEST Model C vs Current Production (Model A)         │
│          ├─ Model C Better?  → Promote to Model B (10% traffic)   │
│          ├─ Model C Worse?   → Discard, keep Model A             │
│          └─ Model B performing well after 24h? → Promote to 100%  │
│  Step 4: Save to KV with metadata                                 │
└────────────────────────────┬───────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  KV Storage                                                        │
│                                                                    │
│  Key: "markov_model_production"                                    │
│  Value: { transitions: {...}, version: "A" } (50-200 KB)          │
│  Metadata: { version: "A", updated_at: "...",                     │
│             sample_count: 25000, accuracy: 0.95 } (1 KB)          │
│                                                                    │
│  Key: "markov_model_candidate"                                     │
│  Value: { transitions: {...}, version: "B" } (50-200 KB)          │
│  Metadata: { version: "B", created_at: "...",                     │
│             accuracy: 0.96, traffic_percent: 10 } (1 KB)          │
└──────────────────────────────────────────────────────────────────┘
```

---

## Key Innovation: A/B Testing & Validation Gate

### **Problem with V1**

Auto-deploying models without validation risks:
- Deploying worse models (accuracy drops)
- Label poisoning attacks succeeding
- Model drift going unnoticed

### **Solution: 3-Stage Promotion**

```
Stage 1: CANDIDATE (0% traffic)
  ↓ (passes validation)
Stage 2: CANARY (10% traffic for 24 hours)
  ↓ (performs better than production)
Stage 3: PRODUCTION (100% traffic)
```

### **Validation Criteria** (Must pass ALL):

1. **Detection Rate**: New model detects ≥ 95% of known fraud samples
2. **False Positive Rate**: New model FPR ≤ 2%
3. **Relative Improvement**: New model accuracy > Old model accuracy
4. **Sample Size**: Trained on ≥ 1000 samples (500 fraud + 500 legit)
5. **Cross-Entropy Threshold**: Fraud vs legit separation ≥ 0.5

---

## Enhanced Analytics Schema

### **New Fields** (blob15, blob16, blob17)

```typescript
writeValidationMetric(env.ANALYTICS, {
  // Existing fields (blob1-blob14, double1-double11, index1)
  decision: 'block',
  riskScore: 0.85,
  entropyScore: 0.72,
  emailLocalPart: 'user123',

  // NEW: Client identification
  clientIp: fingerprint.ip,              // blob15 (e.g., "203.0.113.42")
  userAgent: fingerprint.userAgent,      // blob16 (e.g., "Mozilla/5.0...")
  modelVersion: 'A',                     // blob17 ("A" or "B" for A/B testing)

  // Existing analytics fields...
  botScore: fingerprint.botScore,
  country: fingerprint.country,
  asn: fingerprint.asn,
  fingerprintHash: fingerprint.hash,
  latency: 45,
  // ...
});
```

### **Why IP and User Agent?**

1. **Fraud Pattern Analysis**: Identify bot patterns, proxy services
2. **Geolocation Trends**: Detect fraud from specific regions
3. **Device Fingerprinting**: Cross-reference with fingerprint hash
4. **Attack Detection**: Identify distributed attacks from single IP ranges

### **Privacy Consideration**

- **IP**: Stored in Analytics Engine (6-month retention, then auto-deleted)
- **User Agent**: Same retention policy
- **No PII**: Email addresses hashed (existing: blob14 = local part only)
- **GDPR Compliant**: Analytics data not exportable to external systems

---

## KV Storage Schema (Revised)

### **Key 1: `markov_model_production`**

**Value** (50-200 KB JSON):
```json
{
  "version": "A",
  "transitions": {
    "legit": { "a": { "b": 0.12, "c": 0.08, ... }, ... },
    "fraud": { "x": { "y": 0.25, "z": 0.15, ... }, ... }
  },
  "updated_at": "2025-11-01T12:00:00Z",
  "promoted_at": "2025-11-01T18:00:00Z",
  "sample_count_legit": 12500,
  "sample_count_fraud": 2500
}
```

**Metadata** (max 1024 bytes):
```json
{
  "version": "A",
  "updated_at": "2025-11-01T12:00:00Z",
  "accuracy": 0.95,
  "detection_rate": 0.96,
  "false_positive_rate": 0.01,
  "sample_count": 15000,
  "promoted_from_candidate_at": "2025-11-01T18:00:00Z",
  "traffic_percent": 100,
  "status": "production"
}
```

---

### **Key 2: `markov_model_candidate`**

**Value** (50-200 KB JSON):
```json
{
  "version": "B",
  "transitions": { ... },  // New trained model
  "created_at": "2025-11-02T06:00:00Z",
  "parent_version": "A",    // Which model it was trained from
  "sample_count_legit": 13000,
  "sample_count_fraud": 2800
}
```

**Metadata** (max 1024 bytes):
```json
{
  "version": "B",
  "created_at": "2025-11-02T06:00:00Z",
  "accuracy": 0.96,         // Measured on validation set
  "detection_rate": 0.97,
  "false_positive_rate": 0.01,
  "sample_count": 15800,
  "traffic_percent": 10,    // Canary deployment
  "status": "canary",       // "candidate" → "canary" → "production"
  "validation_passed": true
}
```

---

### **Key 3: `markov_training_history`**

**Value** (10-20 KB JSON array):
```json
[
  {
    "timestamp": "2025-11-02T06:00:00Z",
    "model_version": "B",
    "fraud_samples": 2800,
    "legit_samples": 13000,
    "duration_ms": 45000,
    "validation": {
      "passed": true,
      "accuracy_improvement": "+0.01",  // 95% → 96%
      "detection_rate": 0.97,
      "false_positive_rate": 0.01
    },
    "action": "promoted_to_canary",
    "previous_production_version": "A"
  },
  ...  // Last 20 training runs
]
```

---

## A/B Testing Implementation

### **Traffic Split Logic**

```typescript
// In validation handler (src/index.ts)
async function selectMarkovModel(env: Env, fingerprint: Fingerprint): Promise<{
  model: DynamicMarkovChain;
  version: string;
}> {
  // Load production model (always available)
  const productionModel = await env.CONFIG.get('markov_model_production', 'json');

  // Check if there's a candidate model in canary testing
  const candidateMeta = await env.CONFIG.getWithMetadata('markov_model_candidate');

  if (candidateMeta && candidateMeta.metadata?.status === 'canary') {
    const trafficPercent = candidateMeta.metadata.traffic_percent || 0;

    // Use fingerprint hash for consistent A/B assignment
    const hashValue = parseInt(fingerprint.hash.slice(0, 8), 16);
    const bucket = hashValue % 100;

    if (bucket < trafficPercent) {
      // Use candidate model (canary)
      return {
        model: DynamicMarkovChain.fromJSON(candidateMeta.value),
        version: candidateMeta.metadata.version
      };
    }
  }

  // Use production model (default)
  return {
    model: DynamicMarkovChain.fromJSON(productionModel),
    version: productionModel.version
  };
}
```

**Key Properties**:
- **Deterministic**: Same fingerprint always gets same model (no flapping)
- **Configurable**: Traffic percent stored in KV metadata
- **Gradual Rollout**: 0% → 10% → 50% → 100%
- **Instant Rollback**: Set `traffic_percent: 0` to disable canary

---

### **Model Validation Before Promotion**

```typescript
async function validateModel(
  env: Env,
  newModel: DynamicMarkovChain,
  productionModel: DynamicMarkovChain
): Promise<{ passed: boolean; metrics: ValidationMetrics }> {

  // 1. Query validation set from Analytics Engine
  const validationSamples = await fetchValidationSet(env);

  // 2. Test both models on same samples
  const newModelResults = testModel(newModel, validationSamples);
  const prodModelResults = testModel(productionModel, validationSamples);

  // 3. Calculate metrics
  const newMetrics = calculateMetrics(newModelResults);
  const prodMetrics = calculateMetrics(prodModelResults);

  // 4. Apply validation rules
  const passed =
    newMetrics.detectionRate >= 0.95 &&              // Absolute threshold
    newMetrics.falsePositiveRate <= 0.02 &&          // Absolute threshold
    newMetrics.accuracy > prodMetrics.accuracy &&    // Must be better
    validationSamples.length >= 1000;                // Sufficient samples

  return {
    passed,
    metrics: {
      new: newMetrics,
      production: prodMetrics,
      improvement: newMetrics.accuracy - prodMetrics.accuracy
    }
  };
}
```

**Validation Set** (from Analytics Engine):
```sql
SELECT
  blob14 as email_local_part,
  blob1 as decision,
  double1 as risk_score
FROM ANALYTICS
WHERE timestamp >= NOW() - INTERVAL '3' DAY
  AND timestamp < NOW() - INTERVAL '1' DAY  -- Not used in training
  AND (
    (double1 >= 0.7 AND blob1 = 'block') OR  -- Known fraud
    (double1 <= 0.2 AND blob1 = 'allow')     -- Known legit
  )
LIMIT 2000
```

**Why separate validation set?**
- Training data: Last 7 days
- Validation data: 1-3 days ago (not in training set)
- Prevents overfitting detection

---

## Training Workflow (Revised)

### **Step 1: Train New Model**

```typescript
// Every 6 hours via cron
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(trainAndValidateModel(env));
  }
}

async function trainAndValidateModel(env: Env) {
  console.log('🔄 Starting training job...');

  // 1. Fetch training data (last 7 days, high-confidence)
  const trainingData = await fetchTrainingData(env);

  if (trainingData.length < 1000) {
    console.log('⚠️  Insufficient data, skipping training');
    return;
  }

  // 2. Load current production model
  const productionModel = await env.CONFIG.get('markov_model_production', 'json');

  // 3. Train new model (incremental update)
  const newModel = await trainModel(trainingData, productionModel);
  const newVersion = generateVersionId();  // e.g., "B", "C", "D"

  // 4. Validate new model against validation set
  const validation = await validateModel(env, newModel, productionModel);

  if (!validation.passed) {
    console.log('❌ Model validation failed:', validation.metrics);
    await logTrainingFailure(env, validation);
    return;  // Don't deploy bad model
  }

  console.log('✅ Model validation passed:', validation.metrics);

  // 5. Save as candidate model (0% traffic initially)
  await env.CONFIG.put(
    'markov_model_candidate',
    JSON.stringify({
      version: newVersion,
      transitions: newModel.transitions,
      created_at: new Date().toISOString(),
      parent_version: productionModel.version,
      ...
    }),
    {
      metadata: {
        version: newVersion,
        status: 'candidate',  // Not yet deployed
        accuracy: validation.metrics.new.accuracy,
        detection_rate: validation.metrics.new.detectionRate,
        false_positive_rate: validation.metrics.new.falsePositiveRate,
        validation_passed: true,
        traffic_percent: 0,  // Awaiting manual/auto promotion
        ...
      }
    }
  );

  // 6. Log training success
  await logTrainingSuccess(env, {
    version: newVersion,
    validation: validation.metrics,
    action: 'created_candidate'
  });

  // 7. Auto-promote to canary (10% traffic) if configured
  if (env.AUTO_PROMOTE_TO_CANARY === 'true') {
    await promoteToCanary(env, newVersion);
  }
}
```

---

### **Step 2: Promote to Canary (10% Traffic)**

**Trigger**: Manual via admin API or auto after training

```typescript
POST /admin/markov/promote-to-canary
{
  "version": "B"
}

// Implementation
async function promoteToCanary(env: Env, version: string) {
  const candidate = await env.CONFIG.getWithMetadata('markov_model_candidate');

  if (!candidate || candidate.value.version !== version) {
    throw new Error('Candidate not found');
  }

  if (!candidate.metadata.validation_passed) {
    throw new Error('Model failed validation');
  }

  // Update metadata to enable 10% traffic
  await env.CONFIG.put(
    'markov_model_candidate',
    candidate.value,
    {
      metadata: {
        ...candidate.metadata,
        status: 'canary',
        traffic_percent: 10,
        canary_started_at: new Date().toISOString()
      }
    }
  );

  console.log(`✅ Model ${version} promoted to canary (10% traffic)`);
}
```

---

### **Step 3: Monitor Canary Performance**

**Query**: Compare Model B (canary) vs Model A (production) performance

```sql
SELECT
  blob17 as model_version,  -- 'A' or 'B'
  SUM(_sample_interval) as request_count,
  SUM(_sample_interval * IF(blob1 IN ('block', 'warn'), 1, 0)) / SUM(_sample_interval) as detection_rate,
  SUM(_sample_interval * double1) / SUM(_sample_interval) as avg_risk_score,
  quantileExactWeighted(0.95)(double5, _sample_interval) as p95_latency_ms
FROM ANALYTICS
WHERE timestamp >= NOW() - INTERVAL '24' HOUR
  AND blob17 IN ('A', 'B')  -- Only compare A/B test traffic
GROUP BY model_version
```

**Expected Results After 24 Hours**:
```
| model_version | request_count | detection_rate | avg_risk_score | p95_latency_ms |
|---------------|---------------|----------------|----------------|----------------|
| A             | 90000         | 0.94           | 0.42           | 150            |
| B             | 10000         | 0.96           | 0.44           | 155            |
```

**Promote to Production IF**:
- Model B detection_rate > Model A detection_rate (+2% improvement)
- Model B p95_latency_ms < 200ms (acceptable performance)
- Model B request_count >= 5000 (sufficient sample size)
- No anomalies detected (check error logs)

---

### **Step 4: Promote to Production (100% Traffic)**

**Trigger**: Manual after 24h canary testing OR auto if metrics pass

```typescript
POST /admin/markov/promote-to-production
{
  "version": "B"
}

// Implementation
async function promoteToProduction(env: Env, version: string) {
  const candidate = await env.CONFIG.getWithMetadata('markov_model_candidate');

  if (!candidate || candidate.value.version !== version) {
    throw new Error('Candidate not found');
  }

  if (candidate.metadata.status !== 'canary') {
    throw new Error('Model must be in canary status');
  }

  // 1. Backup current production model
  const currentProd = await env.CONFIG.get('markov_model_production', 'json');
  await env.CONFIG.put(
    `markov_model_backup_${currentProd.version}`,
    JSON.stringify(currentProd)
  );

  // 2. Promote candidate to production
  await env.CONFIG.put(
    'markov_model_production',
    candidate.value,
    {
      metadata: {
        ...candidate.metadata,
        status: 'production',
        traffic_percent: 100,
        promoted_at: new Date().toISOString(),
        previous_version: currentProd.version
      }
    }
  );

  // 3. Delete candidate (now in production)
  await env.CONFIG.delete('markov_model_candidate');

  console.log(`✅ Model ${version} promoted to production (100% traffic)`);
}
```

---

## Configuration Updates

### **wrangler.toml** (add cron trigger + separate KV namespace)

```toml
name = "bogus-email-pattern-recognition"
main = "src/index.ts"
compatibility_date = "2025-11-01"

# Cron trigger for model training
[triggers]
crons = ["0 */6 * * *"]  # Every 6 hours at :00 minutes

# KV Namespaces
[[kv_namespaces]]
binding = "CONFIG"
id = "YOUR_CONFIG_KV_ID"
preview_id = "YOUR_CONFIG_PREVIEW_KV_ID"

# Separate KV namespace for Markov models (better isolation)
[[kv_namespaces]]
binding = "MARKOV_MODEL"
id = "fcfe1c2f322a43a7b242eff4c8fb91ce"
remote = true

# Analytics Engine
[[analytics_engine_datasets]]
binding = "ANALYTICS"

# Environment variables (set via wrangler secret)
[vars]
AUTO_PROMOTE_TO_CANARY = "false"  # Manual approval required
```

**Why separate KV namespace?**
- ✅ **Isolation**: Model corruption doesn't affect config data
- ✅ **Permissions**: Can grant read-only access to models separately
- ✅ **Performance**: Separate cache invalidation
- ✅ **Organization**: Clear separation of concerns

**Cron Schedule Options**:
- `0 */6 * * *` - Every 6 hours (recommended for production)
- `0 */12 * * *` - Every 12 hours (more conservative)
- `0 2,8,14,20 * * *` - At 2am, 8am, 2pm, 8pm UTC (specific times)

---

### **src/config.ts** (add new defaults)

```typescript
export const DEFAULT_CONFIG: FraudDetectionConfig = {
  // ... existing config ...

  markovChain: {
    enabled: true,
    autoTraining: true,
    autoPromoteToCanary: false,  // NEW: Require manual approval
    autoPromoteToProduction: false,  // NEW: Require manual approval
    learningRate: 0.05,  // Conservative (was 0.1 in v1)
    minSamples: 1000,    // Minimum samples for training

    // Confidence thresholds for training data
    confidenceThresholdFraud: 0.6,
    confidenceThresholdLegit: 0.3,

    // Validation thresholds (must pass to deploy)
    validationThresholds: {
      minDetectionRate: 0.95,       // 95% detection rate
      maxFalsePositiveRate: 0.02,   // 2% false positive rate
      minAccuracyImprovement: 0.00, // Must be better than current
      minValidationSamples: 1000    // Need 1000+ samples for validation
    },

    // A/B testing config
    canaryTrafficPercent: 10,  // 10% of traffic for canary
    canaryDurationHours: 24,   // Test for 24 hours before promoting

    // Training data config
    trainingLookbackDays: 7,
    validationLookbackDays: 3,
    maxTrainingSamples: 50000
  }
};
```

---

## Admin Endpoints (Complete API)

### **POST /admin/markov/train**
Manually trigger training (bypasses cron schedule)

**Request**:
```bash
curl -X POST https://your-worker.workers.dev/admin/markov/train \
  -H "X-API-Key: $ADMIN_API_KEY"
```

**Response**:
```json
{
  "success": true,
  "model_version": "B",
  "validation": {
    "passed": true,
    "accuracy": 0.96,
    "detection_rate": 0.97,
    "false_positive_rate": 0.01,
    "improvement": "+0.01"
  },
  "status": "candidate",
  "next_step": "Promote to canary with: POST /admin/markov/promote-to-canary"
}
```

---

### **POST /admin/markov/promote-to-canary**
Deploy model to 10% of traffic

**Request**:
```bash
curl -X POST https://your-worker.workers.dev/admin/markov/promote-to-canary \
  -H "X-API-Key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"version": "B"}'
```

**Response**:
```json
{
  "success": true,
  "model_version": "B",
  "status": "canary",
  "traffic_percent": 10,
  "message": "Model B deployed to 10% of traffic. Monitor for 24 hours before promoting to production."
}
```

---

### **GET /admin/markov/canary-metrics**
Compare canary vs production performance

**Request**:
```bash
curl https://your-worker.workers.dev/admin/markov/canary-metrics \
  -H "X-API-Key: $ADMIN_API_KEY"
```

**Response**:
```json
{
  "canary": {
    "version": "B",
    "request_count": 12500,
    "detection_rate": 0.96,
    "avg_risk_score": 0.44,
    "p95_latency_ms": 155,
    "duration_hours": 18
  },
  "production": {
    "version": "A",
    "request_count": 112500,
    "detection_rate": 0.94,
    "avg_risk_score": 0.42,
    "p95_latency_ms": 150
  },
  "comparison": {
    "detection_rate_improvement": "+2.1%",
    "latency_impact": "+3.3%",
    "recommendation": "promote_to_production",
    "confidence": "high"
  }
}
```

---

### **POST /admin/markov/promote-to-production**
Deploy model to 100% of traffic

**Request**:
```bash
curl -X POST https://your-worker.workers.dev/admin/markov/promote-to-production \
  -H "X-API-Key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"version": "B"}'
```

**Response**:
```json
{
  "success": true,
  "model_version": "B",
  "status": "production",
  "traffic_percent": 100,
  "previous_version": "A",
  "message": "Model B promoted to production. Previous model A backed up."
}
```

---

### **POST /admin/markov/rollback**
Rollback to previous production model

**Request**:
```bash
curl -X POST https://your-worker.workers.dev/admin/markov/rollback \
  -H "X-API-Key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"to_version": "A"}'
```

**Response**:
```json
{
  "success": true,
  "rolled_back_to": "A",
  "previous_version": "B",
  "message": "Rolled back to model A. Model B saved as backup."
}
```

---

### **GET /admin/markov/status**
Get current model status and training history

**Request**:
```bash
curl https://your-worker.workers.dev/admin/markov/status \
  -H "X-API-Key: $ADMIN_API_KEY"
```

**Response**:
```json
{
  "production": {
    "version": "A",
    "accuracy": 0.95,
    "traffic_percent": 100,
    "updated_at": "2025-11-01T12:00:00Z",
    "sample_count": 15000
  },
  "candidate": {
    "version": "B",
    "status": "canary",
    "accuracy": 0.96,
    "traffic_percent": 10,
    "created_at": "2025-11-02T06:00:00Z",
    "canary_started_at": "2025-11-02T08:00:00Z",
    "hours_in_canary": 18
  },
  "training": {
    "last_run": "2025-11-02T06:00:00Z",
    "next_run": "2025-11-02T12:00:00Z",
    "auto_training_enabled": true,
    "auto_promote_to_canary": false,
    "auto_promote_to_production": false
  },
  "history": [
    {
      "timestamp": "2025-11-02T06:00:00Z",
      "model_version": "B",
      "action": "trained_and_validated",
      "validation_passed": true,
      "accuracy_improvement": "+0.01"
    },
    ...
  ]
}
```

---

## Monitoring Dashboard Queries

### **1. Model Performance Comparison (A/B Test)**

```sql
SELECT
  blob17 as model_version,
  toStartOfHour(timestamp) as hour,
  SUM(_sample_interval) as requests,
  SUM(_sample_interval * IF(blob1 IN ('block', 'warn'), 1, 0)) / SUM(_sample_interval) as detection_rate,
  SUM(_sample_interval * double1) / SUM(_sample_interval) as avg_risk_score,
  quantileExactWeighted(0.95)(double5, _sample_interval) as p95_latency_ms
FROM ANALYTICS
WHERE timestamp >= NOW() - INTERVAL '48' HOUR
  AND blob17 IN ('A', 'B')
GROUP BY model_version, hour
ORDER BY hour DESC, model_version
```

### **2. Detection by IP Range (Fraud Patterns)**

```sql
SELECT
  substring(blob15, 1, 11) as ip_prefix,  -- e.g., "203.0.113."
  blob3 as country,
  SUM(_sample_interval) as validation_count,
  SUM(_sample_interval * IF(blob1 = 'block', 1, 0)) as blocks,
  SUM(_sample_interval * IF(blob1 = 'block', 1, 0)) / SUM(_sample_interval) as block_rate
FROM ANALYTICS
WHERE timestamp >= NOW() - INTERVAL '24' HOUR
  AND blob1 = 'block'
GROUP BY ip_prefix, country
HAVING validation_count > 100
ORDER BY blocks DESC
LIMIT 20
```

### **3. Bot Detection by User Agent**

```sql
SELECT
  blob16 as user_agent,
  SUM(_sample_interval) as request_count,
  SUM(_sample_interval * double3) / SUM(_sample_interval) as avg_bot_score,
  SUM(_sample_interval * IF(blob1 IN ('block', 'warn'), 1, 0)) / SUM(_sample_interval) as fraud_rate
FROM ANALYTICS
WHERE timestamp >= NOW() - INTERVAL '24' HOUR
  AND blob16 IS NOT NULL
GROUP BY user_agent
HAVING request_count > 50
ORDER BY fraud_rate DESC
LIMIT 20
```

### **4. Model Drift Detection**

```sql
SELECT
  toStartOfDay(timestamp) as day,
  AVG(double10) as avg_markov_cross_entropy_legit,  -- Should be stable
  AVG(double11) as avg_markov_cross_entropy_fraud,  -- Should be stable
  STDDEV(double10) as stddev_legit,
  STDDEV(double11) as stddev_fraud
FROM ANALYTICS
WHERE timestamp >= NOW() - INTERVAL '30' DAY
  AND double10 IS NOT NULL
GROUP BY day
ORDER BY day DESC
```

**Alert if**:
- `stddev_legit` or `stddev_fraud` > 2.0 (high variance = drift)
- `avg_markov_cross_entropy_legit` changes > 20% in 7 days

---

## Implementation Checklist

### **Phase 1: Foundation** (Week 1)

- [ ] Add `blob15`, `blob16`, `blob17` to Analytics Engine writes
- [ ] Update `writeValidationMetric()` to include IP, user-agent, model version
- [ ] Create `src/training/online-learning.ts` with training logic
- [ ] Add `scheduled()` handler to `src/index.ts`
- [ ] Update `wrangler.toml` with cron trigger
- [ ] Test training locally with Analytics Engine data
- [ ] Deploy to staging, verify cron runs every 6 hours

### **Phase 2: Validation** (Week 2)

- [ ] Implement `validateModel()` function with thresholds
- [ ] Add validation set query (separate from training set)
- [ ] Test model validation with production-like data
- [ ] Ensure bad models are rejected (accuracy drop test)
- [ ] Log validation results to `markov_training_history`

### **Phase 3: A/B Testing** (Week 3)

- [ ] Implement `selectMarkovModel()` for traffic splitting
- [ ] Add `markov_model_candidate` KV key with metadata
- [ ] Update validation handler to use model version A or B
- [ ] Write `blob17` (model version) to Analytics Engine
- [ ] Test traffic split: 90% model A, 10% model B

### **Phase 4: Admin API** (Week 4)

- [ ] `POST /admin/markov/train` - Manual training
- [ ] `POST /admin/markov/promote-to-canary` - Deploy to 10%
- [ ] `GET /admin/markov/canary-metrics` - Compare A vs B
- [ ] `POST /admin/markov/promote-to-production` - Deploy to 100%
- [ ] `POST /admin/markov/rollback` - Revert to previous model
- [ ] `GET /admin/markov/status` - Current state

### **Phase 5: Automation** (Week 5)

- [ ] Auto-promote to canary after validation (optional)
- [ ] Auto-promote to production after 24h if metrics pass (optional)
- [ ] Add monitoring alerts (detection rate drop, training failure)
- [ ] Create Grafana dashboard for model performance
- [ ] Document runbook for operators

---

## Rollout Timeline

| Week | Phase | Goal | Traffic % |
|------|-------|------|-----------|
| 1 | Foundation | Training pipeline works | 0% (no deployment) |
| 2 | Validation | Models validated before deploy | 0% (manual testing) |
| 3 | A/B Testing | Canary deployment works | 10% (manual promotion) |
| 4 | Admin API | Full control via API | 10% → 100% (manual) |
| 5 | Automation | Auto-promote with safety checks | 100% (auto) |

---

## Success Metrics (Revised)

### **Phase 3: A/B Testing**

- ✅ Training completes in <2 minutes
- ✅ Validation rejects bad models (accuracy <95%)
- ✅ Canary deployment splits traffic 90/10
- ✅ Analytics tracks model version correctly
- ✅ Operators can manually promote/rollback

### **Phase 5: Automation**

- ✅ Detection rate improves 95% → 97-98%
- ✅ False positive rate stays <2%
- ✅ Models auto-promote safely (no manual intervention)
- ✅ Zero production incidents from bad models
- ✅ Training cost <$0.10/month

---

## Cost Analysis (Revised)

### **Additional Costs (vs V1)**

1. **KV Writes**: Same as V1 (~12/day)
2. **Analytics Engine**: +2 fields (blob15, blob16, blob17) = $0/month (included)
3. **A/B Testing Traffic**: 10% canary = no additional cost
4. **Admin API**: No additional cost (same worker)

**Total**: **~$5.02/month** (same as V1)

---

## Risk Mitigation (Enhanced)

| Risk | V1 Mitigation | V2 Enhancement |
|------|---------------|----------------|
| **Bad model deployed** | Monitor only | ✅ Validation gate + A/B testing |
| **Label poisoning** | High-confidence filtering | ✅ Same + validation set separation |
| **False positive spike** | Rollback | ✅ Auto-detect in canary + instant rollback |
| **Model drift** | Monitoring | ✅ Cross-entropy stability checks |
| **Training failure** | Retry logic | ✅ Validation prevents deployment |

---

## Open Questions (Resolved)

1. ~~**KV Metadata Size**~~: ✅ Metadata max 1 KB, store model in value
2. ~~**Model Validation**~~: ✅ Validation gate before deployment
3. ~~**IP/User Agent**~~: ✅ Add to Analytics Engine (blob15, blob16)
4. ~~**Auto-promotion**~~: ✅ Manual approval required by default

---

## Next Steps

**Ready to implement?** Let me know and I'll:

1. Update `src/utils/metrics.ts` to include IP, user agent, model version
2. Create `src/training/online-learning.ts` with training + validation
3. Add `scheduled()` handler to `src/index.ts`
4. Add admin endpoints to `src/routes/admin.ts`
5. Update `wrangler.toml` with cron trigger
6. Update tests to validate new fields

**Or** if you have more feedback, I'll revise the plan again!

---

**Plan approved? Let's build it! 🚀**
