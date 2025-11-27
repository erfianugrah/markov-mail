# Markov Mail - Database Operations Documentation

## Overview

Markov Mail uses Cloudflare D1 (SQLite at edge) for storing analytics, training metrics, A/B test results, and administrative events. This document comprehensively details all database operations.

**Database Binding**: `DB`
**Database Name**: `ANALYTICS`
**Database ID**: `d0d5f809-dbae-47fd-af40-62941d4e5680`

---

## Table of Contents

1. [Schema Overview](#schema-overview)
2. [Tables](#tables)
3. [Insert Operations](#insert-operations)
4. [Query Operations](#query-operations)
5. [Migrations](#migrations)
6. [Database Management](#database-management)
7. [CLI Commands](#cli-commands)
8. [Indexes](#indexes)

---

## Schema Overview

**Schema Version**: 2.5.1
**Last Updated**: 2025-11-27
**Migrations Included**: 0001-0008

The database schema includes:
- **4 tables**: validations, training_metrics, ab_test_metrics, admin_metrics
- **24 indexes** on validations table + 9 additional indexes on other tables
- **67 columns** in the validations table alone

---

## Tables

### 1. validations

**Purpose**: Stores all email validation events with detailed fraud detection data

**Primary Key**: `id` (INTEGER AUTOINCREMENT)

**Columns** (67 total):

#### Decision & Risk
- `decision` (TEXT, NOT NULL) - CHECK: 'allow', 'warn', 'block'
- `risk_score` (REAL, NOT NULL) - CHECK: 0.0-1.0
- `block_reason` (TEXT, nullable)

#### Email Analysis
- `email_local_part` (TEXT)
- `domain` (TEXT)
- `tld` (TEXT)
- `fingerprint_hash` (TEXT, NOT NULL) - SHA256 hash for deduplication

#### Pattern Detection
- `pattern_type` (TEXT) - e.g., 'sequential', 'dated', 'formatted'
- `pattern_family` (TEXT)
- `is_disposable` (INTEGER) - 0=false, 1=true (SQLite boolean)
- `is_free_provider` (INTEGER)
- `has_plus_addressing` (INTEGER)
- `has_keyboard_walk` (INTEGER) - **DEPRECATED** (v2.2.0) - Always 0
- `is_gibberish` (INTEGER) - **DEPRECATED** (v2.2.0) - Always 0

#### Scores
- `entropy_score` (REAL)
- `bot_score` (REAL)
- `tld_risk_score` (REAL)
- `domain_reputation_score` (REAL)
- `pattern_confidence` (REAL)

#### Markov Chain Analysis (Phase 7)
- `markov_detected` (INTEGER, DEFAULT 0)
- `markov_confidence` (REAL)
- `markov_cross_entropy_legit` (REAL) - Cross-entropy against legit model
- `markov_cross_entropy_fraud` (REAL) - Cross-entropy against fraud model

#### Ensemble Metadata (v2.3+)
- `ensemble_reasoning` (TEXT) - JSON explanation of ensemble decision
- `model_2gram_prediction` (TEXT) - CHECK: 'fraud', 'legit', NULL
- `model_3gram_prediction` (TEXT) - CHECK: 'fraud', 'legit', NULL

#### OOD Detection (v2.4+)
- `min_entropy` (REAL) - min(H_legit, H_fraud) - abnormality measure
- `abnormality_score` (REAL) - How far above OOD threshold
- `abnormality_risk` (REAL) - Risk contribution (0.0-0.6)
- `ood_detected` (INTEGER, DEFAULT 0)

#### OOD Zone Tracking (v2.4.1+)
- `ood_zone` (TEXT) - 'none' (<3.8 nats), 'warn' (3.8-5.5), 'block' (5.5+)

#### Online Learning & A/B Testing
- `client_ip` (TEXT)
- `user_agent` (TEXT)
- `model_version` (TEXT)
- `exclude_from_training` (INTEGER, DEFAULT 0)
- `ip_reputation_score` (REAL)

#### A/B Testing
- `experiment_id` (TEXT)
- `variant` (TEXT) - CHECK: 'control', 'treatment', NULL
- `bucket` (INTEGER) - CHECK: 0-99 or NULL

#### Geographic & Network (Basic)
- `country` (TEXT)
- `asn` (INTEGER)

#### Performance
- `latency` (REAL, NOT NULL) - Milliseconds

#### Algorithm Versioning (v2.1+)
- `pattern_classification_version` (TEXT)

#### Enhanced Request Metadata (v2.5+)
**Geographic (Enhanced)**:
- `region` (TEXT)
- `city` (TEXT)
- `postal_code` (TEXT)
- `timezone` (TEXT)
- `latitude` (TEXT)
- `longitude` (TEXT)
- `continent` (TEXT)
- `is_eu_country` (TEXT)

**Network (Enhanced)**:
- `as_organization` (TEXT)
- `colo` (TEXT) - Cloudflare data center
- `http_protocol` (TEXT)
- `tls_version` (TEXT)
- `tls_cipher` (TEXT)

**Bot Detection (Enhanced)**:
- `client_trust_score` (INTEGER)
- `verified_bot` (INTEGER, DEFAULT 0)
- `js_detection_passed` (INTEGER, DEFAULT 0)
- `detection_ids` (TEXT) - JSON array

**Fingerprints (Enhanced)**:
- `ja3_hash` (TEXT) - TLS fingerprint
- `ja4` (TEXT) - Modern TLS fingerprint
- `ja4_signals` (TEXT) - JSON object

#### RPC Metadata (v2.5+, Migration 0008)
- `consumer` (TEXT) - RPC consumer identifier
- `flow` (TEXT) - Application flow context

#### Timestamps
- `timestamp` (DATETIME, DEFAULT CURRENT_TIMESTAMP, NOT NULL)

**Indexes** (24 total):
```sql
idx_validations_timestamp ON validations(timestamp)
idx_validations_decision ON validations(decision)
idx_validations_fingerprint ON validations(fingerprint_hash)
idx_validations_risk_score ON validations(risk_score)
idx_validations_country ON validations(country)
idx_validations_domain ON validations(domain)
idx_validations_experiment ON validations(experiment_id, variant) WHERE experiment_id IS NOT NULL
idx_validations_block_reason ON validations(block_reason) WHERE decision = 'block'
idx_validations_pattern_version ON validations(pattern_classification_version)
idx_validations_ensemble_reasoning ON validations(ensemble_reasoning) WHERE ensemble_reasoning IS NOT NULL
idx_validations_ood_detected ON validations(ood_detected, min_entropy) WHERE ood_detected = 1
idx_validations_abnormality_risk ON validations(abnormality_risk) WHERE abnormality_risk > 0
idx_validations_ood_zone ON validations(ood_zone) WHERE ood_zone IS NOT NULL
idx_validations_ood_zone_decision ON validations(ood_zone, decision, timestamp) WHERE ood_zone IS NOT NULL
idx_validations_region ON validations(region)
idx_validations_city ON validations(city)
idx_validations_colo ON validations(colo)
idx_validations_ja3_hash ON validations(ja3_hash)
idx_validations_ja4 ON validations(ja4)
idx_validations_verified_bot ON validations(verified_bot)
idx_validations_client_trust_score ON validations(client_trust_score)
idx_validations_consumer ON validations(consumer)
idx_validations_flow ON validations(flow)
idx_validations_consumer_flow ON validations(consumer, flow)
```

---

### 2. training_metrics

**Purpose**: Tracks model training pipeline events and performance

**Primary Key**: `id` (INTEGER AUTOINCREMENT)

**Columns**:
- `timestamp` (DATETIME, DEFAULT CURRENT_TIMESTAMP, NOT NULL)
- `event` (TEXT, NOT NULL) - CHECK: 'training_started', 'training_completed', 'training_failed', 'validation_passed', 'validation_failed', 'lock_acquired', 'lock_failed', 'anomaly_detected', 'candidate_created'
- `model_version` (TEXT)
- `trigger_type` (TEXT) - CHECK: 'scheduled', 'manual', 'online', NULL
- `fraud_count` (INTEGER)
- `legit_count` (INTEGER)
- `total_samples` (INTEGER)
- `training_duration` (REAL) - Seconds
- `accuracy` (REAL)
- `precision_metric` (REAL) - Renamed from 'precision' (SQLite reserved word)
- `recall` (REAL)
- `f1_score` (REAL)
- `false_positive_rate` (REAL)
- `anomaly_score` (REAL)
- `anomaly_type` (TEXT)
- `error_message` (TEXT)
- `error_type` (TEXT)

**Indexes** (3 total):
```sql
idx_training_timestamp ON training_metrics(timestamp)
idx_training_event ON training_metrics(event)
idx_training_model_version ON training_metrics(model_version)
```

---

### 3. ab_test_metrics

**Purpose**: Tracks A/B experiments and model promotion decisions

**Primary Key**: `id` (INTEGER AUTOINCREMENT)

**Columns**:
- `timestamp` (DATETIME, DEFAULT CURRENT_TIMESTAMP, NOT NULL)
- `event` (TEXT, NOT NULL) - CHECK: 'experiment_created', 'experiment_stopped', 'variant_assigned', 'promotion_evaluated', 'model_promoted', 'canary_rollback'
- `experiment_id` (TEXT)
- `variant` (TEXT) - CHECK: 'control', 'treatment', 'none', NULL
- `bucket` (INTEGER)
- `control_percent` (REAL)
- `treatment_percent` (REAL)
- `control_samples` (INTEGER)
- `treatment_samples` (INTEGER)
- `p_value` (REAL)
- `improvement` (REAL)
- `reason` (TEXT)
- `promotion_decision` (TEXT) - CHECK: 'promote', 'rollback', 'extend', 'none', NULL

**Indexes** (3 total):
```sql
idx_ab_test_timestamp ON ab_test_metrics(timestamp)
idx_ab_test_experiment ON ab_test_metrics(experiment_id)
idx_ab_test_event ON ab_test_metrics(event)
```

---

### 4. admin_metrics

**Purpose**: Tracks administrative actions and configuration changes

**Primary Key**: `id` (INTEGER AUTOINCREMENT)

**Columns**:
- `timestamp` (DATETIME, DEFAULT CURRENT_TIMESTAMP, NOT NULL)
- `event` (TEXT, NOT NULL) - CHECK: 'config_updated', 'weights_changed', 'feature_toggled', 'manual_training_triggered', 'model_deployed', 'whitelist_updated'
- `admin_hash` (TEXT) - Hashed admin identifier for privacy
- `config_key` (TEXT)
- `old_value` (TEXT)
- `new_value` (TEXT)
- `reason` (TEXT)
- `validation_passed` (INTEGER, DEFAULT 0)

**Indexes** (3 total):
```sql
idx_admin_timestamp ON admin_metrics(timestamp)
idx_admin_event ON admin_metrics(event)
idx_admin_config_key ON admin_metrics(config_key)
```

---

## Insert Operations

All insert operations are implemented in `src/database/metrics.ts` using prepared statements with parameter binding.

### 1. Write Validation Metric

**Function**: `writeValidationMetricToD1(db, metric)`
**File**: `src/database/metrics.ts:17`
**Table**: `validations`

```typescript
await db.prepare(`
  INSERT INTO validations (
    decision, risk_score, block_reason,
    email_local_part, domain, tld, fingerprint_hash,
    pattern_type, pattern_family,
    is_disposable, is_free_provider, has_plus_addressing,
    has_keyboard_walk, is_gibberish,  -- Deprecated fields (always 0), kept for schema compatibility
    entropy_score, bot_score, tld_risk_score,
    domain_reputation_score, pattern_confidence,
    markov_detected, markov_confidence,
    markov_cross_entropy_legit, markov_cross_entropy_fraud,
    ensemble_reasoning, model_2gram_prediction, model_3gram_prediction,
    min_entropy, abnormality_score, abnormality_risk, ood_detected,
    ood_zone,
    client_ip, user_agent, model_version,
    exclude_from_training, ip_reputation_score,
    experiment_id, variant, bucket,
    country, asn, latency,
    pattern_classification_version,
    region, city, postal_code, timezone, latitude, longitude, continent, is_eu_country,
    as_organization, colo, http_protocol, tls_version, tls_cipher,
    client_trust_score, verified_bot, js_detection_passed, detection_ids,
    ja3_hash, ja4, ja4_signals,
    consumer, flow
  ) VALUES (
    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
    ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20,
    ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30,
    ?31, ?32, ?33, ?34, ?35, ?36, ?37, ?38, ?39, ?40,
    ?41, ?42, ?43, ?44, ?45, ?46, ?47, ?48, ?49, ?50,
    ?51, ?52, ?53, ?54, ?55, ?56, ?57, ?58, ?59, ?60,
    ?61, ?62, ?63, ?64, ?65
  )
`).bind(...values).run();
```

**Parameters**: 65 bound parameters (see schema above)
**Error Handling**: Silent fail with logger.error()
**Called From**: `src/middleware/fraud-detection.ts` after each validation

---

### 2. Write Training Metric

**Function**: `writeTrainingMetricToD1(db, metric)`
**File**: `src/database/metrics.ts:186`
**Table**: `training_metrics`

```typescript
await db.prepare(`
  INSERT INTO training_metrics (
    event, model_version, trigger_type,
    fraud_count, legit_count, total_samples, training_duration,
    accuracy, precision_metric, recall, f1_score, false_positive_rate,
    anomaly_score, anomaly_type,
    error_message, error_type
  ) VALUES (
    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16
  )
`).bind(...values).run();
```

**Parameters**: 16 bound parameters
**Error Handling**: Logger.error()
**Called From**: `src/training/online-learning.ts` during training pipeline

---

### 3. Write A/B Test Metric

**Function**: `writeABTestMetricToD1(db, metric)`
**File**: `src/database/metrics.ts:251`
**Table**: `ab_test_metrics`

```typescript
await db.prepare(`
  INSERT INTO ab_test_metrics (
    event, experiment_id, variant, bucket,
    control_percent, treatment_percent,
    control_samples, treatment_samples,
    p_value, improvement,
    reason, promotion_decision
  ) VALUES (
    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12
  )
`).bind(...values).run();
```

**Parameters**: 12 bound parameters
**Error Handling**: Logger.error()
**Called From**: A/B testing middleware and admin endpoints

---

### 4. Write Admin Metric

**Function**: `writeAdminMetricToD1(db, metric)`
**File**: `src/database/metrics.ts:312`
**Table**: `admin_metrics`

```typescript
await db.prepare(`
  INSERT INTO admin_metrics (
    event, admin_hash, config_key,
    old_value, new_value,
    reason, validation_passed
  ) VALUES (
    ?1, ?2, ?3, ?4, ?5, ?6, ?7
  )
`).bind(...values).run();
```

**Parameters**: 7 bound parameters
**Error Handling**: Logger.error()
**Called From**: `src/routes/admin.ts` for config changes

---

## Query Operations

All query operations are implemented in `src/database/queries.ts`.

### Pre-built Analytics Queries

**File**: `src/database/queries.ts`
**Export**: `D1Queries` object

#### 1. Summary Query
```typescript
D1Queries.summary(hours: number)
```
Returns decision counts, risk buckets, average scores, grouped by hour.

#### 2. Block Reasons
```typescript
D1Queries.blockReasons(hours: number)
```
Top 20 block reasons with counts and average risk scores.

#### 3. Risk Distribution
```typescript
D1Queries.riskDistribution(hours: number)
```
Risk score buckets (very_low, low, medium, high, very_high).

#### 4. Top Countries
```typescript
D1Queries.topCountries(hours: number)
```
Top 20 countries by validation count.

#### 5. Performance Metrics
```typescript
D1Queries.performanceMetrics(hours: number)
```
Average, min, max latency by decision type.

#### 6. Bot Score Distribution
```typescript
D1Queries.botScoreDistribution(hours: number)
```
Bot categories (likely_human, uncertain, likely_bot).

#### 7. Hourly Timeline
```typescript
D1Queries.hourlyTimeline(hours: number)
```
Time-series data for dashboard charts.

#### 8. Top Fingerprints
```typescript
D1Queries.topFingerprints(hours: number)
```
Potential automation detection (>10 validations per fingerprint).

#### 9. High Risk Emails
```typescript
D1Queries.highRiskEmails(hours: number)
```
Last 100 emails with risk_score > 0.6.

#### 10. Disposable Domains
```typescript
D1Queries.disposableDomains(hours: number)
```
Top 20 disposable domains with block counts.

#### 11. Pattern Families
```typescript
D1Queries.patternFamilies(hours: number)
```
Pattern classification statistics (v2.1+ includes versioning).

#### 12. Markov Stats
```typescript
D1Queries.markovStats(hours: number)
```
Markov detection statistics with confidence levels.

#### 13. A/B Test Results
```typescript
D1Queries.abTestResults(experimentId: string, hours: number)
```
Compare control vs treatment performance.

---

### Query Execution Helpers

#### Execute D1 Query
```typescript
executeD1Query<T>(db: D1Database, query: string): Promise<T[]>
```

#### Execute D1 Query with Pagination
```typescript
executeD1QueryPaginated<T>(
  db: D1Database,
  query: string,
  limit: number = 100,
  offset: number = 0
): Promise<{ results: T[]; total: number }>
```

---

## Migrations

**Directory**: `migrations/`
**Format**: `000X_description.sql`

### Migration History

| Migration | Date | Description |
|-----------|------|-------------|
| 0001 | 2025-11-06 | Initial schema (base tables) |
| 0002 | - | Added pattern_classification_version |
| 0003 | - | Deprecated heuristic detectors (no schema changes) |
| 0004 | - | Added ensemble metadata (ensemble_reasoning, model predictions) |
| 0005 | - | Added OOD detection (min_entropy, abnormality metrics) |
| 0006 | - | Added OOD zone tracking (ood_zone column) |
| 0007 | - | Added enhanced request.cf metadata (65+ fields) |
| 0008 | 2025-11-21 | Added RPC metadata (consumer, flow columns and 3 indexes) |

### Apply Migrations

**For existing deployments with data**:
```bash
wrangler d1 migrations apply DB --remote
```

**For new deployments**:
```bash
wrangler d1 execute DB --file=./schema.sql --remote
```

---

## Database Management

### Remote Database Commands

#### Execute SQL File
```bash
wrangler d1 execute DB --file=./schema.sql --remote
```

#### Execute SQL Command
```bash
wrangler d1 execute DB --command="SELECT COUNT(*) FROM validations" --remote
```

#### Execute Multiple Commands
```bash
wrangler d1 execute DB --file=./migrations/0001_create_initial_schema.sql --remote
```

#### Apply All Migrations
```bash
wrangler d1 migrations apply DB --remote
```

#### Apply Specific Migration
```bash
wrangler d1 migrations apply DB --remote --migration 0008
```

---

### Drop All Tables (Nuke Operation)

**WARNING**: This is destructive and irreversible!

```bash
# Drop all 4 tables
wrangler d1 execute DB --remote --command="DROP TABLE IF EXISTS validations"
wrangler d1 execute DB --remote --command="DROP TABLE IF EXISTS training_metrics"
wrangler d1 execute DB --remote --command="DROP TABLE IF EXISTS ab_test_metrics"
wrangler d1 execute DB --remote --command="DROP TABLE IF EXISTS admin_metrics"
```

**Or use a single SQL file**:
```bash
# Create drop_all.sql
echo "DROP TABLE IF EXISTS validations;
DROP TABLE IF EXISTS training_metrics;
DROP TABLE IF EXISTS ab_test_metrics;
DROP TABLE IF EXISTS admin_metrics;" > drop_all.sql

wrangler d1 execute DB --file=./drop_all.sql --remote
```

---

### Reset Database (Nuke + Recreate)

**Sequential approach**:
```bash
# Step 1: Drop all tables
wrangler d1 execute DB --remote --command="DROP TABLE IF EXISTS validations"
wrangler d1 execute DB --remote --command="DROP TABLE IF EXISTS training_metrics"
wrangler d1 execute DB --remote --command="DROP TABLE IF EXISTS ab_test_metrics"
wrangler d1 execute DB --remote --command="DROP TABLE IF EXISTS admin_metrics"

# Step 2: Recreate schema (autoincrement starts at 1)
wrangler d1 execute DB --file=./schema.sql --remote
```

**One-liner approach** (recommended):
```bash
wrangler d1 execute DB --command="DROP TABLE IF EXISTS validations; DROP TABLE IF EXISTS training_metrics; DROP TABLE IF EXISTS ab_test_metrics; DROP TABLE IF EXISTS admin_metrics; DELETE FROM sqlite_sequence;" --remote && wrangler d1 execute DB --file=./schema.sql --remote
```

This resets all autoincrement counters to start at 1. The `DELETE FROM sqlite_sequence;` ensures all sequence counters are cleared.

---

## CLI Commands

### Analytics CLI Commands

**File**: `cli/commands/data/analytics.ts`

#### Query D1 via Admin API
```bash
npm run cli analytics:query "SELECT COUNT(*) FROM validations WHERE decision = 'block'"
npm run cli analytics:query "SELECT * FROM validations LIMIT 10" --format table
npm run cli analytics:query "SELECT decision, COUNT(*) FROM validations GROUP BY decision" --hours 24
```

**Options**:
- `--hours <n>` - Filter last N hours (adds WHERE timestamp >= ...)
- `--format <json|table>` - Output format (default: json)
- `--url <base>` - Base URL (default: https://fraud.erfi.dev)
- `--api-key <key>` - Admin API key (or use FRAUD_API_KEY env var)

#### Show Analytics Statistics
```bash
npm run cli analytics:stats
npm run cli analytics:stats --last 24
```

Shows summary statistics including:
- Total validations by decision
- Top block reasons
- Risk score distribution
- Geographic distribution
- Performance metrics

---

### Training Data Extraction

**File**: `cli/commands/training/extract.ts`

#### Extract Training Data from D1
```bash
npm run cli training:extract --days 7 --min-confidence 0.8 --remote
```

Extracts high-confidence validations for model retraining.

**Options**:
- `--days <n>` - Extract last N days (default: 7)
- `--min-confidence <n>` - Min Markov confidence (default: 0.8)
- `--remote` - Use remote D1 (required for production data)

---

## Indexes

### Index Strategy

- **Temporal queries**: `idx_validations_timestamp`
- **Decision filtering**: `idx_validations_decision`
- **Deduplication**: `idx_validations_fingerprint`
- **Risk analysis**: `idx_validations_risk_score`
- **Geographic**: `idx_validations_country`, `idx_validations_region`, `idx_validations_city`
- **A/B testing**: `idx_validations_experiment` (partial, WHERE experiment_id IS NOT NULL)
- **Fraud analysis**: `idx_validations_block_reason` (partial, WHERE decision = 'block')
- **Algorithm versioning**: `idx_validations_pattern_version`
- **OOD detection**: `idx_validations_ood_detected`, `idx_validations_ood_zone`
- **Network forensics**: `idx_validations_colo`, `idx_validations_ja3_hash`, `idx_validations_ja4`
- **Bot detection**: `idx_validations_verified_bot`, `idx_validations_client_trust_score`
- **RPC tracking**: `idx_validations_consumer`, `idx_validations_flow`, `idx_validations_consumer_flow`

### Index Maintenance

D1 (SQLite) automatically maintains indexes. No manual REINDEX required.

---

## Performance Considerations

### Write Performance
- All inserts use prepared statements with parameter binding
- Silent failure on write errors (non-blocking)
- No transactions (each insert is atomic)

### Read Performance
- All common queries have covering indexes
- Partial indexes for filtered queries (WHERE clauses)
- Time-based queries use `idx_validations_timestamp`

### Storage
- Typical row size: ~1-2 KB per validation
- 1M validations ≈ 1-2 GB storage
- D1 limit: 10 GB per database (Workers Paid plan)

---

## Backup & Recovery

### Export Data (Backup)
```bash
# Export all validations
npm run cli analytics:query "SELECT * FROM validations" > backup_validations.json

# Export specific time range
npm run cli analytics:query "SELECT * FROM validations WHERE timestamp >= '2025-11-01'" > backup_nov.json
```

### Import Data (Recovery)
D1 does not support bulk import via wrangler. Options:
1. Use Worker with batch inserts via RPC
2. Use D1 HTTP API with pagination
3. Restore from snapshot (if available via Cloudflare dashboard)

---

## Troubleshooting

### Common Issues

#### 1. "No such table" error
**Cause**: Schema not initialized
**Fix**: `wrangler d1 execute DB --file=./schema.sql --remote`

#### 2. "Column not found" error
**Cause**: Schema out of sync (old migration not applied)
**Fix**: `wrangler d1 migrations apply DB --remote`

#### 3. "Database locked" error
**Cause**: Concurrent writes (rare on D1)
**Fix**: Retry with exponential backoff (already implemented in write functions)

#### 4. High latency on queries
**Cause**: Missing index or large result set
**Fix**: Add LIMIT clause, verify indexes with EXPLAIN QUERY PLAN

---

## Related Files

- **Schema**: `schema.sql` (consolidated)
- **Migrations**: `migrations/*.sql` (incremental)
- **Metrics Writers**: `src/database/metrics.ts`
- **Query Helpers**: `src/database/queries.ts`
- **Admin API**: `src/routes/admin.ts`
- **CLI Analytics**: `cli/commands/data/analytics.ts`
- **Wrangler Config**: `wrangler.jsonc` (d1_databases binding)

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 2.5.1 | 2025-11-27 | Updated schema.sql to include migration 0008 (RPC metadata) |
| 2.5.0 | 2025-11-21 | Added RPC metadata (migration 0008: consumer, flow) |
| 2.5.0 | 2025-11-17 | Added enhanced request.cf metadata (migration 0007) |
| 2.4.1 | - | Added OOD zone tracking (migration 0006) |
| 2.4.0 | - | Added OOD detection (migration 0005) |
| 2.3.0 | - | Added ensemble metadata (migration 0004) |
| 2.2.0 | - | Deprecated heuristic detectors (migration 0003) |
| 2.1.0 | - | Added pattern versioning (migration 0002) |
| 2.0.0 | 2025-11-06 | Initial D1 migration from Analytics Engine (migration 0001) |

---

## Contact & Support

- **Documentation**: See `CLAUDE.md` in project root
- **Issues**: Track in GitHub repository
- **Cloudflare D1 Docs**: https://developers.cloudflare.com/d1/

---

**Last Updated**: 2025-11-27
**Maintained By**: Erfi Anugrah
**Project**: Markov Mail Email Fraud Detection
