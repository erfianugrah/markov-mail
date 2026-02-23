/**
 * Pattern Detectors Index (decision-tree reset)
 *
 * The runtime uses these helpers purely to build the feature vector that feeds
 * the JSON decision tree. None of them produce standalone risk scores anymore.
 */

export {
  normalizeEmail,
  detectPlusAddressingAbuse,
  supportsPlusAddressing,
  analyzePlusTagPattern,
  getCanonicalEmail,
  areEmailsEquivalent,
  getPlusAddressingRiskScore,
  type NormalizedEmailResult,
} from './plus-addressing';

export {
  extractPatternFamily,
  analyzePatternFamilies,
  type PatternType,
  type PatternFamilyResult,
} from './pattern-family';

export {
  analyzeNGramNaturalness,
  getNGramRiskScore,
  type NGramAnalysisResult,
} from './ngram-analysis';

export {
  detectLanguage,
  calculateMultilingualScore,
  getLanguageName,
  getCombinedBigrams,
  getCombinedTrigrams,
  LANGUAGE_BIGRAMS,
  LANGUAGE_TRIGRAMS,
  type Language,
} from './ngram-multilang';

export {
  analyzeTLDRisk,
  getTLDCategory,
  isHighRiskTLD,
  isTrustedTLD,
  getHighRiskTLDs,
  getTLDStats,
  type TLDRiskProfile,
  type TLDRiskAnalysis,
} from './tld-risk';

export {
  analyzeBenfordsLaw,
  isSuspiciousDistribution,
  getBenfordRiskScore,
  compareDistributions,
  formatBenfordAnalysis,
  type BenfordsLawAnalysis,
} from './benfords-law';
