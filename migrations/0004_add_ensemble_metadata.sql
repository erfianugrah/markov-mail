-- Migration number: 0004 	 2025-11-10T00:00:00.000Z
-- Add ensemble metadata columns for Markov model ensemble (v2.3+)
--
-- CONTEXT:
-- Pattern Classification v2.3 introduces ensemble strategy combining 2-gram and 3-gram Markov models.
-- 2-gram models excel at gibberish detection and generalization with limited data.
-- 3-gram models provide better context awareness when well-trained.
-- Ensemble uses confidence-weighted voting to leverage strengths of both approaches.
--
-- NEW COLUMNS:
-- - ensemble_reasoning: Explains which ensemble strategy was used (e.g., "both_agree_high_confidence", "2gram_gibberish_detection")
-- - model_2gram_prediction: 2-gram model's prediction ("fraud" or "legit")
-- - model_3gram_prediction: 3-gram model's prediction ("fraud" or "legit")
--
-- ENSEMBLE STRATEGIES:
-- 1. both_agree_high_confidence: Both models agree with confidence >0.3
-- 2. 3gram_high_confidence_override: 3-gram has very high confidence (>0.5)
-- 3. 2gram_gibberish_detection: 2-gram detects gibberish (high entropy)
-- 4. disagree_default_to_2gram: Models disagree, default to 2-gram (more robust)
-- 5. 2gram_higher_confidence / 3gram_higher_confidence: Use higher confidence model

-- Add ensemble metadata columns
ALTER TABLE validations ADD COLUMN ensemble_reasoning TEXT;
ALTER TABLE validations ADD COLUMN model_2gram_prediction TEXT CHECK(model_2gram_prediction IN ('fraud', 'legit', NULL));
ALTER TABLE validations ADD COLUMN model_3gram_prediction TEXT CHECK(model_3gram_prediction IN ('fraud', 'legit', NULL));

-- Add index for ensemble reasoning analysis
CREATE INDEX IF NOT EXISTS idx_validations_ensemble_reasoning
  ON validations(ensemble_reasoning)
  WHERE ensemble_reasoning IS NOT NULL;

SELECT 'Migration 0004: Ensemble metadata columns added' as status;
