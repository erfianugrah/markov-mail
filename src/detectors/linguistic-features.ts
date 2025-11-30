import { calculateEntropy } from '../validators/email';

const BASE_VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);
const SEMI_VOWEL = 'y';
const DIPHTHONG_HELPER = 'w';
const WORD_BOUNDARY_REGEX = /[._-]/;
const LETTER_REGEX = /[a-z]/;
const DIGIT_REGEX = /[0-9]/;

const COMMON_CONSONANT_CLUSTERS = new Set([
  'sch',
  'schw',
  'shr',
  'spl',
  'spr',
  'scr',
  'str',
  'scl',
  'thr',
  'phr',
  'chr',
  'ght',
  'tch',
  'nch',
  'ngh',
  'nth',
  'ndr',
  'ngr',
]);

export interface LinguisticFeatureSignals {
  pronounceability: number;
  vowelRatio: number;
  consonantRatio: number;
  vowelCount: number;
  consonantCount: number;
  hasVowel: boolean;
  maxConsonantCluster: number;
  maxVowelCluster: number;
  maxRepeatedCharRun: number;
  repeatedCharRatio: number;
  syllableEstimate: number;
  impossibleClusterCount: number;
  hasImpossibleCluster: boolean;
}

export interface StructureFeatureSignals {
  hasWordBoundaries: boolean;
  segmentCount: number;
  avgSegmentLength: number;
  longestSegmentLength: number;
  shortestSegmentLength: number;
  segmentsWithoutVowelsRatio: number;
}

export interface StatisticalFeatureSignals {
  length: number;
  digitCount: number;
  digitRatio: number;
  maxDigitRun: number;
  symbolCount: number;
  symbolRatio: number;
  uniqueCharRatio: number;
  entropy: number;
  vowelGapRatio: number;
  bigramEntropy: number;
}

export interface LocalPartFeatureSignals {
  linguistic: LinguisticFeatureSignals;
  structure: StructureFeatureSignals;
  statistical: StatisticalFeatureSignals;
}

const EMPTY_FEATURES: LocalPartFeatureSignals = {
  linguistic: {
    pronounceability: 0,
    vowelRatio: 0,
    consonantRatio: 0,
    vowelCount: 0,
    consonantCount: 0,
    hasVowel: false,
    maxConsonantCluster: 0,
    maxVowelCluster: 0,
    maxRepeatedCharRun: 0,
    repeatedCharRatio: 0,
    syllableEstimate: 0,
    impossibleClusterCount: 0,
    hasImpossibleCluster: false,
  },
  structure: {
    hasWordBoundaries: false,
    segmentCount: 0,
    avgSegmentLength: 0,
    longestSegmentLength: 0,
    shortestSegmentLength: 0,
    segmentsWithoutVowelsRatio: 0,
  },
  statistical: {
    length: 0,
    digitCount: 0,
    digitRatio: 0,
    maxDigitRun: 0,
    symbolCount: 0,
    symbolRatio: 0,
    uniqueCharRatio: 0,
    entropy: 0,
    vowelGapRatio: 0,
    bigramEntropy: 0,
  },
};

function cloneEmptyFeatures(): LocalPartFeatureSignals {
  return {
    linguistic: { ...EMPTY_FEATURES.linguistic },
    structure: { ...EMPTY_FEATURES.structure },
    statistical: { ...EMPTY_FEATURES.statistical },
  };
}

interface CharacterFlags {
  isLetter: boolean;
  isVowel: boolean;
  isConsonant: boolean;
  isDigit: boolean;
  isSymbol: boolean;
}

/**
 * Calculate Bigram (Transition) Entropy
 * Language-agnostic measure of structural predictability
 * Higher entropy = more random/unpredictable character transitions (suspicious)
 * Lower entropy = more predictable patterns (natural language)
 */
function calculateTransitionEntropy(text: string): number {
  if (text.length < 2) {
    return 0;
  }

  const bigrams = new Map<string, number>();
  let totalTransitions = 0;

  for (let i = 0; i < text.length - 1; i++) {
    const pair = text.substring(i, i + 2).toLowerCase();
    bigrams.set(pair, (bigrams.get(pair) || 0) + 1);
    totalTransitions++;
  }

  let entropy = 0;
  for (const count of bigrams.values()) {
    const p = count / totalTransitions;
    entropy -= p * Math.log2(p);
  }

  return entropy;
}

export function extractLocalPartFeatureSignals(localPartInput: string | null | undefined): LocalPartFeatureSignals {
  const localPart = (localPartInput || '').trim();
  if (!localPart) {
    return cloneEmptyFeatures();
  }

  const lower = localPart.toLowerCase();
  const length = lower.length;

  let vowelCount = 0;
  let consonantCount = 0;
  let digitCount = 0;
  let symbolCount = 0;

  let maxVowelRun = 0;
  let maxConsonantRun = 0;
  let maxDigitRun = 0;
  let maxRepeatRun = 0;

  let currentVowelRun = 0;
  let currentConsonantRun = 0;
  let currentDigitRun = 0;
  let currentRepeatRun = 0;
  let repeatPositions = 0;

  let consonantCluster = '';
  let impossibleClusterCount = 0;

  const uniqueChars = new Set<string>();

  for (let i = 0; i < length; i++) {
    const char = lower[i];
    const prev = i > 0 ? lower[i - 1] : undefined;
    const next = i < length - 1 ? lower[i + 1] : undefined;
    const flags = classifyChar(char, prev, next);

    uniqueChars.add(char);

    if (flags.isDigit) {
      digitCount++;
      currentDigitRun++;
      maxDigitRun = Math.max(maxDigitRun, currentDigitRun);
    } else {
      currentDigitRun = 0;
    }

    if (flags.isSymbol) {
      symbolCount++;
    }

    if (flags.isVowel) {
      vowelCount++;
      currentVowelRun++;
      maxVowelRun = Math.max(maxVowelRun, currentVowelRun);
      // Reset consonant tracking when vowel appears
      if (consonantCluster.length >= 3 && !isAllowedConsonantCluster(consonantCluster)) {
        impossibleClusterCount++;
      }
      consonantCluster = '';
      currentConsonantRun = 0;
    } else if (flags.isConsonant) {
      consonantCount++;
      currentConsonantRun++;
      maxConsonantRun = Math.max(maxConsonantRun, currentConsonantRun);
      consonantCluster += char;
      currentVowelRun = 0;
    } else {
      if (consonantCluster.length >= 3 && !isAllowedConsonantCluster(consonantCluster)) {
        impossibleClusterCount++;
      }
      consonantCluster = '';
      currentConsonantRun = 0;
      currentVowelRun = 0;
    }

    if (i === length - 1 && consonantCluster.length >= 3 && !isAllowedConsonantCluster(consonantCluster)) {
      impossibleClusterCount++;
    }

    if (i === 0 || char !== lower[i - 1]) {
      currentRepeatRun = 1;
    } else {
      currentRepeatRun += 1;
      repeatPositions += 1;
    }
    maxRepeatRun = Math.max(maxRepeatRun, currentRepeatRun);
  }

  const segments = splitSegments(localPart);
  const segmentCount = segments.length;
  const longestSegment = segments.reduce((max, seg) => Math.max(max, seg.length), 0);
  const shortestSegment = segments.reduce((min, seg) => Math.min(min, seg.length), segmentCount > 0 ? segments[0].length : 0);
  const segmentsWithoutVowels = segments.filter((segment) => !/[aeiouy]/i.test(segment)).length;
  const segmentsWithoutVowelsRatio = segmentCount > 0 ? segmentsWithoutVowels / segmentCount : 0;
  const avgSegmentLength = segmentCount > 0 ? localPart.length / segmentCount : 0;

  const lengthSafe = Math.max(length, 1);
  const letterCount = vowelCount + consonantCount;
  const letterSafe = Math.max(letterCount, 1);

  const vowelRatio = vowelCount / letterSafe;
  const consonantRatio = consonantCount / letterSafe;

  const digitRatio = digitCount / lengthSafe;
  const symbolRatio = symbolCount / lengthSafe;
  const repeatedCharRatio = repeatPositions / lengthSafe;
  const uniqueCharRatio = uniqueChars.size / lengthSafe;
  const vowelGapRatio = letterCount > 0 ? maxConsonantRun / letterCount : 0;

  const entropy = calculateEntropy(localPart);

  const pronounceability = calculatePronounceability({
    vowelRatio,
    maxConsonantCluster: maxConsonantRun,
    maxRepeatedCharRun: maxRepeatRun,
    digitRatio,
    symbolRatio,
    hasWordBoundaries: WORD_BOUNDARY_REGEX.test(localPart),
    impossibleClusterCount,
    segmentsWithoutVowelsRatio,
  });

  return {
    linguistic: {
      pronounceability,
      vowelRatio,
      consonantRatio,
      vowelCount,
      consonantCount,
      hasVowel: vowelCount > 0,
      maxConsonantCluster: maxConsonantRun,
      maxVowelCluster: maxVowelRun,
      maxRepeatedCharRun: maxRepeatRun,
      repeatedCharRatio,
      syllableEstimate: estimateSyllables(lower),
      impossibleClusterCount,
      hasImpossibleCluster: impossibleClusterCount > 0,
    },
    structure: {
      hasWordBoundaries: WORD_BOUNDARY_REGEX.test(localPart),
      segmentCount,
      avgSegmentLength,
      longestSegmentLength: longestSegment,
      shortestSegmentLength: shortestSegment || 0,
      segmentsWithoutVowelsRatio,
    },
    statistical: {
      length,
      digitCount,
      digitRatio,
      maxDigitRun,
      symbolCount,
      symbolRatio,
      uniqueCharRatio,
      entropy,
      vowelGapRatio,
      bigramEntropy: calculateTransitionEntropy(lower),
    },
  };
}

function classifyChar(char: string, prev?: string, next?: string): CharacterFlags {
  if (DIGIT_REGEX.test(char)) {
    return {
      isLetter: false,
      isVowel: false,
      isConsonant: false,
      isDigit: true,
      isSymbol: false,
    };
  }

  if (!LETTER_REGEX.test(char)) {
    return {
      isLetter: false,
      isVowel: false,
      isConsonant: false,
      isDigit: false,
      isSymbol: true,
    };
  }

  if (BASE_VOWELS.has(char)) {
    return {
      isLetter: true,
      isVowel: true,
      isConsonant: false,
      isDigit: false,
      isSymbol: false,
    };
  }

  if (char === SEMI_VOWEL) {
    const prevLetter = prev && LETTER_REGEX.test(prev);
    const nextLetter = next && LETTER_REGEX.test(next);
    const prevVowel = prev ? BASE_VOWELS.has(prev) : false;
    const nextVowel = next ? BASE_VOWELS.has(next) : false;
    const treatAsVowel = (!prevLetter || prevVowel === false) && (!nextLetter || nextVowel === false);
    return {
      isLetter: true,
      isVowel: treatAsVowel,
      isConsonant: !treatAsVowel,
      isDigit: false,
      isSymbol: false,
    };
  }

  if (char === DIPHTHONG_HELPER) {
    const nextIsVowel = next ? BASE_VOWELS.has(next) : false;
    return {
      isLetter: true,
      isVowel: nextIsVowel,
      isConsonant: !nextIsVowel,
      isDigit: false,
      isSymbol: false,
    };
  }

  return {
    isLetter: true,
    isVowel: false,
    isConsonant: true,
    isDigit: false,
    isSymbol: false,
  };
}

function isAllowedConsonantCluster(cluster: string): boolean {
  const normalized = cluster.toLowerCase();
  if (normalized.length <= 2) {
    return true;
  }
  if (COMMON_CONSONANT_CLUSTERS.has(normalized)) {
    return true;
  }
  for (const allowed of COMMON_CONSONANT_CLUSTERS) {
    if (normalized.includes(allowed)) {
      return true;
    }
  }
  return false;
}

function splitSegments(localPart: string): string[] {
  if (!localPart) {
    return [];
  }
  const parts = localPart.split(/[._-]+/).filter(Boolean);
  if (parts.length === 0) {
    return [localPart];
  }
  return parts;
}

function estimateSyllables(localPart: string): number {
  if (!localPart) {
    return 0;
  }
  const tokens = localPart.replace(/[^a-z]/g, ' ').split(/\s+/).filter(Boolean);
  let syllables = 0;
  for (const token of tokens) {
    let tokenSyllables = 0;
    let prevWasVowel = false;
    for (let i = 0; i < token.length; i++) {
      const char = token[i];
      const next = i < token.length - 1 ? token[i + 1] : undefined;
      const flags = classifyChar(char, token[i - 1], next);
      if (flags.isVowel) {
        if (!prevWasVowel) {
          tokenSyllables++;
        }
        prevWasVowel = true;
      } else {
        prevWasVowel = false;
      }
    }
    if (tokenSyllables === 0 && token.length > 0) {
      tokenSyllables = 1;
    }
    syllables += tokenSyllables;
  }
  return syllables;
}

function calculatePronounceability(params: {
  vowelRatio: number;
  maxConsonantCluster: number;
  maxRepeatedCharRun: number;
  digitRatio: number;
  symbolRatio: number;
  hasWordBoundaries: boolean;
  impossibleClusterCount: number;
  segmentsWithoutVowelsRatio: number;
}): number {
  const {
    vowelRatio,
    maxConsonantCluster,
    maxRepeatedCharRun,
    digitRatio,
    symbolRatio,
    hasWordBoundaries,
    impossibleClusterCount,
    segmentsWithoutVowelsRatio,
  } = params;

  const consonantPenalty = Math.max(0, (maxConsonantCluster - 2) / 10);
  const repetitionPenalty = Math.max(0, (maxRepeatedCharRun - 2) / 12);
  const digitPenalty = digitRatio * 0.6;
  const symbolPenalty = symbolRatio * 0.5;
  const impossiblePenalty = Math.min(1, impossibleClusterCount * 0.2);
  const vowellessPenalty = segmentsWithoutVowelsRatio * 0.5;

  let score = vowelRatio * 0.55 + (1 - (consonantPenalty + repetitionPenalty + digitPenalty + symbolPenalty + impossiblePenalty + vowellessPenalty)) * 0.45;
  if (hasWordBoundaries) {
    score += 0.05;
  }
  return clamp(score, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}
