-- Migration number: 0005 	 2025-11-10T00:00:00.000Z
-- Add OOD (Out-of-Distribution) detection columns (v2.4+)
--
-- CONTEXT:
-- Pattern Classification v2.4 introduces two-dimensional risk model:
-- 1. Classification risk: Is this fraud or legit? (differential signal)
-- 2. Abnormality risk: Is this out-of-distribution? (consensus signal)
--
-- When BOTH models have high cross-entropy (>3.0 nats), the pattern is abnormal.
-- This catches novel patterns like anagrams, shuffles, and other unusual combinations
-- that neither model was trained on.
--
-- RESEARCH BACKING:
-- - Binary classification baseline: 0.69 nats (random guessing)
-- - Good predictions: < 0.2 nats
-- - Poor predictions: > 1.0 nats
-- - Severely confused (OOD): > 3.0 nats
--
-- NEW COLUMNS:
-- - min_entropy: min(crossEntropyLegit, crossEntropyFraud) - measures abnormality
-- - abnormality_score: How far above OOD threshold (0 if below)
-- - abnormality_risk: Risk contribution from abnormality (0.0-0.6 range)
-- - ood_detected: Boolean flag for analytics (1 if abnormalityScore > 0)

-- Add OOD detection columns
ALTER TABLE validations ADD COLUMN min_entropy REAL;
ALTER TABLE validations ADD COLUMN abnormality_score REAL;
ALTER TABLE validations ADD COLUMN abnormality_risk REAL;
ALTER TABLE validations ADD COLUMN ood_detected INTEGER DEFAULT 0;

-- Add index for OOD analytics
CREATE INDEX IF NOT EXISTS idx_validations_ood_detected
  ON validations(ood_detected, min_entropy)
  WHERE ood_detected = 1;

-- Add index for abnormality risk analysis
CREATE INDEX IF NOT EXISTS idx_validations_abnormality_risk
  ON validations(abnormality_risk)
  WHERE abnormality_risk > 0;

SELECT 'Migration 0005: OOD detection columns added' as status;
