/**
 * D1 Query Helpers
 * Pre-built queries for common analytics operations
 */

/**
 * Common D1 queries for analytics dashboard
 * These replace the Analytics Engine queries with proper SQLite syntax
 */
export const D1Queries = {
  /**
   * Summary: Overview of allow/warn/block decisions
   */
  summary: (hours: number) => `
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
    WHERE timestamp >= datetime('now', '-${hours} hours')
    GROUP BY decision, block_reason, risk_bucket, hour
    ORDER BY hour DESC, count DESC
  `,

  /**
   * Top block reasons in the last N hours
   * v2.1: Now groups by pattern_classification_version to separate old/new data
   */
  blockReasons: (hours: number) => `
    SELECT
      block_reason,
      pattern_classification_version,
      COUNT(*) as count,
      AVG(risk_score) as avg_risk_score
    FROM validations
    WHERE timestamp >= datetime('now', '-${hours} hours')
      AND decision = 'block'
      AND block_reason IS NOT NULL
    GROUP BY block_reason, pattern_classification_version
    ORDER BY count DESC
    LIMIT 20
  `,

  /**
   * Risk score distribution
   */
  riskDistribution: (hours: number) => `
    SELECT
      CASE
        WHEN risk_score < 0.2 THEN 'very_low'
        WHEN risk_score < 0.4 THEN 'low'
        WHEN risk_score < 0.6 THEN 'medium'
        WHEN risk_score < 0.8 THEN 'high'
        ELSE 'very_high'
      END as risk_bucket,
      COUNT(*) as count,
      AVG(risk_score) as avg_risk_score
    FROM validations
    WHERE timestamp >= datetime('now', '-${hours} hours')
    GROUP BY risk_bucket
    ORDER BY avg_risk_score ASC
  `,

  /**
   * Top countries by validation count
   */
  topCountries: (hours: number) => `
    SELECT
      country,
      COUNT(*) as count,
      AVG(risk_score) as avg_risk_score
    FROM validations
    WHERE timestamp >= datetime('now', '-${hours} hours')
      AND country IS NOT NULL
    GROUP BY country
    ORDER BY count DESC
    LIMIT 20
  `,

  /**
   * Performance metrics
   */
  performanceMetrics: (hours: number) => `
    SELECT
      decision,
      COUNT(*) as count,
      AVG(latency) as avg_latency_ms,
      MIN(latency) as min_latency_ms,
      MAX(latency) as max_latency_ms
    FROM validations
    WHERE timestamp >= datetime('now', '-${hours} hours')
    GROUP BY decision
  `,

  /**
   * Bot score distribution
   */
  botScoreDistribution: (hours: number) => `
    SELECT
      CASE
        WHEN bot_score >= 80 THEN 'likely_human'
        WHEN bot_score >= 40 THEN 'uncertain'
        ELSE 'likely_bot'
      END as bot_category,
      COUNT(*) as count,
      AVG(risk_score) as avg_risk_score
    FROM validations
    WHERE timestamp >= datetime('now', '-${hours} hours')
      AND bot_score IS NOT NULL
    GROUP BY bot_category
  `,

  /**
   * Hourly timeline
   */
  hourlyTimeline: (hours: number) => `
    SELECT
      strftime('%Y-%m-%d %H:00:00', timestamp) as hour,
      decision,
      COUNT(*) as count,
      AVG(risk_score) as avg_risk_score
    FROM validations
    WHERE timestamp >= datetime('now', '-${hours} hours')
    GROUP BY hour, decision
    ORDER BY hour DESC
  `,

  /**
   * Top fingerprints (potential automation)
   */
  topFingerprints: (hours: number) => `
    SELECT
      fingerprint_hash,
      COUNT(*) as validation_count,
      AVG(risk_score) as avg_risk_score,
      country
    FROM validations
    WHERE timestamp >= datetime('now', '-${hours} hours')
    GROUP BY fingerprint_hash, country
    HAVING validation_count > 10
    ORDER BY validation_count DESC
    LIMIT 20
  `,

  /**
   * High risk emails (risk score > 0.6)
   */
  highRiskEmails: (hours: number) => `
    SELECT
      decision,
      block_reason,
      country,
      risk_score,
      entropy_score,
      timestamp
    FROM validations
    WHERE timestamp >= datetime('now', '-${hours} hours')
      AND risk_score > 0.6
    ORDER BY timestamp DESC
    LIMIT 100
  `,

  /**
   * Disposable domain statistics
   */
  disposableDomains: (hours: number) => `
    SELECT
      domain,
      COUNT(*) as count,
      AVG(risk_score) as avg_risk_score,
      SUM(CASE WHEN decision = 'block' THEN 1 ELSE 0 END) as blocks
    FROM validations
    WHERE timestamp >= datetime('now', '-${hours} hours')
      AND is_disposable = 1
      AND domain IS NOT NULL
    GROUP BY domain
    ORDER BY count DESC
    LIMIT 20
  `,

  /**
   * Pattern family analysis
   * v2.1: Now includes pattern_classification_version to separate old/new classifications
   */
  patternFamilies: (hours: number) => `
    SELECT
      pattern_family,
      pattern_type,
      pattern_classification_version,
      COUNT(*) as count,
      AVG(risk_score) as avg_risk_score,
      SUM(CASE WHEN decision = 'block' THEN 1 ELSE 0 END) as blocks
    FROM validations
    WHERE timestamp >= datetime('now', '-${hours} hours')
      AND pattern_family IS NOT NULL
    GROUP BY pattern_family, pattern_type, pattern_classification_version
    ORDER BY count DESC
    LIMIT 20
  `,

  /**
   * Markov detection statistics
   */
  markovStats: (hours: number) => `
    SELECT
      markov_detected,
      decision,
      COUNT(*) as count,
      AVG(markov_confidence) as avg_confidence,
      AVG(risk_score) as avg_risk_score
    FROM validations
    WHERE timestamp >= datetime('now', '-${hours} hours')
      AND markov_confidence IS NOT NULL
    GROUP BY markov_detected, decision
    ORDER BY count DESC
  `,

  /**
   * A/B Test Results (if experiment is running)
   */
  abTestResults: (experimentId: string, hours: number) => `
    SELECT
      variant,
      COUNT(*) as count,
      AVG(risk_score) as avg_risk_score,
      SUM(CASE WHEN decision = 'block' THEN 1 ELSE 0 END) as blocks,
      SUM(CASE WHEN decision = 'allow' THEN 1 ELSE 0 END) as allows
    FROM validations
    WHERE timestamp >= datetime('now', '-${hours} hours')
      AND experiment_id = '${experimentId}'
    GROUP BY variant
  `,
};

/**
 * Execute a D1 query and return results
 */
export async function executeD1Query<T = any>(
  db: D1Database,
  query: string
): Promise<T[]> {
  const result = await db.prepare(query).all<T>();
  return result.results;
}

/**
 * Execute a D1 query with pagination
 */
export async function executeD1QueryPaginated<T = any>(
  db: D1Database,
  query: string,
  limit: number = 100,
  offset: number = 0
): Promise<{ results: T[]; total: number }> {
  // Add LIMIT and OFFSET to query
  const paginatedQuery = `${query} LIMIT ${limit} OFFSET ${offset}`;

  // Get results
  const result = await db.prepare(paginatedQuery).all<T>();

  // Get total count (approximate - for exact count would need COUNT query)
  const total = result.results.length + offset;

  return {
    results: result.results,
    total,
  };
}
