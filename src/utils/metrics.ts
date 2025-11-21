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
  // Ensemble metadata (v2.3+)
  ensembleReasoning?: string;       // Ensemble decision reasoning
  model2gramPrediction?: string;    // 2-gram model prediction (fraud/legit)
  model3gramPrediction?: string;    // 3-gram model prediction (fraud/legit)
  // OOD Detection (v2.4+)
  minEntropy?: number;              // min(H_legit, H_fraud) - abnormality measure
  abnormalityScore?: number;        // How far above OOD threshold
  abnormalityRisk?: number;         // Risk contribution from abnormality (0.0-0.6)
  oodDetected?: boolean;            // Whether OOD was detected
  // OOD Zone (v2.4.1+)
  oodZone?: string;                 // Zone: 'none' (<3.8), 'warn' (3.8-5.5), 'block' (5.5+)
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
  // Enhanced request.cf metadata (v2.5+) - Migration 0007
  // Geographic
  region?: string;              // State/province
  city?: string;                // City name
  postalCode?: string;          // Postal/ZIP code
  timezone?: string;            // IANA timezone (e.g., "America/New_York")
  latitude?: string;            // Geographic latitude
  longitude?: string;           // Geographic longitude
  continent?: string;           // Continent code (e.g., "NA")
  isEuCountry?: string;         // EU country flag
  // Network
  asOrganization?: string;      // AS organization name
  colo?: string;                // Cloudflare datacenter (e.g., "SJC")
  httpProtocol?: string;        // HTTP version (e.g., "HTTP/2")
  tlsVersion?: string;          // TLS version (e.g., "TLSv1.3")
  tlsCipher?: string;           // TLS cipher suite
  // Bot Detection (Enhanced)
  clientTrustScore?: number;    // Cloudflare trust score
  verifiedBot?: boolean;        // Known good bot (e.g., Googlebot)
  jsDetectionPassed?: boolean;  // JavaScript challenge passed
  detectionIds?: number[];      // Bot detection signal IDs
  // Fingerprints (Enhanced)
  ja3Hash?: string;             // JA3 TLS fingerprint
  ja4?: string;                 // JA4 fingerprint string
  ja4Signals?: Record<string, number>;  // JA4 signal scores
  // RPC Metadata (v2.5.1+)
  consumer?: string;            // Consumer service name (e.g., "FORMINATOR")
  flow?: string;                // Request flow type (e.g., "REGISTRATION", "LOGIN")
}

/**
 * Write validation metrics to D1
 */
export function writeValidationMetric(
  db: D1Database | undefined,
  metric: ValidationMetric
): Promise<void> {
  return writeValidationMetricToD1(db, metric);
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
