/**
 * Pattern Detectors Index
 *
 * Central export point for all email pattern detection modules.
 *
 * ⚠️  SCORING STRATEGY UPDATE (2025-01-03):
 * The fraud detection system now uses a simplified algorithmic approach:
 *
 * PRIMARY SCORING:
 * - Markov Chain cross-entropy (NGramMarkovChain) - Use confidence directly
 *
 * SECONDARY OVERRIDES:
 * - Keyboard Walk detection - Override to 0.9
 * - Sequential patterns - Override to 0.8
 * - Dated patterns - Override to 0.7
 *
 * DOMAIN SIGNALS (additive):
 * - Disposable domains - Base risk 0.95
 * - Domain reputation - Add +0.2
 * - TLD risk - Add +0.1
 *
 * DEPRECATED FOR SCORING (kept for metrics/logging only):
 * - getPatternRiskScore() - Hardcoded rules misclassify legitimate names
 * - getNGramRiskScore() - Returns low values despite high gibberish confidence
 * - Entropy scoring - Cannot distinguish legit from fraud (both ~0.47)
 * - Plus addressing risk - Not seeing significant abuse
 *
 * These deprecated detectors are still exported for backwards compatibility
 * and observability, but should NOT be used in risk score calculations.
 */

// Sequential pattern detection
export {
  detectSequentialPattern,
  getSequentialPatternFamily,
  analyzeSequentialBatch,
  type SequentialPatternResult
} from './sequential';

// Dated pattern detection
export {
  detectDatedPattern,
  getDatedPatternFamily,
  analyzeDatedBatch,
  isCurrentDatePattern,
  type DatedPatternResult
} from './dated';

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

// Keyboard walk detection
export {
  detectKeyboardWalk,
  getKeyboardWalkRiskScore,
  type KeyboardWalkResult
} from './keyboard-walk';

// N-Gram analysis (natural language detection)
export {
  analyzeNGramNaturalness,
  getNGramRiskScore,
  containsNamePatterns,
  detectGibberish,
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

// Markov Chain pattern detection (Phase 7)
export {
  DynamicMarkovChain,
  detectMarkovPattern,
  trainMarkovModels,
  type MarkovResult
} from './markov-chain';
