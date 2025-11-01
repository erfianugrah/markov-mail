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
