/**
 * Keyboard Mashing Detector
 *
 * Detects patterns where users type random characters from limited keyboard regions.
 * This is different from keyboard walks (sequential keys) - it catches:
 * - Random typing using only certain keyboard rows
 * - Character clustering in specific keyboard regions
 * - Repeated bigrams that are keyboard-proximate
 *
 * Research basis:
 * - GitHub academia-edu/dejunk
 * - Bigram analysis + keyboard proximity
 * - Character clustering in keyboard regions
 *
 * Examples:
 * - "ioanerstoiartoirtn" → All from Colemak-DH home row
 * - "asdfasdfasdf" → Repeated bigrams from same region
 * - "jkljkljkl" → Limited character set from keyboard region
 */

export interface KeyboardMashingResult {
  isMashing: boolean;
  confidence: number; // 0.0-1.0
  reason: string | null;
  metadata?: {
    regionClustering: number; // % of chars from dominant region
    dominantRegion: string;   // Which keyboard region
    uniqueChars: number;      // Character diversity
    repeatedBigrams: number;  // Count of repeated bigrams
  };
}

// Keyboard layout definitions for region analysis
const KEYBOARD_REGIONS = {
  qwerty: {
    topRow: new Set('qwertyuiop'.split('')),
    homeRow: new Set('asdfghjkl'.split('')),
    bottomRow: new Set('zxcvbnm'.split('')),
  },
  colemak: {
    topRow: new Set('qwfpgjluy'.split('')),
    homeRow: new Set('arstdhneio'.split('')),
    bottomRow: new Set('zxcvbkm'.split('')),
  },
  'colemak-dh': {
    topRow: new Set('qwfpbjluy'.split('')),
    homeRow: new Set('arstgmneio'.split('')),
    bottomRow: new Set('zxcdvkh'.split('')),
  },
  dvorak: {
    topRow: new Set('pyfgcrl'.split('')),
    homeRow: new Set('aoeuidhtns'.split('')),
    bottomRow: new Set('qjkxbmwvz'.split('')),
  },
  workman: {
    topRow: new Set('qdrwbjfup'.split('')),
    homeRow: new Set('ashtgyneoi'.split('')),
    bottomRow: new Set('zxmcvkl'.split('')),
  },
};

/**
 * Detect keyboard mashing patterns
 */
export function detectKeyboardMashing(email: string): KeyboardMashingResult {
  const [localPart] = email.toLowerCase().split('@');

  if (!localPart || localPart.length < 6) {
    return {
      isMashing: false,
      confidence: 0.0,
      reason: null,
    };
  }

  // Remove non-alphabetic chars for analysis
  const letters = localPart.replace(/[^a-z]/g, '');

  if (letters.length < 6) {
    return {
      isMashing: false,
      confidence: 0.0,
      reason: null,
    };
  }

  // Check 1: Region clustering analysis
  const regionAnalysis = analyzeRegionClustering(letters);

  // Check 2: Character diversity (low diversity = mashing)
  const uniqueChars = new Set(letters.split('')).size;
  const diversity = uniqueChars / letters.length;

  // Check 3: Repeated bigram analysis
  const repeatedBigrams = countRepeatedBigrams(letters);

  // Check 4: Vowel-consonant alternation (natural language tends to alternate)
  const vowels = new Set(['a', 'e', 'i', 'o', 'u']);
  const vowelCount = letters.split('').filter(c => vowels.has(c)).length;
  const vowelRatio = vowelCount / letters.length;

  // Check 5: Consecutive keyboard keys (even if not enough for keyboard walk)
  const hasConsecutiveKeys = hasAdjacentKeyboardSequence(letters, regionAnalysis.layout);

  // Decision logic: Multi-signal approach
  let isMashing = false;
  let confidence = 0.0;
  let reason = null;

  // Score different indicators (0-1 each)
  const indicators = {
    highClustering: regionAnalysis.clustering > 0.8 ? 1.0 : regionAnalysis.clustering > 0.7 ? 0.7 : 0,
    lowDiversity: diversity < 0.5 ? 1.0 : diversity < 0.6 ? 0.6 : 0,
    repeatedBigrams: repeatedBigrams > 3 ? 1.0 : repeatedBigrams > 1 ? 0.5 : 0,
    unnaturalVowels: (vowelRatio < 0.2 || vowelRatio > 0.7) ? 0.8 : 0, // Too few or too many vowels
    consecutiveKeys: hasConsecutiveKeys ? 0.9 : 0
  };

  // Calculate weighted confidence
  const totalIndicators = Object.values(indicators).filter(v => v > 0).length;
  const averageStrength = Object.values(indicators).reduce((a, b) => a + b, 0) / Math.max(totalIndicators, 1);

  // Detection criteria:
  // - Need at least 2 strong indicators
  // - OR 3+ moderate indicators
  // - AND high clustering (>70%) as primary requirement

  if (regionAnalysis.clustering > 0.7) {
    if (totalIndicators >= 3 || (totalIndicators >= 2 && averageStrength > 0.7)) {
      isMashing = true;
      confidence = Math.min(0.95, averageStrength * regionAnalysis.clustering * 1.1);
      reason = `${Math.round(regionAnalysis.clustering * 100)}% chars from ${regionAnalysis.layout} ${regionAnalysis.region}`;

      // Add context about why it was detected
      const reasons = [];
      if (indicators.consecutiveKeys) reasons.push('consecutive keys');
      if (indicators.repeatedBigrams) reasons.push('repeated patterns');
      if (indicators.unnaturalVowels) reasons.push('unnatural vowel ratio');
      if (reasons.length > 0) {
        reason += ` (${reasons.join(', ')})`;
      }
    }
  }

  return {
    isMashing,
    confidence,
    reason,
    metadata: {
      regionClustering: Math.round(regionAnalysis.clustering * 100) / 100,
      dominantRegion: `${regionAnalysis.layout} ${regionAnalysis.region}`,
      uniqueChars,
      repeatedBigrams,
    },
  };
}

/**
 * Analyze clustering of characters in keyboard regions
 */
function analyzeRegionClustering(text: string): {
  clustering: number;
  layout: string;
  region: string;
} {
  let maxClustering = 0;
  let bestLayout = 'unknown';
  let bestRegion = 'unknown';

  const chars = text.split('');
  const totalChars = chars.length;

  // Check each keyboard layout and region
  for (const [layoutName, regions] of Object.entries(KEYBOARD_REGIONS)) {
    for (const [regionName, regionChars] of Object.entries(regions)) {
      // Count how many characters are in this region
      const matchCount = chars.filter((c) => regionChars.has(c)).length;
      const clustering = matchCount / totalChars;

      if (clustering > maxClustering) {
        maxClustering = clustering;
        bestLayout = layoutName;
        bestRegion = regionName;
      }
    }
  }

  return {
    clustering: maxClustering,
    layout: bestLayout,
    region: bestRegion,
  };
}

/**
 * Count repeated bigrams (pairs of characters)
 * Keyboard mashing often creates repeated patterns
 */
function countRepeatedBigrams(text: string): number {
  const bigrams = new Map<string, number>();

  // Extract all bigrams
  for (let i = 0; i < text.length - 1; i++) {
    const bigram = text.substring(i, i + 2);
    bigrams.set(bigram, (bigrams.get(bigram) || 0) + 1);
  }

  // Count bigrams that appear 2+ times
  let repeatedCount = 0;
  for (const count of bigrams.values()) {
    if (count >= 2) {
      repeatedCount++;
    }
  }

  return repeatedCount;
}

/**
 * Check if text contains adjacent keyboard keys (3+ consecutive)
 * E.g., "asdf", "qwer", "hjkl"
 */
function hasAdjacentKeyboardSequence(text: string, layoutName: string): boolean {
  const layouts = KEYBOARD_REGIONS;

  // Check all layouts (not just the dominant one)
  for (const [name, regions] of Object.entries(layouts)) {
    for (const regionChars of Object.values(regions)) {
      const regionString = Array.from(regionChars).join('');

      // Check for 3+ consecutive chars from this region
      for (let i = 0; i <= regionString.length - 3; i++) {
        const sequence = regionString.substring(i, i + 3);
        if (text.includes(sequence)) {
          return true;
        }

        // Check reversed
        const reversed = sequence.split('').reverse().join('');
        if (text.includes(reversed)) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Get risk score contribution from keyboard mashing
 */
export function getKeyboardMashingRiskScore(result: KeyboardMashingResult): number {
  if (!result.isMashing) {
    return 0.0;
  }

  // Base risk from confidence
  let risk = result.confidence * 0.6;

  // High clustering is very suspicious
  if (result.metadata && result.metadata.regionClustering > 0.8) {
    risk += 0.3;
  }

  // Low character diversity amplifies risk
  if (result.metadata && result.metadata.uniqueChars < 8) {
    risk += 0.1;
  }

  return Math.min(risk, 1.0);
}
