/**
 * Pattern Detectors Index
 *
 * Central export point for all email pattern detection modules.
 *
 * ⚠️  SCORING STRATEGY (2025-01-07):
 * The fraud detection system uses a Markov-first approach:
 *
 * PRIMARY SCORING:
 * - Markov Chain cross-entropy (NGramMarkovChain) - PRIMARY, trained on 91K emails
 *
 * SECONDARY OVERRIDES (deterministic patterns):
 * - Keyboard Walk detection - Override to 0.9
 * - Keyboard Mashing detection - Override to 0.85
 * - Sequential patterns - Override to 0.8 (detected by pattern-family)
 * - Dated patterns - Override to 0.7 (detected by pattern-family)
 *
 * DOMAIN SIGNALS (additive):
 * - Disposable domains - Base risk 0.95
 * - Domain reputation - Add +0.2
 * - TLD risk - Add +0.1
 *
 * DEPRECATED/REMOVED:
 * - sequential.ts, dated.ts - Now internal-only (called by pattern-family.ts)
 * - markov-chain.ts - Replaced by ngram-markov.ts
 * - signal-aggregator.ts - Replaced with Markov-first approach
 * - markov-ensemble.ts - Never implemented
 */

// ============================================================================
// INTERNAL-ONLY DETECTORS (not exported, used by other detectors)
// ============================================================================
// - sequential.ts → Used internally by pattern-family.ts
// - dated.ts → Used internally by pattern-family.ts
// - ngram-multilang.ts → Used internally by ngram-analysis.ts
//
// These are NOT exported to prevent misuse. Access them through their
// parent detectors (pattern-family, ngram-analysis) instead.
// ============================================================================

// Plus-addressing normalization
export {
  normalizeEmail,
  detectPlusAddressingAbuse,
  supportsPlusAddressing,
  analyzePlusTagPattern,
  getCanonicalEmail,
  areEmailsEquivalent,
  getPlusAddressingRiskScore,
  type NormalizedEmailResult
} from './plus-addressing';

// Pattern family extraction
export {
  extractPatternFamily,
  analyzePatternFamilies,
  getPatternRiskScore,
  type PatternType,
  type PatternFamilyResult
} from './pattern-family';

// DEPRECATED (2025-11-08): Keyboard walk, keyboard mashing, gibberish detectors
// Replaced with Markov-only detection for higher accuracy (83% vs 67%)
// These exports are commented out to prevent usage. Files remain for reference.
//
// export { detectKeyboardWalk, getKeyboardWalkRiskScore, type KeyboardWalkResult } from './keyboard-walk';
// export { detectKeyboardMashing, getKeyboardMashingRiskScore, type KeyboardMashingResult } from './keyboard-mashing';
// export { detectGibberish } from './ngram-analysis';
//
// If you need these for testing/analysis, import directly from the file:
// import { detectKeyboardWalk } from './detectors/keyboard-walk';

// N-Gram analysis (natural language detection) - PARTIAL DEPRECATION
// detectGibberish is deprecated, but other n-gram utilities remain useful
export {
  analyzeNGramNaturalness,
  getNGramRiskScore,
  containsNamePatterns,
  // detectGibberish, // DEPRECATED - use Markov detection instead
  type NGramAnalysisResult
} from './ngram-analysis';

// Priority 2: Multi-language N-Gram support
export {
  detectLanguage,
  calculateMultilingualScore,
  getLanguageName,
  getCombinedBigrams,
  getCombinedTrigrams,
  LANGUAGE_BIGRAMS,
  LANGUAGE_TRIGRAMS,
  type Language
} from './ngram-multilang';

// TLD risk profiling
export {
  analyzeTLDRisk,
  getTLDCategory,
  isHighRiskTLD,
  isTrustedTLD,
  getHighRiskTLDs,
  getTLDStats,
  type TLDRiskProfile,
  type TLDRiskAnalysis
} from './tld-risk';

// Benford's Law analysis (batch detection)
export {
  analyzeBenfordsLaw,
  isSuspiciousDistribution,
  getBenfordRiskScore,
  compareDistributions,
  formatBenfordAnalysis,
  type BenfordsLawAnalysis
} from './benfords-law';

// ============================================================================
// DEPRECATED: Old Markov Chain (Phase 7) - Replaced by ngram-markov.ts
// ============================================================================
// The old markov-chain.ts implementation has been replaced by ngram-markov.ts
// which uses N-gram based Markov chains trained on 91K+ email samples.
// The old implementation is kept for backwards compatibility but NOT exported.
//
// If you need Markov detection, use NGramMarkovChain from ngram-markov.ts
// ============================================================================
