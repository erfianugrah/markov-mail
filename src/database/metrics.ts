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
          pattern_type, pattern_family, pattern_confidence,
          is_disposable, is_free_provider, has_plus_addressing,
          entropy_score, bot_score, tld_risk_score, domain_reputation_score,
          decision_tree_reason, decision_tree_path,
          client_ip, user_agent, model_version, ip_reputation_score,
          consumer, flow,
          experiment_id, variant, bucket,
          country, asn,
          region, city, postal_code, timezone, latitude, longitude, continent, is_eu_country,
          as_organization, colo, http_protocol, tls_version, tls_cipher,
          client_trust_score, verified_bot, js_detection_passed, detection_ids,
          ja3_hash, ja4, ja4_signals,
          pattern_classification_version,
          latency
        ) VALUES (
          ?1, ?2, ?3,
          ?4, ?5, ?6, ?7,
          ?8, ?9, ?10,
          ?11, ?12, ?13,
          ?14, ?15, ?16, ?17,
          ?18, ?19,
          ?20, ?21, ?22, ?23,
          ?24, ?25,
          ?26, ?27, ?28,
          ?29, ?30,
          ?31, ?32, ?33, ?34, ?35, ?36, ?37, ?38,
          ?39, ?40, ?41, ?42, ?43,
          ?44, ?45, ?46, ?47,
          ?48, ?49, ?50,
          ?51,
          ?52
        )
      `)
      .bind(
        metric.decision,
        metric.riskScore,
        metric.blockReason || null,
        metric.emailLocalPart || null,
        metric.domain || null,
        metric.tld || null,
        metric.fingerprintHash,
        metric.patternType || null,
        metric.patternFamily || null,
        metric.patternConfidence ?? null,
        metric.isDisposable ? 1 : 0,
        metric.isFreeProvider ? 1 : 0,
        metric.hasPlusAddressing ? 1 : 0,
        metric.entropyScore ?? null,
        metric.botScore ?? null,
        metric.tldRiskScore ?? null,
        metric.domainReputationScore ?? null,
        metric.decisionTreeReason || null,
        metric.decisionTreePath || null,
        metric.clientIp || null,
        metric.userAgent || null,
        metric.modelVersion || null,
        metric.ipReputationScore ?? null,
        metric.consumer || null,
        metric.flow || null,
        metric.experimentId || null,
        metric.variant || null,
        metric.bucket ?? null,
        metric.country || null,
        metric.asn ?? null,
        metric.region || null,
        metric.city || null,
        metric.postalCode || null,
        metric.timezone || null,
        metric.latitude || null,
        metric.longitude || null,
        metric.continent || null,
        metric.isEuCountry || null,
        metric.asOrganization || null,
        metric.colo || null,
        metric.httpProtocol || null,
        metric.tlsVersion || null,
        metric.tlsCipher || null,
        metric.clientTrustScore ?? null,
        metric.verifiedBot ? 1 : 0,
        metric.jsDetectionPassed ? 1 : 0,
        metric.detectionIds ? JSON.stringify(metric.detectionIds) : null,
        metric.ja3Hash || null,
        metric.ja4 || null,
        metric.ja4Signals ? JSON.stringify(metric.ja4Signals) : null,
        metric.patternClassificationVersion || null,
        metric.latency
      )
      .run();
  } catch (error) {
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
