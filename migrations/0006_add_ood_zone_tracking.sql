-- Migration number: 0006 	 2025-11-12T00:00:00.000Z
-- Add OOD Zone Tracking (v2.4.1)
--
-- CONTEXT:
-- Pattern Classification v2.4.1 introduces piecewise threshold system
-- for OOD detection with three distinct zones:
-- 1. Dead zone (< 3.8 nats): Familiar patterns, no OOD risk
-- 2. Warn zone (3.8-5.5 nats): Linear interpolation from 0.35 to 0.65
-- 3. Block zone (> 5.5 nats): Maximum OOD risk (0.65)
--
-- RESEARCH BACKING:
-- - 3.8 nats: Research-backed threshold for warning zone start
-- - 5.5 nats: Research-backed threshold for block zone start
-- - Piecewise approach: Balances precision (60% accuracy) vs recall
--
-- NEW COLUMN:
-- - ood_zone: Tracks which zone patterns fall into ('none', 'warn', or 'block')
--
-- USAGE EXAMPLES:
-- 1. Count validations by OOD zone:
--    SELECT ood_zone, COUNT(*) as count
--    FROM validations
--    WHERE timestamp >= datetime('now', '-24 hours')
--    GROUP BY ood_zone;
--
-- 2. Analyze decisions by zone:
--    SELECT ood_zone, decision, COUNT(*) as count
--    FROM validations
--    WHERE ood_detected = 1
--    GROUP BY ood_zone, decision;
--
-- 3. Find patterns in specific zone:
--    SELECT email_local_part, min_entropy, abnormality_risk, decision
--    FROM validations
--    WHERE ood_zone = 'block'
--      AND timestamp >= datetime('now', '-7 days')
--    ORDER BY min_entropy DESC
--    LIMIT 100;

-- Add OOD zone tracking column
-- Possible values: 'none' (below 3.8), 'warn' (3.8-5.5), 'block' (5.5+)
ALTER TABLE validations ADD COLUMN ood_zone TEXT;

-- Create index for OOD zone queries
CREATE INDEX IF NOT EXISTS idx_validations_ood_zone
  ON validations(ood_zone)
  WHERE ood_zone IS NOT NULL;

-- Create composite index for zone + decision analysis
CREATE INDEX IF NOT EXISTS idx_validations_ood_zone_decision
  ON validations(ood_zone, decision, timestamp)
  WHERE ood_zone IS NOT NULL;

SELECT 'Migration 0006: OOD zone tracking added' as status;
