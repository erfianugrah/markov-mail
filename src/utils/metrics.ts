/**
 * Metrics helpers - D1 Database
 * Stores all validation, training, A/B test, and admin metrics
 * https://developers.cloudflare.com/d1/
 */

import {
  writeValidationMetricToD1,
  writeTrainingMetricToD1,
  writeABTestMetricToD1,
  writeAdminMetricToD1,
} from '../database/metrics';

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
  // DEPRECATED (2025-11-08): Keyboard/gibberish detectors removed
  // Kept for backwards compatibility with existing database rows
  hasKeyboardWalk?: boolean; // No longer written (always undefined)
  hasKeyboardMashing?: boolean; // No longer written (always undefined) - NOTE: never in DB schema
  isGibberish?: boolean; // No longer written (always undefined)
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
  // Algorithm versioning (v2.1+)
  patternClassificationVersion?: string;  // Pattern detection algorithm version
}

/**
 * Write validation metrics to D1
 */
export function writeValidationMetric(
  db: D1Database | undefined,
  metric: ValidationMetric
) {
  writeValidationMetricToD1(db, metric);
}

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
 * Write training metrics to D1
 */
export function writeTrainingMetric(
  db: D1Database | undefined,
  metric: TrainingMetric
): void {
  writeTrainingMetricToD1(db, metric);
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
 * Write A/B test metrics to D1
 */
export function writeABTestMetric(
  db: D1Database | undefined,
  metric: ABTestMetric
): void {
  writeABTestMetricToD1(db, metric);
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
 * Write admin action metrics to D1
 */
export function writeAdminMetric(
  db: D1Database | undefined,
  metric: AdminMetric
): void {
  writeAdminMetricToD1(db, metric);
}
