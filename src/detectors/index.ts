/**
 * Pattern Detectors Index
 *
 * Central export point for all email pattern detection modules.
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

// Pattern Whitelisting (Priority 2 improvement)
export {
  checkWhitelist,
  loadWhitelistConfig,
  saveWhitelistConfig,
  addWhitelistEntry,
  removeWhitelistEntry,
  updateWhitelistEntry,
  getWhitelistStats,
  DEFAULT_WHITELIST_CONFIG,
  type WhitelistConfig,
  type WhitelistEntry,
  type WhitelistResult,
  type WhitelistPatternType
} from './whitelist';
