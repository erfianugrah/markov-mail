/**
 * Benford's Law Analysis for Batch Attack Detection
 *
 * Benford's Law states that in many naturally occurring datasets,
 * the leading digit is likely to be small. For example, in sets that
 * obey the law, the number 1 appears as the leading digit about 30%
 * of the time, while 9 appears as the leading digit less than 5% of the time.
 *
 * Theory: Automated/sequential email generation produces uniform digit
 * distribution, while natural registrations follow Benford's Law.
 *
 * Application:
 * - Natural: user{1,11,2,23,3,7,12,...} → Benford distribution
 * - Bot: user{1,2,3,4,5,6,7,8,9,10} → Uniform distribution
 */

/**
 * Benford's Law expected distribution for first digits (1-9)
 * Index 0 is unused (no leading zeros in natural numbers)
 * P(d) = log10(1 + 1/d)
 */
const BENFORD_DISTRIBUTION = [
  0,      // 0 - not used (no leading zeros)
  0.301,  // 1 - 30.1%
  0.176,  // 2 - 17.6%
  0.125,  // 3 - 12.5%
  0.097,  // 4 - 9.7%
  0.079,  // 5 - 7.9%
  0.067,  // 6 - 6.7%
  0.058,  // 7 - 5.8%
  0.051,  // 8 - 5.1%
  0.046,  // 9 - 4.6%
];

/**
 * Chi-Square critical values for goodness-of-fit test
 * df = 8 (9 digits - 1)
 */
const CHI_SQUARE_CRITICAL_VALUES = {
  '0.10': 13.362, // 10% significance (90% confidence)
  '0.05': 15.507, // 5% significance (95% confidence)
  '0.01': 20.090, // 1% significance (99% confidence)
};

export interface BenfordsLawAnalysis {
  followsBenford: boolean;
  confidence: number;
  chiSquare: number;
  pValue: number;
  distribution: number[];
  expectedDistribution: number[];
  sampleSize: number;
  deviation: number;
}

/**
 * Extract first digits from email local parts
 */
function extractFirstDigits(emails: string[]): number[] {
  const digits: number[] = [];

  for (const email of emails) {
    const localPart = email.split('@')[0];

    // Extract all numbers from local part
    const numbers = localPart.match(/\d+/g);

    if (numbers) {
      for (const num of numbers) {
        const firstDigit = parseInt(num[0], 10);
        if (firstDigit > 0) {  // Skip leading zeros
          digits.push(firstDigit);
        }
      }
    }
  }

  return digits;
}

/**
 * Calculate observed distribution
 */
function calculateDistribution(digits: number[]): number[] {
  const counts = new Array(10).fill(0);

  for (const digit of digits) {
    if (digit >= 0 && digit <= 9) {
      counts[digit]++;
    }
  }

  // Convert to probabilities
  const total = digits.length;
  return counts.map(count => total > 0 ? count / total : 0);
}

/**
 * Chi-square goodness of fit test
 */
function chiSquareTest(observed: number[], expected: number[], n: number): number {
  let chiSquare = 0;

  // Test digits 1-9 (skip 0)
  for (let i = 1; i <= 9; i++) {
    const obs = observed[i] * n;  // Convert probability back to count
    const exp = expected[i] * n;

    if (exp > 0) {
      chiSquare += Math.pow(obs - exp, 2) / exp;
    }
  }

  return chiSquare;
}

/**
 * Convert chi-square to approximate p-value using Wilson-Hilferty approximation.
 *
 * M9 fix: the old 4-step function returned only 4 discrete values (0.10, 0.05,
 * 0.01, 0.001), discarding almost all statistical information. This continuous
 * approximation preserves the full signal for downstream scoring.
 *
 * Uses the Wilson-Hilferty normal approximation to the chi-squared CDF:
 *   z = ((x/df)^(1/3) - (1 - 2/(9*df))) / sqrt(2/(9*df))
 * then converts z to a p-value using a rational approximation to erfc.
 */
function chiSquareToPValue(chiSquare: number, df: number = 8): number {
  if (chiSquare <= 0) return 1.0;
  if (df <= 0) return 0;

  // Wilson-Hilferty transformation to standard normal
  const k = df;
  const cube = Math.pow(chiSquare / k, 1 / 3);
  const mu = 1 - 2 / (9 * k);
  const sigma = Math.sqrt(2 / (9 * k));

  if (sigma === 0) return chiSquare > df ? 0 : 1;

  const z = (cube - mu) / sigma;

  // Approximate upper-tail probability P(Z > z) using Abramowitz & Stegun 26.2.17
  // Accurate to ~1.5e-7 for all z
  if (z < -8) return 1.0;
  if (z > 8) return 0.0;

  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327; // 1/sqrt(2*pi)
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const phi = d * Math.exp(-0.5 * z * z) * poly;

  return z >= 0 ? phi : 1 - phi;
}

/**
 * Analyze emails for Benford's Law compliance
 *
 * @param emails - Array of email addresses
 * @param significanceLevel - Alpha level for test (default 0.05 = 95% confidence)
 * @returns Analysis result
 */
export function analyzeBenfordsLaw(
  emails: string[],
  significanceLevel: number = 0.05
): BenfordsLawAnalysis {
  // Extract first digits
  const digits = extractFirstDigits(emails);
  const sampleSize = digits.length;

  // Need reasonable sample size for statistical test
  if (sampleSize < 30) {
    return {
      followsBenford: false,
      confidence: 0,
      chiSquare: 0,
      pValue: 1.0,
      distribution: new Array(10).fill(0),
      expectedDistribution: BENFORD_DISTRIBUTION,
      sampleSize,
      deviation: 0,
    };
  }

  // Calculate observed distribution
  const observedDist = calculateDistribution(digits);

  // Chi-square goodness of fit test
  const chiSquare = chiSquareTest(observedDist, BENFORD_DISTRIBUTION, sampleSize);
  const pValue = chiSquareToPValue(chiSquare);

  // Determine if follows Benford's Law
  const criticalValue = CHI_SQUARE_CRITICAL_VALUES[significanceLevel.toString() as keyof typeof CHI_SQUARE_CRITICAL_VALUES]
    || CHI_SQUARE_CRITICAL_VALUES['0.05'];

  const followsBenford = chiSquare < criticalValue;

  // Calculate confidence (inverse of normalized chi-square)
  const maxChiSquare = 50; // Practical maximum
  const confidence = followsBenford
    ? Math.max(0, 1 - (chiSquare / criticalValue))
    : 0;

  // Calculate average deviation from expected
  let totalDeviation = 0;
  for (let i = 1; i <= 9; i++) {
    totalDeviation += Math.abs(observedDist[i] - BENFORD_DISTRIBUTION[i]);
  }
  const deviation = totalDeviation / 9;

  return {
    followsBenford,
    confidence,
    chiSquare,
    pValue,
    distribution: observedDist,
    expectedDistribution: BENFORD_DISTRIBUTION,
    sampleSize,
    deviation,
  };
}

/**
 * Quick check if distribution is suspicious (likely bot)
 */
export function isSuspiciousDistribution(emails: string[]): boolean {
  if (emails.length < 30) return false;

  const analysis = analyzeBenfordsLaw(emails);

  // High chi-square = doesn't follow Benford = likely automated
  return !analysis.followsBenford && analysis.deviation > 0.1;
}

/**
 * Analyze with risk score
 */
export function getBenfordRiskScore(emails: string[]): {
  riskScore: number;
  analysis: BenfordsLawAnalysis;
  isAutomated: boolean;
} {
  const analysis = analyzeBenfordsLaw(emails);

  // Can't determine for small samples
  if (analysis.sampleSize < 30) {
    return {
      riskScore: 0,
      analysis,
      isAutomated: false,
    };
  }

  // Calculate risk score based on deviation from Benford
  // Higher deviation = higher risk
  let riskScore = 0;

  if (!analysis.followsBenford) {
    // Normalize chi-square to 0-1 range
    const normalizedChiSquare = Math.min(analysis.chiSquare / 30, 1.0);
    riskScore = normalizedChiSquare;
  }

  // Consider deviation as well
  riskScore = Math.max(riskScore, analysis.deviation * 2);
  riskScore = Math.min(riskScore, 1.0);

  const isAutomated = riskScore > 0.7;

  return {
    riskScore,
    analysis,
    isAutomated,
  };
}

/**
 * Compare two distributions
 */
export function compareDistributions(emails1: string[], emails2: string[]): {
  areSimilar: boolean;
  similarity: number;
  analysis1: BenfordsLawAnalysis;
  analysis2: BenfordsLawAnalysis;
} {
  const analysis1 = analyzeBenfordsLaw(emails1);
  const analysis2 = analyzeBenfordsLaw(emails2);

  // Calculate similarity using cosine similarity of distributions
  let dotProduct = 0;
  let magnitude1 = 0;
  let magnitude2 = 0;

  for (let i = 1; i <= 9; i++) {
    dotProduct += analysis1.distribution[i] * analysis2.distribution[i];
    magnitude1 += analysis1.distribution[i] ** 2;
    magnitude2 += analysis2.distribution[i] ** 2;
  }

  const similarity = magnitude1 > 0 && magnitude2 > 0
    ? dotProduct / (Math.sqrt(magnitude1) * Math.sqrt(magnitude2))
    : 0;

  const areSimilar = similarity > 0.9; // >90% similar

  return {
    areSimilar,
    similarity,
    analysis1,
    analysis2,
  };
}

/**
 * Format analysis for logging/display
 */
export function formatBenfordAnalysis(analysis: BenfordsLawAnalysis): string {
  const status = analysis.followsBenford ? '✓ FOLLOWS' : '✗ VIOLATES';

  const lines: string[] = [
    `Benford's Law Analysis: ${status}`,
    `Sample Size: ${analysis.sampleSize}`,
    `Chi-Square: ${analysis.chiSquare.toFixed(2)}`,
    `P-Value: ${analysis.pValue.toFixed(3)}`,
    `Confidence: ${(analysis.confidence * 100).toFixed(1)}%`,
    `Deviation: ${(analysis.deviation * 100).toFixed(1)}%`,
    '',
    'Distribution (Observed vs Expected):',
  ];

  for (let i = 1; i <= 9; i++) {
    const obs = (analysis.distribution[i] * 100).toFixed(1);
    const exp = (analysis.expectedDistribution[i] * 100).toFixed(1);
    const diff = (analysis.distribution[i] - analysis.expectedDistribution[i]) * 100;
    const diffStr = (diff >= 0 ? '+' : '') + diff.toFixed(1);

    lines.push(`  ${i}: ${obs}% vs ${exp}% (${diffStr}%)`);
  }

  return lines.join('\n');
}
