/**
 * API client for fraud detection analytics
 */

const API_BASE = import.meta.env.PUBLIC_API_URL || 'https://fraud.erfi.dev';

export interface AnalyticsQuery {
  query: string;
  hours?: number;
}

export interface AnalyticsResponse {
  results: any[];
  meta: {
    columns: string[];
    rowCount: number;
    duration: number;
  };
}

export interface MetricsSummary {
  totalValidations: number;
  blockCount: number;
  warnCount: number;
  legitCount: number;
  avgLatency: number;
  errorRate: number;
}

export interface BlockReason {
  reason: string;
  count: number;
  percentage: number;
}

export interface SystemConfig {
  riskThresholds: { block: number; warn: number };
  features: Record<string, boolean>;
  modelVersion?: string;
  riskWeights?: Record<string, number>;
  adjustments?: Record<string, number>;
}

/**
 * Fetch the active system configuration
 */
export async function getSystemConfig(apiKey: string): Promise<SystemConfig> {
  const response = await fetch(`${API_BASE}/admin/config`, {
    headers: { 'X-API-Key': apiKey },
  });
  if (!response.ok) throw new Error(`Config fetch failed: ${response.status}`);
  const data = await response.json() as { config: SystemConfig };
  return data.config;
}

/**
 * Execute a SQL query against the analytics database
 */
export async function queryAnalytics(
  query: AnalyticsQuery,
  apiKey: string
): Promise<AnalyticsResponse> {
  try {
    const response = await fetch(`${API_BASE}/admin/analytics`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify(query),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');

      // Provide user-friendly error messages based on status code
      let errorMessage = '';
      switch (response.status) {
        case 401:
        case 403:
          errorMessage = 'Invalid API key. Please check your credentials.';
          break;
        case 404:
          errorMessage = 'Analytics endpoint not found. Please check the API URL.';
          break;
        case 429:
          errorMessage = 'Too many requests. Please try again in a moment.';
          break;
        case 500:
        case 502:
        case 503:
          errorMessage = 'Server error. Please try again later.';
          break;
        default:
          errorMessage = `API error (${response.status}): ${errorText}`;
      }

      throw new Error(errorMessage);
    }

    return response.json();
  } catch (error) {
    // Handle network errors
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new Error('Network error. Please check your connection and try again.');
    }
    throw error;
  }
}

/**
 * Get metrics summary for the last N hours
 * SECURITY: Validates hours parameter before use
 */
export async function getMetricsSummary(
  hours: number = 24,
  apiKey: string
): Promise<MetricsSummary> {
  // SECURITY: Validate and sanitize hours parameter
  const validHours = Math.floor(Math.abs(hours));
  if (validHours < 1 || validHours > 8760) {
    throw new Error('Invalid hours parameter. Must be between 1 and 8760.');
  }

  const sql = `
    SELECT
      COUNT(*) as totalValidations,
      SUM(CASE WHEN decision = 'block' THEN 1 ELSE 0 END) as blockCount,
      SUM(CASE WHEN decision = 'warn' THEN 1 ELSE 0 END) as warnCount,
      SUM(CASE WHEN decision = 'allow' THEN 1 ELSE 0 END) as legitCount,
      AVG(latency) as avgLatency,
      0.0 as errorRate
    FROM validations
    WHERE timestamp >= datetime('now', '-${validHours} hours')
  `;

  const response = await queryAnalytics({ query: sql, hours: validHours }, apiKey);
  const row = response.results[0];

  return {
    totalValidations: row.totalValidations || 0,
    blockCount: row.blockCount || 0,
    warnCount: row.warnCount || 0,
    legitCount: row.legitCount || 0,
    avgLatency: Math.round(row.avgLatency || 0),
    errorRate: parseFloat((row.errorRate || 0).toFixed(2)),
  };
}

/**
 * Get block reasons distribution
 * SECURITY: Validates hours parameter before use
 */
export async function getBlockReasons(
  hours: number = 24,
  apiKey: string
): Promise<BlockReason[]> {
  // SECURITY: Validate and sanitize hours parameter
  const validHours = Math.floor(Math.abs(hours));
  if (validHours < 1 || validHours > 8760) {
    throw new Error('Invalid hours parameter. Must be between 1 and 8760.');
  }

  const sql = `
    SELECT
      block_reason as reason,
      COUNT(*) as count,
      (COUNT(*) * 100.0 / (SELECT COUNT(*) FROM validations WHERE decision = 'block' AND timestamp >= datetime('now', '-${validHours} hours'))) as percentage
    FROM validations
    WHERE decision = 'block'
      AND timestamp >= datetime('now', '-${validHours} hours')
      AND block_reason IS NOT NULL
    GROUP BY block_reason
    ORDER BY count DESC
    LIMIT 10
  `;

  const response = await queryAnalytics({ query: sql, hours: validHours }, apiKey);

  return response.results.map((row) => ({
    reason: row.reason || 'Unknown',
    count: row.count,
    percentage: parseFloat(row.percentage.toFixed(2)),
  }));
}

/**
 * Get time series data for validations
 * SECURITY: Validates hours parameter before use
 */
export async function getTimeSeriesData(
  hours: number = 24,
  apiKey: string
): Promise<Array<{ timestamp: string; count: number; blocks: number; warns: number }>> {
  // SECURITY: Validate and sanitize hours parameter
  const validHours = Math.floor(Math.abs(hours));
  if (validHours < 1 || validHours > 8760) {
    throw new Error('Invalid hours parameter. Must be between 1 and 8760.');
  }

  const sql = `
    SELECT
      strftime('%Y-%m-%d %H:00:00', timestamp) as hour,
      COUNT(*) as count,
      SUM(CASE WHEN decision = 'block' THEN 1 ELSE 0 END) as blocks,
      SUM(CASE WHEN decision = 'warn' THEN 1 ELSE 0 END) as warns
    FROM validations
    WHERE timestamp >= datetime('now', '-${validHours} hours')
    GROUP BY hour
    ORDER BY hour ASC
  `;

  const response = await queryAnalytics({ query: sql, hours: validHours }, apiKey);

  if (!response.results || !Array.isArray(response.results)) {
    return [];
  }

  return response.results.map((row) => ({
    timestamp: row.hour,
    count: row.count,
    blocks: row.blocks,
    warns: row.warns,
  }));
}
