/**
 * D1 Database Metrics Writers
 * Handles writing all metric types to D1 database using prepared statements
 */

import { logger } from '../logger';
import type {
  ValidationMetric,
  TrainingMetric,
  ABTestMetric,
  AdminMetric,
} from '../utils/metrics';

/**
 * Write validation metric to D1 database
 */
export async function writeValidationMetricToD1(
  db: D1Database | undefined,
  metric: ValidationMetric
): Promise<void> {
  if (!db) {
    return;
  }

  try {
    await db
      .prepare(`
        INSERT INTO validations (
          decision, risk_score, block_reason,
          email_local_part, domain, tld, fingerprint_hash,
          pattern_type, pattern_family,
          is_disposable, is_free_provider, has_plus_addressing,
          has_keyboard_walk, is_gibberish,
          entropy_score, bot_score, tld_risk_score,
          domain_reputation_score, pattern_confidence,
          markov_detected, markov_confidence,
          markov_cross_entropy_legit, markov_cross_entropy_fraud,
          client_ip, user_agent, model_version,
          exclude_from_training, ip_reputation_score,
          experiment_id, variant, bucket,
          country, asn, latency,
          pattern_classification_version
        ) VALUES (
          ?1, ?2, ?3,
          ?4, ?5, ?6, ?7,
          ?8, ?9,
          ?10, ?11, ?12,
          ?13, ?14,
          ?15, ?16, ?17,
          ?18, ?19,
          ?20, ?21,
          ?22, ?23,
          ?24, ?25, ?26,
          ?27, ?28,
          ?29, ?30, ?31,
          ?32, ?33, ?34,
          ?35
        )
      `)
      .bind(
        // Decision & Risk
        metric.decision,
        metric.riskScore,
        metric.blockReason || null,
        // Email Analysis
        metric.emailLocalPart || null,
        metric.domain || null,
        metric.tld || null,
        metric.fingerprintHash,
        // Pattern Detection
        metric.patternType || null,
        metric.patternFamily || null,
        metric.isDisposable ? 1 : 0,
        metric.isFreeProvider ? 1 : 0,
        metric.hasPlusAddressing ? 1 : 0,
        metric.hasKeyboardWalk ? 1 : 0,
        metric.isGibberish ? 1 : 0,
        // Scores
        metric.entropyScore ?? null,
        metric.botScore ?? null,
        metric.tldRiskScore ?? null,
        metric.domainReputationScore ?? null,
        metric.patternConfidence ?? null,
        // Markov Chain
        metric.markovDetected ? 1 : 0,
        metric.markovConfidence ?? null,
        metric.markovCrossEntropyLegit ?? null,
        metric.markovCrossEntropyFraud ?? null,
        // Online Learning
        metric.clientIp || null,
        metric.userAgent || null,
        metric.modelVersion || null,
        metric.excludeFromTraining ? 1 : 0,
        metric.ipReputationScore ?? null,
        // A/B Testing
        metric.experimentId || null,
        metric.variant || null,
        metric.bucket ?? null,
        // Geographic & Network
        metric.country || null,
        metric.asn ?? null,
        // Performance
        metric.latency,
        // Algorithm versioning (v2.1+)
        metric.patternClassificationVersion || null
      )
      .run();
  } catch (error) {
    // Silently fail - don't break validation on metrics errors
    logger.error(
      {
        event: 'd1_validation_write_failed',
        error:
          error instanceof Error
            ? {
                message: error.message,
                stack: error.stack,
                name: error.name,
              }
            : String(error),
      },
      'Failed to write validation metric to D1'
    );
  }
}

/**
 * Write training metric to D1 database
 */
export async function writeTrainingMetricToD1(
  db: D1Database | undefined,
  metric: TrainingMetric
): Promise<void> {
  if (!db) {
    return;
  }

  try {
    await db
      .prepare(`
        INSERT INTO training_metrics (
          event, model_version, trigger_type,
          fraud_count, legit_count, total_samples, training_duration,
          accuracy, precision_metric, recall, f1_score, false_positive_rate,
          anomaly_score, anomaly_type,
          error_message, error_type
        ) VALUES (
          ?1, ?2, ?3,
          ?4, ?5, ?6, ?7,
          ?8, ?9, ?10, ?11, ?12,
          ?13, ?14,
          ?15, ?16
        )
      `)
      .bind(
        metric.event,
        metric.modelVersion || null,
        metric.triggerType || null,
        metric.fraudCount ?? null,
        metric.legitCount ?? null,
        metric.totalSamples ?? null,
        metric.trainingDuration ?? null,
        metric.accuracy ?? null,
        metric.precision ?? null,
        metric.recall ?? null,
        metric.f1Score ?? null,
        metric.falsePositiveRate ?? null,
        metric.anomalyScore ?? null,
        metric.anomalyType || null,
        metric.errorMessage || null,
        metric.errorType || null
      )
      .run();
  } catch (error) {
    logger.error(
      {
        event: 'd1_training_write_failed',
        error:
          error instanceof Error
            ? {
                message: error.message,
                stack: error.stack,
                name: error.name,
              }
            : String(error),
      },
      'Failed to write training metric to D1'
    );
  }
}

/**
 * Write A/B test metric to D1 database
 */
export async function writeABTestMetricToD1(
  db: D1Database | undefined,
  metric: ABTestMetric
): Promise<void> {
  if (!db) {
    return;
  }

  try {
    await db
      .prepare(`
        INSERT INTO ab_test_metrics (
          event, experiment_id, variant, bucket,
          control_percent, treatment_percent,
          control_samples, treatment_samples,
          p_value, improvement,
          reason, promotion_decision
        ) VALUES (
          ?1, ?2, ?3, ?4,
          ?5, ?6,
          ?7, ?8,
          ?9, ?10,
          ?11, ?12
        )
      `)
      .bind(
        metric.event,
        metric.experimentId || null,
        metric.variant || null,
        metric.bucket ?? null,
        metric.controlPercent ?? null,
        metric.treatmentPercent ?? null,
        metric.controlSamples ?? null,
        metric.treatmentSamples ?? null,
        metric.pValue ?? null,
        metric.improvement ?? null,
        metric.reason || null,
        metric.promotionDecision || null
      )
      .run();
  } catch (error) {
    logger.error(
      {
        event: 'd1_ab_test_write_failed',
        error:
          error instanceof Error
            ? {
                message: error.message,
                stack: error.stack,
                name: error.name,
              }
            : String(error),
      },
      'Failed to write A/B test metric to D1'
    );
  }
}

/**
 * Write admin metric to D1 database
 */
export async function writeAdminMetricToD1(
  db: D1Database | undefined,
  metric: AdminMetric
): Promise<void> {
  if (!db) {
    return;
  }

  try {
    await db
      .prepare(`
        INSERT INTO admin_metrics (
          event, admin_hash, config_key,
          old_value, new_value,
          reason, validation_passed
        ) VALUES (
          ?1, ?2, ?3,
          ?4, ?5,
          ?6, ?7
        )
      `)
      .bind(
        metric.event,
        metric.admin || null,
        metric.configKey || null,
        metric.oldValue || null,
        metric.newValue || null,
        metric.reason || null,
        metric.validationPassed ? 1 : 0
      )
      .run();
  } catch (error) {
    logger.error(
      {
        event: 'd1_admin_write_failed',
        error:
          error instanceof Error
            ? {
                message: error.message,
                stack: error.stack,
                name: error.name,
              }
            : String(error),
      },
      'Failed to write admin metric to D1'
    );
  }
}
