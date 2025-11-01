/**
 * Analytics Engine helpers
 * https://developers.cloudflare.com/analytics/analytics-engine/
 */

export interface ValidationMetric {
  decision: 'allow' | 'warn' | 'block';
  riskScore: number;
  entropyScore?: number;
  botScore?: number;
  country?: string;
  asn?: number;
  blockReason?: string;
  fingerprintHash: string;
  latency: number;
  // Enhanced data
  emailLocalPart?: string;
  domain?: string;
  tld?: string;
  patternType?: string;
  patternFamily?: string;
  isDisposable?: boolean;
  isFreeProvider?: boolean;
  hasPlusAddressing?: boolean;
  hasKeyboardWalk?: boolean;
  isGibberish?: boolean;
  tldRiskScore?: number;
  domainReputationScore?: number;
  patternConfidence?: number;
  // Phase 7: Markov Chain data
  markovDetected?: boolean;
  markovConfidence?: number;
  markovCrossEntropyLegit?: number;
  markovCrossEntropyFraud?: number;
  // Phase 8: Online Learning data (NEW)
  clientIp?: string;            // For fraud pattern analysis
  userAgent?: string;           // For bot detection
  modelVersion?: string;        // For A/B testing (e.g., "A", "B")
  excludeFromTraining?: boolean;  // Flag suspicious traffic
  ipReputationScore?: number;   // 0-100 (0=good, 100=bad)
}

/**
 * Write validation metrics to Analytics Engine
 */
export function writeValidationMetric(
  analytics: AnalyticsEngineDataset | undefined,
  metric: ValidationMetric
) {
  if (!analytics) {
    return;
  }

  try {
    analytics.writeDataPoint({
      // Categorical data (up to 20 blobs)
      blobs: [
        metric.decision,                                      // blob1
        metric.blockReason || 'none',                         // blob2
        metric.country || 'unknown',                          // blob3
        getRiskBucket(metric.riskScore),                      // blob4
        metric.domain || 'unknown',                           // blob5
        metric.tld || 'unknown',                              // blob6
        metric.patternType || 'none',                         // blob7
        metric.patternFamily || 'none',                       // blob8
        metric.isDisposable ? 'disposable' : 'normal',        // blob9
        metric.isFreeProvider ? 'free' : 'normal',            // blob10
        metric.hasPlusAddressing ? 'yes' : 'no',              // blob11
        metric.hasKeyboardWalk ? 'yes' : 'no',                // blob12
        metric.isGibberish ? 'yes' : 'no',                    // blob13
        metric.emailLocalPart || 'unknown',                   // blob14
        // Phase 8: Online Learning fields (NEW)
        metric.clientIp || 'unknown',                         // blob15 (for fraud pattern analysis)
        metric.userAgent || 'unknown',                        // blob16 (for bot detection)
        metric.modelVersion || 'production',                  // blob17 (for A/B testing: "A", "B", "production")
        metric.excludeFromTraining ? 'exclude' : 'include',   // blob18 (security: flag suspicious traffic)
        metric.markovDetected ? 'yes' : 'no',                 // blob19 (Phase 7 - MOVED from blob15)
      ],
      // Numeric data (up to 20 doubles)
      doubles: [
        metric.riskScore,                                     // double1
        metric.entropyScore || 0,                             // double2
        metric.botScore || 0,                                 // double3
        metric.asn || 0,                                      // double4
        metric.latency,                                       // double5
        metric.tldRiskScore || 0,                             // double6
        metric.domainReputationScore || 0,                    // double7
        metric.patternConfidence || 0,                        // double8
        metric.markovConfidence || 0,                         // double9 (Phase 7)
        metric.markovCrossEntropyLegit || 0,                  // double10 (Phase 7)
        metric.markovCrossEntropyFraud || 0,                  // double11 (Phase 7)
        metric.ipReputationScore || 0,                        // double12 (Phase 8: 0-100, 0=good, 100=bad)
      ],
      // Indexed string for filtering (only 1 index allowed!)
      indexes: [
        metric.fingerprintHash.substring(0, 32),              // index1 (fingerprint for deduplication)
      ],
    });
  } catch (error) {
    // Silently fail - don't break validation on metrics errors
    console.error('Failed to write analytics:', error);
  }
}

/**
 * Convert risk score to bucket for easier dashboard queries
 */
function getRiskBucket(score: number): string {
  if (score < 0.2) return 'very_low';
  if (score < 0.4) return 'low';
  if (score < 0.6) return 'medium';
  if (score < 0.8) return 'high';
  return 'very_high';
}

/**
 * Create dashboard query helper
 */
export const DashboardQueries = {
  /**
   * Get validation counts by decision
   */
  validationsByDecision: `
    SELECT
      blob1 as decision,
      COUNT(*) as count
    FROM ANALYTICS_DATASET
    WHERE timestamp >= NOW() - INTERVAL '1' HOUR
    GROUP BY decision
    ORDER BY count DESC
  `,

  /**
   * Get block reasons distribution
   */
  blockReasons: `
    SELECT
      blob2 as block_reason,
      COUNT(*) as count
    FROM ANALYTICS_DATASET
    WHERE blob1 = 'block'
      AND timestamp >= NOW() - INTERVAL '24' HOUR
    GROUP BY block_reason
    ORDER BY count DESC
    LIMIT 10
  `,

  /**
   * Get risk score distribution
   */
  riskDistribution: `
    SELECT
      blob4 as risk_bucket,
      COUNT(*) as count,
      AVG(double1) as avg_risk_score
    FROM ANALYTICS_DATASET
    WHERE timestamp >= NOW() - INTERVAL '1' HOUR
    GROUP BY risk_bucket
    ORDER BY avg_risk_score DESC
  `,

  /**
   * Get top countries by validation count
   */
  topCountries: `
    SELECT
      blob3 as country,
      COUNT(*) as count,
      AVG(double1) as avg_risk_score
    FROM ANALYTICS_DATASET
    WHERE timestamp >= NOW() - INTERVAL '24' HOUR
    GROUP BY country
    ORDER BY count DESC
    LIMIT 20
  `,

  /**
   * Get performance metrics
   */
  performanceMetrics: `
    SELECT
      QUANTILE(double5, 0.5) as p50_latency_ms,
      QUANTILE(double5, 0.95) as p95_latency_ms,
      QUANTILE(double5, 0.99) as p99_latency_ms,
      AVG(double5) as avg_latency_ms
    FROM ANALYTICS_DATASET
    WHERE timestamp >= NOW() - INTERVAL '1' HOUR
  `,

  /**
   * Get bot score distribution
   */
  botScoreDistribution: `
    SELECT
      CASE
        WHEN double3 >= 80 THEN 'likely_human'
        WHEN double3 >= 40 THEN 'uncertain'
        ELSE 'likely_bot'
      END as bot_category,
      COUNT(*) as count,
      AVG(double1) as avg_risk_score
    FROM ANALYTICS_DATASET
    WHERE timestamp >= NOW() - INTERVAL '1' HOUR
    GROUP BY bot_category
  `,
};
