-- Migration number: 0003 	 2025-11-08T00:00:00.000Z
-- Deprecate heuristic detector columns
--
-- CONTEXT:
-- Keyboard-walk, keyboard-mashing, and gibberish detectors had high false positive rates.
-- Example: "person@company.com" was flagged as mashing (85% risk) due to
-- Colemak home row overlap with common English letters.
--
-- SOLUTION:
-- Switched to Markov-only detection (trained on 111K+ legitimate + 105K fraud emails).
-- Results: 83% accuracy vs 67% with heuristics, zero false positives on legitimate names.
--
-- COLUMNS AFFECTED:
-- - has_keyboard_walk: Deprecated (always 0 in new rows)
-- - is_gibberish: Deprecated (always 0 in new rows)
--
-- NOTE: Columns are NOT dropped for backwards compatibility with existing analytics queries.
-- Existing rows retain their historical data. New rows will have these fields set to 0.

-- SQLite doesn't support column comments, so we document here:
-- has_keyboard_walk (INTEGER): DEPRECATED 2025-11-08 - Replaced by Markov detection
-- is_gibberish (INTEGER): DEPRECATED 2025-11-08 - Replaced by Markov detection

-- No schema changes needed - columns remain but are no longer populated
-- Future migration (after 30+ days) may drop these columns entirely

SELECT 'Migration 0003: Heuristic detectors deprecated (no schema changes)' as status;
