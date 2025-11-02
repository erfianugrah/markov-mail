# Logging & Observability Standards

This document defines the logging and observability standards for the Bogus Email Pattern Recognition system.

## Table of Contents

1. [Overview](#overview)
2. [Logging Architecture](#logging-architecture)
3. [Structured Logging with Pino](#structured-logging-with-pino)
4. [Analytics Engine Metrics](#analytics-engine-metrics)
5. [Event Naming Conventions](#event-naming-conventions)
6. [Privacy & Security](#privacy--security)
7. [Examples](#examples)
8. [Querying Logs](#querying-logs)

---

## Overview

The system uses **two separate observability mechanisms**:

1. **Pino.js Structured Logs** - For application events (training, deployments, errors)
2. **Cloudflare Analytics Engine** - For high-volume validation metrics (per-request data)

### Why Two Systems?

- **Analytics Engine**: High-volume, time-series data (10,000+ requests/hour)
  - Optimized for aggregation queries
  - Limited schema (20 blobs, 20 doubles, 1 index)
  - Used for: validation metrics, A/B test assignments, risk scores

- **Pino Logs**: Low-volume, rich application events (~10 events/hour)
  - Flexible JSON schema
  - Full context and stack traces
  - Used for: training pipeline, deployments, errors, configuration changes

---

## Logging Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Application Layer                         │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────┐              ┌────────────────────┐  │
│  │  Validation API  │              │ Training Pipeline  │  │
│  │  (per request)   │              │ (every 6 hours)    │  │
│  └────────┬─────────┘              └─────────┬──────────┘  │
│           │                                   │              │
│           ▼                                   ▼              │
│  ┌─────────────────┐              ┌────────────────────┐  │
│  │ writeValidation │              │   Pino Logger      │  │
│  │    Metric()     │              │  logger.info()     │  │
│  └────────┬────────┘              └─────────┬──────────┘  │
│           │                                   │              │
└───────────┼───────────────────────────────────┼─────────────┘
            │                                   │
            ▼                                   ▼
   ┌──────────────────┐            ┌──────────────────────┐
   │ Analytics Engine │            │ Cloudflare Workers   │
   │    ANALYTICS     │            │       Logs           │
   │                  │            │                      │
   │ - Validation     │            │ - Training events    │
   │ - Risk scores    │            │ - Deployments        │
   │ - A/B variants   │            │ - Errors             │
   └──────────────────┘            │ - Config changes     │
                                   └──────────────────────┘
```

---

## Structured Logging with Pino

### Setup

All application code should import the centralized logger:

```typescript
import { logger } from '../logger';
```

The logger is configured in `src/logger.ts` with:
- JSON output for production
- Pretty-printing for development
- Log level: INFO (configurable via environment)

### Log Levels

Use appropriate log levels:

| Level | Usage | Examples |
|-------|-------|----------|
| `error` | System failures, exceptions | Training failed, API errors, anomaly detected |
| `warn` | Degraded operation, unexpected state | Validation failed, missing config, low confidence |
| `info` | Normal operations, milestones | Training started, model deployed, request processed |
| `debug` | Detailed debugging (not used in prod) | Internal state, decision trees |

### Log Structure

**Standard Format:**

```typescript
logger.info({
  event: 'event_name',        // Required: snake_case event identifier
  field1: value1,              // Optional: relevant context fields
  field2: value2,
  ...
}, 'Human readable message');  // Required: short description
```

**Example:**

```typescript
logger.info({
  event: 'training_completed',
  model_version: '20250102_143022',
  total_samples: 15000,
  fraud_samples: 3200,
  legit_samples: 11800,
  duration_ms: 4523,
}, 'Training completed successfully');
```

### Error Logging

**Standard Error Format:**

```typescript
logger.error({
  event: 'error_event_name',
  error: error instanceof Error ? {
    message: error.message,
    stack: error.stack,
    name: error.name,
  } : String(error),
  // Additional context
}, 'Error description');
```

**Example:**

```typescript
catch (error) {
  logger.error({
    event: 'training_pipeline_failed',
    error: error instanceof Error ? {
      message: error.message,
      stack: error.stack,
      name: error.name,
    } : String(error),
    model_version: trainedModels?.version,
  }, 'Training Worker Failed');
}
```

---

## Analytics Engine Metrics

### Validation Metrics Only

The `ANALYTICS` dataset is **exclusively** for validation request metrics.

**Usage:**

```typescript
import { writeValidationMetric } from '../utils/metrics';

writeValidationMetric(env.ANALYTICS, {
  decision: 'block',
  riskScore: 0.92,
  entropyScore: 4.2,
  botScore: 25,
  country: 'US',
  asn: 15169,
  blockReason: 'high_risk_score',
  fingerprintHash: 'abc123...',
  latency: 45,

  // Enhanced fields
  emailLocalPart: 'user123',
  domain: 'example.com',
  tld: 'com',
  patternType: 'random',
  markovDetected: true,
  markovConfidence: 0.85,

  // A/B test fields
  experimentId: 'exp_20250102',
  variant: 'treatment',
  bucket: 42,
});
```

### Schema Design

Analytics Engine has strict limits:
- **20 blobs** (categorical strings)
- **20 doubles** (numeric values)
- **1 index** (for filtering)

See `src/utils/metrics.ts` for the complete schema mapping.

### Do NOT Use Analytics Engine For:

❌ Training pipeline events
❌ Model deployment events
❌ Configuration changes
❌ Low-frequency events (<1/minute)

Use **Pino logs** for these instead.

---

## Event Naming Conventions

### Event Names

- Use `snake_case` for event names
- Use present tense for ongoing events: `training_started`
- Use past tense for completed events: `training_completed`
- Include the domain: `markov_models_loaded`, `ab_test_created`

### Standard Events

**Training Pipeline:**
```
- training_pipeline_started
- training_completed
- validation_passed / validation_failed
- canary_deployment_started
- ab_test_created
- model_promoted
- training_pipeline_failed
```

**Online Learning:**
```
- online_learning_started
- training_lock_failed / training_lock_acquired
- training_data_loaded
- training_anomaly_detected
- insufficient_training_data
```

**Model Loading:**
```
- markov_models_loaded
- markov_namespace_missing
- ensemble_loading_failed
```

**A/B Testing:**
```
- ab_test_config_load_failed
- experiment_expired
- model_auto_promoted
- canary_rollback
```

**Configuration:**
```
- config_loaded
- config_updated
- weights_changed
```

---

## Privacy & Security

### Email Hashing

**NEVER log raw email addresses.** Always hash sensitive data:

```typescript
import { hashEmail } from '../utils/hash';

const emailHash = await hashEmail(email);

logger.info({
  event: 'validation_processed',
  email_hash: emailHash.substring(0, 8), // First 8 chars only
  decision: 'allow',
});
```

### PII Redaction

Do not log:
- Full email addresses
- IP addresses (unless hashed)
- User agents (unless truncated)
- API keys or tokens
- Internal identifiers that could be traced to users

**Safe to log:**
- Risk scores
- Pattern types
- Aggregated statistics
- Model versions
- Configuration values

### Security Events

Always log security-related events at `error` or `warn` level:

```typescript
logger.error({
  event: 'training_anomaly_detected',
  anomaly_score: 0.92,
  alerts: ['fraud_spike', 'unusual_patterns'],
  fraud_count: fraudSamples.length,
  legit_count: legitSamples.length,
}, 'Training ABORTED due to anomalies');
```

---

## Examples

### Example 1: Training Pipeline

```typescript
// Start
logger.info({
  event: 'training_pipeline_started',
  trigger: 'scheduled',
  scheduled_time: new Date(event.scheduledTime).toISOString(),
  cron: event.cron,
}, 'Automated Training & Deployment Pipeline Started');

// Progress
logger.info({
  event: 'training_completed',
  model_version: trainedModels.version,
  orders: trainedModels.metadata.orders,
  total_samples: trainedModels.metadata.trainingSamples.total,
  legit_samples: trainedModels.metadata.trainingSamples.legit,
  fraud_samples: trainedModels.metadata.trainingSamples.fraud,
  duration_ms: trainedModels.metadata.trainingDuration,
}, 'Training Complete');

// Validation
logger.info({
  event: 'validation_passed',
  model_version: trainedModels.version,
  recommendation: validationResult.recommendation,
  accuracy: validationResult.metrics.accuracy,
  precision: validationResult.metrics.precision,
  recall: validationResult.metrics.recall,
  f1_score: validationResult.metrics.f1Score,
}, 'Validation PASSED: deploy');

// Deployment
logger.info({
  event: 'canary_deployment_started',
  model_version: trainedModels.version,
}, 'Auto-deploying to canary...');

// Error
logger.error({
  event: 'training_pipeline_failed',
  error: error instanceof Error ? {
    message: error.message,
    stack: error.stack,
    name: error.name,
  } : String(error),
}, 'Training Worker Failed');
```

### Example 2: Online Learning

```typescript
// Lock acquisition
logger.info({
  event: 'online_learning_started',
  trigger: 'scheduled',
}, 'Starting Markov Chain retraining');

// Data loading
logger.info({
  event: 'training_data_loaded',
  fraud_count: fraudSamples.length,
  legit_count: legitSamples.length,
  total: trainingData.length,
}, 'Training data loaded');

// Anomaly detection
logger.error({
  event: 'training_anomaly_detected',
  anomaly_score: anomalyCheck.score,
  alerts: anomalyCheck.alerts,
  fraud_count: fraudSamples.length,
  legit_count: legitSamples.length,
}, 'Training ABORTED due to anomalies');
```

### Example 3: Model Loading

```typescript
// Warning
logger.warn({
  event: 'markov_namespace_missing',
  namespace: 'MARKOV_MODEL',
}, 'MARKOV_MODEL namespace not configured');

// Success
logger.info({
  event: 'markov_models_loaded',
  model_type: 'production',
  namespace: 'MARKOV_MODEL',
  keys: ['MM_legit_production', 'MM_fraud_production'],
}, 'Markov Chain models loaded successfully');

// Failure
logger.error({
  event: 'ensemble_loading_failed',
  model_version: 'production',
  error: error instanceof Error ? {
    message: error.message,
  } : String(error),
}, 'Failed to load ensemble models');
```

---

## Querying Logs

### Cloudflare Workers Logs

View logs in the Cloudflare dashboard:
1. Go to Workers & Pages → Your Worker
2. Click "Logs" tab
3. Filter by log level or search for event names

**CLI:**
```bash
npx wrangler tail
```

**Filter by event:**
```bash
npx wrangler tail | grep "training_completed"
```

### Analytics Engine Queries

Query validation metrics using GraphQL or SQL:

**Example SQL Query:**
```sql
SELECT
  blob1 as decision,
  COUNT(*) as count,
  AVG(double1) as avg_risk_score
FROM ANALYTICS
WHERE timestamp >= NOW() - INTERVAL '1' HOUR
GROUP BY decision
ORDER BY count DESC
```

See `src/utils/metrics.ts` for example dashboard queries.

---

## Best Practices

### ✅ Do

- Use structured logging with event names
- Include relevant context fields
- Hash sensitive data (emails, IPs)
- Use appropriate log levels
- Add human-readable messages
- Log errors with stack traces
- Log at key decision points
- Include timing/duration metrics

### ❌ Don't

- Use `console.log()` or `console.error()`
- Log raw email addresses or PII
- Log API keys or secrets
- Create custom logging functions
- Mix training metrics into Analytics Engine
- Log verbose data in tight loops
- Use string interpolation for context (use fields instead)

### Performance Considerations

- Pino is **async** by default (non-blocking)
- Analytics Engine writes are **fire-and-forget**
- Both are safe to use in hot paths
- Avoid logging in loops (aggregate first)

---

## Migration Guide

If you find old-style logging:

**Before:**
```typescript
console.log('Training started');
console.log(`Model version: ${version}`);
```

**After:**
```typescript
logger.info({
  event: 'training_started',
  model_version: version,
}, 'Training started');
```

**Before:**
```typescript
console.error('Training failed:', error);
```

**After:**
```typescript
logger.error({
  event: 'training_failed',
  error: error instanceof Error ? {
    message: error.message,
    stack: error.stack,
    name: error.name,
  } : String(error),
}, 'Training failed');
```

---

## References

- [Pino.js Documentation](https://getpino.io/)
- [Cloudflare Workers Logs](https://developers.cloudflare.com/workers/observability/logs/)
- [Cloudflare Analytics Engine](https://developers.cloudflare.com/analytics/analytics-engine/)
- Project file: `src/logger.ts`
- Project file: `src/utils/metrics.ts`
