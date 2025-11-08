# Analytics Dashboard & Queries

Real-time analytics powered by Cloudflare D1 Database.

## Overview

The fraud detection worker tracks all validations and stores structured metrics in a D1 SQLite database. This enables powerful insights into:
- Decision patterns (allow/warn/block)
- Block reasons and trends
- Geographic distribution
- Performance metrics
- Risk score distributions
- Fingerprint activity
- Training pipeline metrics
- A/B test experiments

## Database Backend

The fraud detection worker uses **Cloudflare D1** (SQLite) for analytics storage:
- **Named columns** for clarity and ease of querying
- **Full SQL support** (JOINs, subqueries, CTEs)
- **Mutable data** (can DELETE test data and old records)
- **Strong typing** (INTEGER 0/1, proper datetime columns)
- **17 indexes** for query performance
- **Multiple tables** (validations, training_metrics, ab_test_metrics, admin_metrics)

## Quick Start

### Using the Web Dashboard

1. **Deploy your worker** with D1 database configured
2. **Access the dashboard** at `https://your-worker.dev/dashboard/`
3. **Enter your Admin API key** (from `ADMIN_API_KEY` secret)
4. **View real-time analytics** with interactive charts

### Using the API

```bash
# Get default summary (last 24 hours)
curl https://your-worker.dev/admin/analytics?type=summary \
  -H "X-API-Key: your-admin-api-key"

# Get data for last 7 days
curl https://your-worker.dev/admin/analytics?type=summary&hours=168 \
  -H "X-API-Key: your-admin-api-key"

# Get list of pre-built queries
curl https://your-worker.dev/admin/analytics/queries \
  -H "X-API-Key: your-admin-api-key"

# Run custom SQL query (use POST to avoid Cloudflare WAF)
curl -X POST https://your-worker.dev/admin/analytics \
  -H "X-API-Key: your-admin-api-key" \
  -H "Content-Type: application/json" \
  -d '{"query":"SELECT decision, COUNT(*) FROM validations WHERE timestamp >= datetime('\''now'\'', '\''-24 hours'\'') GROUP BY decision","hours":24}'
```

## Database Schema

### Tables

The D1 database contains 4 tables:

1. **validations** - Email validation events (primary metrics)
2. **training_metrics** - Model training pipeline events
3. **ab_test_metrics** - A/B experiment tracking
4. **admin_metrics** - Configuration changes and admin actions

### Validations Table

Primary table storing all email validation events.

| Column | Type | Description | Example |
|--------|------|-------------|---------|
| `id` | INTEGER | Auto-increment primary key | 1, 2, 3... |
| `timestamp` | DATETIME | Event timestamp (UTC) | 2025-11-06 10:30:45 |
| `decision` | TEXT | Validation decision | allow, warn, block |
| `risk_score` | REAL | Overall risk score (0-1) | 0.85 |
| `block_reason` | TEXT | Why blocked (if applicable) | sequential_pattern |
| `email_local_part` | TEXT | Email username | test123 |
| `domain` | TEXT | Email domain | example.com |
| `tld` | TEXT | Top-level domain | com |
| `fingerprint_hash` | TEXT | Device fingerprint (SHA-256) | d3f639f8... |
| `pattern_type` | TEXT | Detected pattern | sequential, dated |
| `pattern_family` | TEXT | Pattern family | SHORT.NUM@domain.com |
| `is_disposable` | INTEGER | Is disposable email? (0/1) | 0, 1 |
| `is_free_provider` | INTEGER | Is free provider? (0/1) | 0, 1 |
| `has_plus_addressing` | INTEGER | Has + addressing? (0/1) | 0, 1 |
| `has_keyboard_walk` | INTEGER | Keyboard walk detected (0/1) - Always 0 | 0 |
| `is_gibberish` | INTEGER | Gibberish detected (0/1) - Always 0 | 0 |
| `entropy_score` | REAL | Text entropy (0-1) | 0.42 |
| `bot_score` | REAL | Bot detection score | 0-99 |
| `tld_risk_score` | REAL | TLD risk score | 0.29 |
| `domain_reputation_score` | REAL | Domain reputation | 0-1 |
| `pattern_confidence` | REAL | Pattern detection confidence | 0.85 |
| `markov_detected` | INTEGER | Markov chain detected? (0/1) | 0, 1 |
| `markov_confidence` | REAL | Markov confidence | 0.9 |
| `markov_cross_entropy_legit` | REAL | Cross-entropy (legit model) | 3.71 |
| `markov_cross_entropy_fraud` | REAL | Cross-entropy (fraud model) | 1.60 |
| `client_ip` | TEXT | Client IP address | 192.168.1.1 |
| `user_agent` | TEXT | User agent string | Mozilla/5.0... |
| `model_version` | TEXT | ML model version | trained_111525 |
| `exclude_from_training` | INTEGER | Exclude from training? (0/1) | 0, 1 |
| `ip_reputation_score` | REAL | IP reputation score | 0-100 |
| `experiment_id` | TEXT | A/B experiment ID | exp_001 |
| `variant` | TEXT | A/B variant | control, treatment |
| `bucket` | INTEGER | A/B test bucket (0-99) | 42 |
| `country` | TEXT | Country code (ISO 3166-1) | US, GB, NL |
| `asn` | INTEGER | Autonomous System Number | 13335 |
| `latency` | REAL | Processing latency (ms) | 1.5 |

**Indexes:**
- `idx_validations_timestamp` - Fast time-range queries
- `idx_validations_decision` - Group by decision
- `idx_validations_fingerprint` - Fingerprint lookups
- `idx_validations_risk_score` - Risk score filters
- `idx_validations_country` - Geographic queries
- `idx_validations_domain` - Domain analysis
- `idx_validations_experiment` - A/B test queries
- `idx_validations_block_reason` - Block reason analysis

## Pre-built Queries

### 1. Decision Summary

Overview of allow/warn/block decisions with risk scores and latency.

```sql
SELECT
  decision,
  block_reason,
  CASE
    WHEN risk_score < 0.2 THEN 'very_low'
    WHEN risk_score < 0.4 THEN 'low'
    WHEN risk_score < 0.6 THEN 'medium'
    WHEN risk_score < 0.8 THEN 'high'
    ELSE 'very_high'
  END as risk_bucket,
  COUNT(*) as count,
  AVG(risk_score) as avg_risk_score,
  AVG(entropy_score) as avg_entropy_score,
  AVG(bot_score) as avg_bot_score,
  AVG(latency) as avg_latency_ms,
  strftime('%Y-%m-%d %H:00:00', timestamp) as hour
FROM validations
WHERE timestamp >= datetime('now', '-24 hours')
GROUP BY decision, block_reason, risk_bucket, hour
ORDER BY hour DESC, count DESC
```

**API Usage:**
```bash
curl https://your-worker.dev/admin/analytics?type=summary&hours=24 \
  -H "X-API-Key: your-key"
```

---

### 2. Block Reasons

Most common reasons for blocking emails.

```sql
SELECT
  block_reason,
  COUNT(*) as count,
  AVG(risk_score) as avg_risk_score,
  AVG(markov_confidence) as avg_markov_confidence
FROM validations
WHERE timestamp >= datetime('now', '-24 hours')
  AND decision = 'block'
  AND block_reason IS NOT NULL
GROUP BY block_reason
ORDER BY count DESC
```

**API Usage:**
```bash
curl https://your-worker.dev/admin/analytics?type=blockReasons&hours=24 \
  -H "X-API-Key: your-key"
```

---

### 3. Risk Score Distribution

Distribution of emails by risk level.

```sql
SELECT
  CASE
    WHEN risk_score < 0.2 THEN 'very_low (0.0-0.2)'
    WHEN risk_score < 0.4 THEN 'low (0.2-0.4)'
    WHEN risk_score < 0.6 THEN 'medium (0.4-0.6)'
    WHEN risk_score < 0.8 THEN 'high (0.6-0.8)'
    ELSE 'very_high (0.8-1.0)'
  END as risk_bucket,
  decision,
  COUNT(*) as count,
  AVG(risk_score) as avg_risk_score
FROM validations
WHERE timestamp >= datetime('now', '-24 hours')
GROUP BY risk_bucket, decision
ORDER BY risk_bucket, decision
```

**API Usage:**
```bash
curl https://your-worker.dev/admin/analytics?type=riskDistribution&hours=24 \
  -H "X-API-Key: your-key"
```

---

### 4. Top Countries

Validations by country and decision.

```sql
SELECT
  country,
  decision,
  COUNT(*) as count,
  AVG(risk_score) as avg_risk_score,
  AVG(latency) as avg_latency_ms
FROM validations
WHERE timestamp >= datetime('now', '-24 hours')
  AND country IS NOT NULL
GROUP BY country, decision
ORDER BY count DESC
LIMIT 20
```

**API Usage:**
```bash
curl https://your-worker.dev/admin/analytics?type=topCountries&hours=24 \
  -H "X-API-Key: your-key"
```

---

### 5. High Risk Emails

Recent high-risk validations for investigation.

```sql
SELECT
  timestamp,
  email_local_part,
  domain,
  decision,
  risk_score,
  block_reason,
  pattern_type,
  pattern_family,
  is_disposable,
  markov_detected,
  markov_confidence,
  country,
  fingerprint_hash
FROM validations
WHERE timestamp >= datetime('now', '-24 hours')
  AND risk_score > 0.6
ORDER BY timestamp DESC
LIMIT 100
```

**API Usage:**
```bash
curl https://your-worker.dev/admin/analytics?type=highRisk&hours=24 \
  -H "X-API-Key: your-key"
```

---

### 6. Performance Metrics

Latency statistics by decision type.

```sql
SELECT
  decision,
  COUNT(*) as count,
  AVG(latency) as avg_latency_ms,
  MIN(latency) as min_latency_ms,
  MAX(latency) as max_latency_ms
FROM validations
WHERE timestamp >= datetime('now', '-24 hours')
GROUP BY decision
ORDER BY avg_latency_ms DESC
```

**API Usage:**
```bash
curl https://your-worker.dev/admin/analytics?type=performance&hours=24 \
  -H "X-API-Key: your-key"
```

---

### 7. Hourly Timeline

Validations over time by decision.

```sql
SELECT
  strftime('%Y-%m-%d %H:00:00', timestamp) as hour,
  decision,
  COUNT(*) as count,
  AVG(risk_score) as avg_risk_score,
  AVG(latency) as avg_latency_ms
FROM validations
WHERE timestamp >= datetime('now', '-24 hours')
GROUP BY hour, decision
ORDER BY hour DESC
```

**API Usage:**
```bash
curl https://your-worker.dev/admin/analytics?type=timeline&hours=24 \
  -H "X-API-Key: your-key"
```

---

### 8. Top Fingerprints

Most active fingerprints (potential automation).

```sql
SELECT
  fingerprint_hash,
  COUNT(*) as count,
  AVG(risk_score) as avg_risk_score,
  AVG(bot_score) as avg_bot_score,
  MAX(country) as country,
  MAX(asn) as asn
FROM validations
WHERE timestamp >= datetime('now', '-24 hours')
GROUP BY fingerprint_hash
HAVING count > 5
ORDER BY count DESC
LIMIT 20
```

**API Usage:**
```bash
curl https://your-worker.dev/admin/analytics?type=fingerprints&hours=24 \
  -H "X-API-Key: your-key"
```

---

## Custom Queries

You can run custom SQL queries with security validation.

### Query Syntax

D1 uses SQLite syntax with full SQL support:

**Supported:**
- `SELECT`, `FROM`, `WHERE`, `GROUP BY`, `ORDER BY`, `HAVING`, `LIMIT`
- Aggregations: `COUNT()`, `SUM()`, `AVG()`, `MIN()`, `MAX()`
- String functions: `LIKE`, `UPPER()`, `LOWER()`, `LENGTH()`, `SUBSTR()`
- Date functions: `datetime()`, `strftime()`, `date()`, `time()`
- Math functions: `ROUND()`, `ABS()`, `CAST()`
- Window functions: `ROW_NUMBER()`, `RANK()`, `LAG()`, `LEAD()`
- CTEs (Common Table Expressions): `WITH cte AS (...)`
- Subqueries
- JOINs (if querying multiple tables)

**Security Restrictions:**
- Only `SELECT` statements allowed (no INSERT/UPDATE/DELETE/DROP)
- Must query from allowed tables: validations, training_metrics, ab_test_metrics, admin_metrics
- No multi-statement queries (no semicolons)
- No SQL comments (`--` or `/*`)

### Example Custom Queries

#### Find emails from specific ASN

```sql
SELECT
  email_local_part,
  domain,
  decision,
  risk_score,
  asn,
  timestamp
FROM validations
WHERE asn = 13335  -- Cloudflare
  AND timestamp >= datetime('now', '-24 hours')
ORDER BY timestamp DESC
LIMIT 100
```

#### Detect bot activity (low bot scores)

```sql
SELECT
  fingerprint_hash,
  country,
  COUNT(*) as count,
  AVG(bot_score) as avg_bot_score,
  AVG(risk_score) as avg_risk_score
FROM validations
WHERE timestamp >= datetime('now', '-24 hours')
  AND bot_score < 30  -- Bot score < 30
GROUP BY fingerprint_hash, country
HAVING count > 5
ORDER BY count DESC
LIMIT 20
```

#### High entropy emails (potential gibberish)

> **Note**: `is_gibberish` field is always 0. Use `entropy_score` and Markov detection for gibberish detection.

```sql
SELECT
  email_local_part,
  domain,
  decision,
  entropy_score,
  risk_score,
  markov_detected,
  markov_confidence
FROM validations
WHERE timestamp >= datetime('now', '-24 hours')
  AND entropy_score > 0.7
ORDER BY entropy_score DESC
LIMIT 50
```

#### Hourly block rate

```sql
SELECT
  strftime('%Y-%m-%d %H:00:00', timestamp) as hour,
  COUNT(*) as total_validations,
  SUM(CASE WHEN decision = 'block' THEN 1 ELSE 0 END) as blocks,
  ROUND(100.0 * blocks / total_validations, 2) as block_rate_percent
FROM validations
WHERE timestamp >= datetime('now', '-7 days')
GROUP BY hour
ORDER BY hour DESC
```

#### Pattern family analysis

```sql
SELECT
  pattern_family,
  pattern_type,
  decision,
  COUNT(*) as count,
  AVG(risk_score) as avg_risk_score,
  AVG(pattern_confidence) as avg_confidence
FROM validations
WHERE timestamp >= datetime('now', '-24 hours')
  AND pattern_family IS NOT NULL
GROUP BY pattern_family, pattern_type, decision
ORDER BY count DESC
LIMIT 50
```

#### Markov chain detection effectiveness

```sql
SELECT
  markov_detected,
  decision,
  COUNT(*) as count,
  AVG(markov_confidence) as avg_confidence,
  AVG(markov_cross_entropy_legit) as avg_entropy_legit,
  AVG(markov_cross_entropy_fraud) as avg_entropy_fraud,
  AVG(risk_score) as avg_risk_score
FROM validations
WHERE timestamp >= datetime('now', '-24 hours')
  AND markov_detected = 1
GROUP BY markov_detected, decision
ORDER BY count DESC
```

---

## Data Management

### Delete Old Data

D1 is mutable, so you can delete old data to optimize database size:

```bash
# Delete data older than 90 days
curl -X POST https://your-worker.dev/admin/analytics/truncate?hours=2160 \
  -H "X-API-Key: your-key"
```

This executes:
```sql
DELETE FROM validations
WHERE timestamp < datetime('now', '-90 days')
```

### Delete Test Data

Remove test emails and validation data:

```bash
curl -X DELETE https://your-worker.dev/admin/analytics/test-data \
  -H "X-API-Key: your-key"
```

This executes:
```sql
DELETE FROM validations
WHERE email_local_part LIKE 'user%'
   OR email_local_part LIKE 'test%'
   OR domain IN ('example.com', 'test.com')
   OR (pattern_type IS NULL AND risk_score < 0.6)
```

### Export Data

Use custom queries to export specific data:

```bash
# Export last 7 days to JSON
curl -G https://your-worker.dev/admin/analytics \
  --data-urlencode "query=SELECT * FROM validations WHERE timestamp >= datetime('now', '-7 days')" \
  -H "X-API-Key: your-key" > export.json
```

Or use wrangler D1 directly:

```bash
npx wrangler d1 execute ANALYTICS --remote \
  --command="SELECT * FROM validations WHERE timestamp >= datetime('now', '-7 days')" \
  --output=export.json
```

---

## Integration with Monitoring Tools

### Grafana

Use the [Cloudflare D1 data source plugin](https://grafana.com/grafana/plugins/) for Grafana:

1. Install the Cloudflare plugin
2. Configure with your Cloudflare API token
3. Select the `ANALYTICS` D1 database
4. Use the SQL queries from this document

### Prometheus

Export metrics using a custom script:

```javascript
// Fetch analytics via API
const response = await fetch('https://your-worker.dev/admin/analytics?type=summary', {
  headers: { 'X-API-Key': process.env.ADMIN_API_KEY }
});
const data = await response.json();

// Convert to Prometheus format
console.log(`# HELP fraud_validations_total Total email validations`);
console.log(`# TYPE fraud_validations_total counter`);
data.data.forEach(row => {
  console.log(`fraud_validations_total{decision="${row.decision}",block_reason="${row.block_reason}"} ${row.count}`);
});
```

### Custom Dashboards

Use the `/admin/analytics` API endpoint to build custom dashboards:

```html
<script>
async function loadAnalytics() {
  const response = await fetch('/admin/analytics?type=summary&hours=24', {
    headers: { 'X-API-Key': localStorage.getItem('apiKey') }
  });
  const data = await response.json();
  // Render charts, tables, etc.
  renderCharts(data.data);
}
</script>
```

---

## Best Practices

### 1. Use Appropriate Time Ranges

- **Real-time monitoring**: Last 1-6 hours
- **Daily reports**: Last 24 hours
- **Weekly trends**: Last 7 days (168 hours)
- **Monthly analysis**: Last 30 days (720 hours)

### 2. Optimize Queries

- **Use indexes**: Queries on timestamp, decision, fingerprint_hash, country, domain are fast
- **Limit results**: Always use `LIMIT` for large result sets
- **Aggregate when possible**: Use `GROUP BY` instead of fetching raw rows
- **Use time filters**: Always filter by timestamp for performance

### 3. Monitor Key Metrics

Essential metrics to track:
- **Block rate**: `blocks / total_validations` (should be 1-10%)
- **Average risk score**: Trending up = more attacks
- **P95 latency**: Should stay under 5ms
- **Top block reasons**: Identify attack patterns
- **Geographic distribution**: Unusual countries?

### 4. Set Up Alerts

Create alerts for:
- Block rate > 10% (unusual activity)
- P95 latency > 10ms (performance degradation)
- Specific fingerprint > 100 validations/hour (bot)
- Blocks from unexpected countries
- Sudden spike in specific block reason

### 5. Regular Maintenance

- **Archive old data**: Delete records older than 90 days
- **Clean test data**: Remove test emails regularly
- **Monitor database size**: D1 has storage limits
- **Review indexes**: Add indexes for frequently queried columns

---

## Troubleshooting

### "D1 database not configured"

**Solution:** Ensure D1 binding is configured in `wrangler.jsonc`:

```jsonc
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "ANALYTICS",
      "database_id": "your-database-id"
    }
  ]
}
```

### No data showing up

**Possible causes:**
1. D1 database not created
2. No validations have occurred yet
3. Time range is too narrow
4. Database binding is missing

**Solution:** Check D1 database exists and has data:

```bash
npx wrangler d1 execute ANALYTICS --remote \
  --command="SELECT COUNT(*) FROM validations"
```

### Query timeout or slow

**Solution:**
- Reduce time range
- Add more specific WHERE filters
- Use indexed columns (timestamp, decision, country, domain, fingerprint_hash)
- Limit result size with `LIMIT`

### "Invalid SQL query" error

**Solution:** Check that your query:
- Starts with `SELECT`
- Queries from allowed tables (validations, training_metrics, ab_test_metrics, admin_metrics)
- Has no semicolons (no multi-statement)
- Has no SQL comments (`--` or `/*`)
- Doesn't use dangerous keywords (DROP, DELETE, UPDATE, INSERT)

---

## API Reference

### GET /admin/analytics

Query D1 database with analytics data.

**Query Parameters:**
- `type` (optional): Predefined query type (summary, blockReasons, etc.)
- `query` (optional): Custom SQL query (validated for security)
- `hours` (optional): Number of hours to look back (default: 24)

**Headers:**
- `X-API-Key`: Your Admin API key (required)

**Response:**
```json
{
  "success": true,
  "mode": "predefined" | "custom",
  "query": "SELECT...",
  "hours": 24,
  "data": [...]
}
```

### GET /admin/analytics/queries

Get list of pre-built queries.

**Headers:**
- `X-API-Key`: Your Admin API key (required)

**Response:**
```json
{
  "queries": {
    "summary": {
      "name": "Decision Summary",
      "description": "Overview of allow/warn/block decisions",
      "sql": "SELECT..."
    },
    ...
  }
}
```

### GET /admin/analytics/info

Get D1 database information and data management options.

**Headers:**
- `X-API-Key`: Your Admin API key (required)

**Response:**
```json
{
  "database": "ANALYTICS (D1)",
  "dataRetention": {
    "description": "D1 database stores data indefinitely",
    "manualDeletion": "DELETE FROM validations WHERE...",
    "backups": "D1 supports point-in-time recovery"
  },
  "dataManagement": {...},
  "bestPractices": [...]
}
```

### POST /admin/analytics/truncate

Delete old data from D1 database.

**Query Parameters:**
- `hours` (optional): Delete data older than N hours (default: 2160 = 90 days)

**Headers:**
- `X-API-Key`: Your Admin API key (required)

**Response:**
```json
{
  "success": true,
  "message": "Deleted data older than 2160 hours",
  "deletedRows": 1234
}
```

### DELETE /admin/analytics/test-data

Delete test data from validations table.

**Headers:**
- `X-API-Key`: Your Admin API key (required)

**Response:**
```json
{
  "success": true,
  "message": "Deleted test data",
  "deletedRows": 42
}
```

---

## Related Documentation

- [Configuration Guide](CONFIGURATION.md) - Configure analytics settings
- [API Reference](API.md) - All API endpoints
- [Getting Started](GETTING_STARTED.md) - Initial setup
- [Training Pipeline](TRAINING.md) - Model training with D1 data

---

**Last Updated:** 2025-11-06
**Database:** Cloudflare D1 (SQLite)
**Dashboard Location:** `/dashboard/`
**API Endpoints:** `/admin/analytics`, `/admin/analytics/queries`, `/admin/analytics/info`
