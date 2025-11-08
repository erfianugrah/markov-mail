-- Migration number: 0002 	 2025-11-06T12:00:00.000Z
-- Add pattern_classification_version column to track algorithm changes
-- This enables analytics to separate old (v2.0) vs new (v2.1+) pattern detection results

-- Add new column for pattern classification version
ALTER TABLE validations ADD COLUMN pattern_classification_version TEXT;

-- Add index for analytics queries that filter by version
CREATE INDEX IF NOT EXISTS idx_validations_pattern_version
  ON validations(pattern_classification_version);

-- Backfill existing records with v2.0 (original entropy-based algorithm)
-- This ensures we can distinguish historical data from new detections
UPDATE validations
SET pattern_classification_version = '2.0'
WHERE pattern_classification_version IS NULL;

-- Add comment documenting the versions
-- v2.0: Original entropy-based pattern detection (entropy > 0.7)
-- v2.1: Multi-factor detection (n-grams + vowel density + entropy > 0.75)
