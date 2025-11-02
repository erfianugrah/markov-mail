/**
 * Analytics Engine helpers
 * https://developers.cloudflare.com/analytics/analytics-engine/
 */

import { logger } from '../logger';

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
  // A/B Testing fields
  experimentId?: string;        // ID of active A/B experiment
  variant?: 'control' | 'treatment';  // Assigned variant
  bucket?: number;              // Hash bucket (0-99)
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
        metric.variant || metric.modelVersion || 'production', // blob17 (A/B variant: "control", "treatment", or model version)
        metric.excludeFromTraining ? 'exclude' : 'include',   // blob18 (security: flag suspicious traffic)
        metric.markovDetected ? 'yes' : 'no',                 // blob19 (Phase 7 - MOVED from blob15)
        metric.experimentId || 'none',                        // blob20 (A/B experiment ID)
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
        metric.bucket ?? -1,                                  // double13 (A/B test bucket: 0-99, or -1 if no experiment)
      ],
      // Indexed string for filtering (only 1 index allowed!)
      indexes: [
        metric.fingerprintHash.substring(0, 32),              // index1 (fingerprint for deduplication)
      ],
    });
  } catch (error) {
    // Silently fail - don't break validation on metrics errors
    logger.error({
      event: 'analytics_write_failed',
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name,
      } : String(error),
    }, 'Failed to write analytics');
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

// ============================================================================
// Training Pipeline Metrics
// ============================================================================

export interface TrainingMetric {
  event: 'training_started' | 'training_completed' | 'training_failed' |
         'validation_passed' | 'validation_failed' | 'lock_acquired' |
         'lock_failed' | 'anomaly_detected' | 'candidate_created';

  // Metadata
  modelVersion?: string;
  triggerType?: 'scheduled' | 'manual' | 'online';

  // Training data
  fraudCount?: number;
  legitCount?: number;
  totalSamples?: number;
  trainingDuration?: number;

  // Validation metrics
  accuracy?: number;
  precision?: number;
  recall?: number;
  f1Score?: number;
  falsePositiveRate?: number;

  // Anomaly detection
  anomalyScore?: number;
  anomalyType?: string;

  // Error context
  errorMessage?: string;
  errorType?: string;
}

/**
 * Write training metrics to Analytics Engine
 */
export function writeTrainingMetric(
  analytics: AnalyticsEngineDataset | undefined,
  metric: TrainingMetric
): void {
  if (!analytics) {
    return;
  }

  try {
    analytics.writeDataPoint({
      blobs: [
        metric.event,                                           // blob1
        metric.triggerType || 'unknown',                        // blob2
        metric.modelVersion || 'unknown',                       // blob3
        metric.anomalyType || 'none',                          // blob4
        metric.errorType || 'none',                            // blob5
      ],
      doubles: [
        metric.fraudCount || 0,                                // double1
        metric.legitCount || 0,                                // double2
        metric.totalSamples || 0,                              // double3
        metric.trainingDuration || 0,                          // double4
        metric.accuracy || 0,                                  // double5
        metric.precision || 0,                                 // double6
        metric.recall || 0,                                    // double7
        metric.f1Score || 0,                                   // double8
        metric.falsePositiveRate || 0,                         // double9
        metric.anomalyScore || 0,                              // double10
      ],
      indexes: [
        metric.modelVersion || 'unknown',                      // index1
      ],
    });
  } catch (error) {
    logger.error({
      event: 'training_metrics_write_failed',
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name,
      } : String(error),
    }, 'Failed to write training metrics');
  }
}

// ============================================================================
// A/B Testing Metrics
// ============================================================================

export interface ABTestMetric {
  event: 'experiment_created' | 'experiment_stopped' |
         'variant_assigned' | 'promotion_evaluated' |
         'model_promoted' | 'canary_rollback';

  experimentId?: string;
  variant?: 'control' | 'treatment';
  bucket?: number;

  // Traffic config
  controlPercent?: number;
  treatmentPercent?: number;

  // Results
  controlSamples?: number;
  treatmentSamples?: number;
  pValue?: number;
  improvement?: number;

  // Decision context
  reason?: string;
  promotionDecision?: 'promote' | 'rollback' | 'extend';
}

/**
 * Write A/B test metrics to Analytics Engine
 */
export function writeABTestMetric(
  analytics: AnalyticsEngineDataset | undefined,
  metric: ABTestMetric
): void {
  if (!analytics) {
    return;
  }

  try {
    analytics.writeDataPoint({
      blobs: [
        metric.event,                                          // blob1
        metric.experimentId || 'unknown',                      // blob2
        metric.variant || 'none',                              // blob3
        metric.promotionDecision || 'none',                    // blob4
        metric.reason || 'none',                               // blob5
      ],
      doubles: [
        metric.bucket ?? -1,                                   // double1
        metric.controlPercent || 0,                            // double2
        metric.treatmentPercent || 0,                          // double3
        metric.controlSamples || 0,                            // double4
        metric.treatmentSamples || 0,                          // double5
        metric.pValue ?? -1,                                   // double6
        metric.improvement || 0,                               // double7
      ],
      indexes: [
        metric.experimentId || 'unknown',                      // index1
      ],
    });
  } catch (error) {
    logger.error({
      event: 'ab_test_metrics_write_failed',
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name,
      } : String(error),
    }, 'Failed to write A/B test metrics');
  }
}

// ============================================================================
// Admin Action Metrics
// ============================================================================

export interface AdminMetric {
  event: 'config_updated' | 'weights_changed' |
         'feature_toggled' | 'manual_training_triggered' |
         'model_deployed' | 'whitelist_updated';

  admin?: string; // Hashed admin identifier
  configKey?: string;
  oldValue?: string;
  newValue?: string;

  // Context
  reason?: string;
  validationPassed?: boolean;
}

/**
 * Write admin action metrics to Analytics Engine
 */
export function writeAdminMetric(
  analytics: AnalyticsEngineDataset | undefined,
  metric: AdminMetric
): void {
  if (!analytics) {
    return;
  }

  try {
    analytics.writeDataPoint({
      blobs: [
        metric.event,                                          // blob1
        metric.admin || 'unknown',                             // blob2
        metric.configKey || 'none',                            // blob3
        metric.reason || 'none',                               // blob4
        metric.validationPassed ? 'passed' : 'failed',         // blob5
      ],
      doubles: [
        // Reserved for future numeric admin metrics
      ],
      indexes: [
        metric.configKey || 'unknown',                         // index1
      ],
    });
  } catch (error) {
    logger.error({
      event: 'admin_metrics_write_failed',
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name,
      } : String(error),
    }, 'Failed to write admin metrics');
  }
}
