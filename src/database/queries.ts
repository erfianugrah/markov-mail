/**
 * D1 Query Helpers
 * Pre-built queries for common analytics operations
 */

/**
 * Validate and sanitize hours parameter to prevent SQL injection
 * Only allows positive integers within a reasonable range
 */
function validateHours(hours: number): number {
  // Convert to integer and validate range
  const validHours = Math.floor(Math.abs(hours));

  // Limit to reasonable range: 1 hour to 1 year (8760 hours)
  if (validHours < 1 || validHours > 8760) {
    throw new Error(`Invalid hours parameter: ${hours}. Must be between 1 and 8760`);
  }

  return validHours;
}

/**
 * Common D1 queries for analytics dashboard
 * These replace the Analytics Engine queries with proper SQLite syntax
 *
 * SECURITY: All queries validate the hours parameter to prevent SQL injection
 */
export const D1Queries = {
  /**
   * Summary: Overview of allow/warn/block decisions
   */
  summary: (hours: number) => {
    const validHours = validateHours(hours);
    return `
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
    WHERE timestamp >= datetime('now', '-${validHours} hours')
    GROUP BY decision, block_reason, risk_bucket, hour
    ORDER BY hour DESC, count DESC
  `;
  },

  /**
   * Top block reasons in the last N hours
   * v2.1: Now groups by pattern_classification_version to separate old/new data
   */
  blockReasons: (hours: number) => {
    const validHours = validateHours(hours);
    return `
    SELECT
      block_reason,
      pattern_classification_version,
      COUNT(*) as count,
      AVG(risk_score) as avg_risk_score
    FROM validations
    WHERE timestamp >= datetime('now', '-${validHours} hours')
      AND decision = 'block'
      AND block_reason IS NOT NULL
    GROUP BY block_reason, pattern_classification_version
    ORDER BY count DESC
    LIMIT 20
  `;
  },

  /**
   * Risk score distribution
   */
  riskDistribution: (hours: number) => {
    const validHours = validateHours(hours);
    return `
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
    WHERE timestamp >= datetime('now', '-${validHours} hours')
    GROUP BY risk_bucket
    ORDER BY avg_risk_score ASC
  `;
  },

  /**
   * Top countries by validation count
   */
  topCountries: (hours: number) => {
    const validHours = validateHours(hours);
    return `
    SELECT
      country,
      COUNT(*) as count,
      AVG(risk_score) as avg_risk_score
    FROM validations
    WHERE timestamp >= datetime('now', '-${validHours} hours')
      AND country IS NOT NULL
    GROUP BY country
    ORDER BY count DESC
    LIMIT 20
  `;
  },

  /**
   * Performance metrics
   */
  performanceMetrics: (hours: number) => {
    const validHours = validateHours(hours);
    return `
    SELECT
      decision,
      COUNT(*) as count,
      AVG(latency) as avg_latency_ms,
      MIN(latency) as min_latency_ms,
      MAX(latency) as max_latency_ms
    FROM validations
    WHERE timestamp >= datetime('now', '-${validHours} hours')
    GROUP BY decision
  `;
  },

  /**
   * Bot score distribution
   */
  botScoreDistribution: (hours: number) => {
    const validHours = validateHours(hours);
    return `
    SELECT
      CASE
        WHEN bot_score >= 80 THEN 'likely_human'
        WHEN bot_score >= 40 THEN 'uncertain'
        ELSE 'likely_bot'
      END as bot_category,
      COUNT(*) as count,
      AVG(risk_score) as avg_risk_score
    FROM validations
    WHERE timestamp >= datetime('now', '-${validHours} hours')
      AND bot_score IS NOT NULL
    GROUP BY bot_category
  `;
  },

  /**
   * Hourly timeline
   */
  hourlyTimeline: (hours: number) => {
    const validHours = validateHours(hours);
    return `
    SELECT
      strftime('%Y-%m-%d %H:00:00', timestamp) as hour,
      decision,
      COUNT(*) as count,
      AVG(risk_score) as avg_risk_score
    FROM validations
    WHERE timestamp >= datetime('now', '-${validHours} hours')
    GROUP BY hour, decision
    ORDER BY hour DESC
  `;
  },

  /**
   * Top fingerprints (potential automation)
   */
  topFingerprints: (hours: number) => {
    const validHours = validateHours(hours);
    return `
    SELECT
      fingerprint_hash,
      COUNT(*) as validation_count,
      AVG(risk_score) as avg_risk_score,
      country
    FROM validations
    WHERE timestamp >= datetime('now', '-${validHours} hours')
    GROUP BY fingerprint_hash, country
    HAVING validation_count > 10
    ORDER BY validation_count DESC
    LIMIT 20
  `;
  },

  /**
   * High risk emails (risk score > 0.6)
   */
  highRiskEmails: (hours: number) => {
    const validHours = validateHours(hours);
    return `
    SELECT
      decision,
      block_reason,
      country,
      risk_score,
      entropy_score,
      timestamp
    FROM validations
    WHERE timestamp >= datetime('now', '-${validHours} hours')
      AND risk_score > 0.6
    ORDER BY timestamp DESC
    LIMIT 100
  `;
  },

  /**
   * Disposable domain statistics
   */
  disposableDomains: (hours: number) => {
    const validHours = validateHours(hours);
    return `
    SELECT
      domain,
      COUNT(*) as count,
      AVG(risk_score) as avg_risk_score,
      SUM(CASE WHEN decision = 'block' THEN 1 ELSE 0 END) as blocks
    FROM validations
    WHERE timestamp >= datetime('now', '-${validHours} hours')
      AND is_disposable = 1
      AND domain IS NOT NULL
    GROUP BY domain
    ORDER BY count DESC
    LIMIT 20
  `;
  },

  /**
   * Pattern family analysis
   * v2.1: Now includes pattern_classification_version to separate old/new classifications
   */
  patternFamilies: (hours: number) => {
    const validHours = validateHours(hours);
    return `
    SELECT
      pattern_family,
      pattern_type,
      pattern_classification_version,
      COUNT(*) as count,
      AVG(risk_score) as avg_risk_score,
      SUM(CASE WHEN decision = 'block' THEN 1 ELSE 0 END) as blocks
    FROM validations
    WHERE timestamp >= datetime('now', '-${validHours} hours')
      AND pattern_family IS NOT NULL
    GROUP BY pattern_family, pattern_type, pattern_classification_version
    ORDER BY count DESC
    LIMIT 20
  `;
  },

  /**
   * Identity matching signals
   */
  identitySignals: (hours: number) => {
    const validHours = validateHours(hours);
    return `
    WITH latest AS (
      SELECT
        CASE
          WHEN identity_similarity IS NULL THEN 'unknown'
          WHEN identity_similarity >= 0.8 THEN 'strong_match'
          WHEN identity_similarity >= 0.4 THEN 'partial_match'
          ELSE 'mismatch'
        END AS bucket,
        identity_similarity,
        risk_score
      FROM validations
      WHERE timestamp >= datetime('now', '-${validHours} hours')
    )
    SELECT
      bucket,
      COUNT(*) AS count,
      AVG(identity_similarity) AS avg_similarity,
      AVG(risk_score) AS avg_risk_score
    FROM latest
    GROUP BY bucket
    ORDER BY count DESC
  `;
  },

  /**
   * Geo consistency summary
   */
  geoSignals: (hours: number) => {
    const validHours = validateHours(hours);
    return `
    WITH base AS (
      SELECT
        geo_language_mismatch,
        geo_timezone_mismatch,
        risk_score
      FROM validations
      WHERE timestamp >= datetime('now', '-${validHours} hours')
    )
    SELECT
      label,
      count,
      avg_risk_score
    FROM (
      SELECT
        'Language mismatch' AS label,
        SUM(CASE WHEN geo_language_mismatch = 1 THEN 1 ELSE 0 END) AS count,
        AVG(CASE WHEN geo_language_mismatch = 1 THEN risk_score END) AS avg_risk_score
      FROM base
      UNION ALL
      SELECT
        'Timezone mismatch',
        SUM(CASE WHEN geo_timezone_mismatch = 1 THEN 1 ELSE 0 END),
        AVG(CASE WHEN geo_timezone_mismatch = 1 THEN risk_score END)
      FROM base
      UNION ALL
      SELECT
        'Both mismatched',
        SUM(CASE WHEN geo_language_mismatch = 1 AND geo_timezone_mismatch = 1 THEN 1 ELSE 0 END),
        AVG(CASE WHEN geo_language_mismatch = 1 AND geo_timezone_mismatch = 1 THEN risk_score END)
      FROM base
      UNION ALL
      SELECT
        'Aligned',
        SUM(CASE WHEN (geo_language_mismatch IS NULL OR geo_language_mismatch = 0)
               AND (geo_timezone_mismatch IS NULL OR geo_timezone_mismatch = 0) THEN 1 ELSE 0 END),
        AVG(CASE WHEN (geo_language_mismatch IS NULL OR geo_language_mismatch = 0)
               AND (geo_timezone_mismatch IS NULL OR geo_timezone_mismatch = 0) THEN risk_score END)
      FROM base
    )
    WHERE count > 0
  `;
  },

  /**
   * MX provider distribution
   */
  mxProviders: (hours: number) => {
    const validHours = validateHours(hours);
    return `
    SELECT
      COALESCE(mx_primary_provider, 'unknown') AS provider,
      COUNT(*) AS count,
      AVG(risk_score) AS avg_risk_score,
      AVG(CASE WHEN mx_has_records = 1 THEN mx_record_count ELSE NULL END) AS avg_record_count
    FROM validations
    WHERE timestamp >= datetime('now', '-${validHours} hours')
    GROUP BY provider
    ORDER BY count DESC
    LIMIT 12
  `;
  },

  /**
   * A/B Test Results (if experiment is running)
   * REMOVED: This query had SQL injection vulnerability
   * Use parameterized query instead:
   * db.prepare(`SELECT ... WHERE experiment_id = ?`).bind(experimentId)
   */
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
 * SECURITY: Validates limit and offset to prevent SQL injection
 */
export async function executeD1QueryPaginated<T = any>(
  db: D1Database,
  query: string,
  limit: number = 100,
  offset: number = 0
): Promise<{ results: T[]; total: number }> {
  // SECURITY: Validate and sanitize pagination parameters
  const validLimit = Math.floor(Math.abs(limit));
  const validOffset = Math.floor(Math.abs(offset));

  // Enforce reasonable limits
  if (validLimit < 1 || validLimit > 1000) {
    throw new Error(`Invalid limit: ${limit}. Must be between 1 and 1000`);
  }

  if (validOffset < 0 || validOffset > 100000) {
    throw new Error(`Invalid offset: ${offset}. Must be between 0 and 100000`);
  }

  // Use parameterized query with validated integers
  const paginatedQuery = `${query} LIMIT ? OFFSET ?`;

  // Get results with parameterized bindings
  const result = await db.prepare(paginatedQuery).bind(validLimit, validOffset).all<T>();

  // Get total count (approximate - for exact count would need COUNT query)
  const total = result.results.length + validOffset;

  return {
    results: result.results,
    total,
  };
}
