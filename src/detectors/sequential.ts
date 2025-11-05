/**
 * Sequential Pattern Detector
 *
 * Detects email patterns with sequential numbering like:
 * - user1@gmail.com, user2@gmail.com, user3@gmail.com
 * - john.doe.001@yahoo.com, john.doe.002@yahoo.com
 * - test_account_456@outlook.com
 *
 * These patterns are common in automated account creation.
 */

export interface SequentialPatternResult {
  isSequential: boolean;
  basePattern: string;    // "user" from "user123"
  sequence: number | null; // 123 or null if not sequential
  confidence: number;     // 0.0-1.0
  metadata?: {
    hasLeadingZeros: boolean;  // "001" vs "1"
    sequenceLength: number;    // Number of digits
    totalLength: number;       // Total local part length
  };
}

/**
 * Helper: Check if a digit string contains a plausible birth year (1940-2025)
 * Returns the year if found, null otherwise
 */
function extractBirthYear(digits: string): number | null {
  const currentYear = new Date().getFullYear();

  // Check for 4-digit years within the string
  for (let i = 0; i <= digits.length - 4; i++) {
    const yearStr = digits.substring(i, i + 4);
    const year = parseInt(yearStr, 10);
    const yearAge = currentYear - year;

    // Plausible birth year: 13-100 years old
    if (year >= 1940 && year <= currentYear && yearAge >= 13 && yearAge <= 100) {
      return year;
    }
  }

  return null;
}

/**
 * Detects if an email follows a sequential numbering pattern
 */
export function detectSequentialPattern(email: string): SequentialPatternResult {
  const normalizedEmail = email.toLowerCase().trim();
  const [localPart] = normalizedEmail.split('@');

  if (!localPart || localPart.length < 2) {
    return {
      isSequential: false,
      basePattern: localPart || '',
      sequence: null,
      confidence: 0.0
    };
  }

  // Pattern 1: Trailing numbers (most common)
  // Examples: user123, john.doe.456, test_account_001
  const trailingNumberMatch = localPart.match(/^(.+?)(\d+)$/);

  if (trailingNumberMatch) {
    const [, base, numberStr] = trailingNumberMatch;
    const sequence = parseInt(numberStr, 10);

    // EXCEPTION 1: Check if it contains a birth year (4 digits, plausible range)
    // Birth years should NOT be flagged as sequential patterns
    // Handles both exact 4-digit years AND longer patterns like "198807" (year+month), "198145" (year+number)
    const birthYear = extractBirthYear(numberStr);
    if (birthYear !== null) {
      // This contains a plausible birth year, likely legitimate
      return {
        isSequential: false,
        basePattern: localPart,
        sequence: null,
        confidence: 0.0
      };
    }

    // EXCEPTION 2: Small memorable numbers (1-3 digits, not years)
    // alice42@, bob007@, user1@ vs user123@
    // Very short numbers (<= 3 digits) are too ambiguous to confidently flag
    // UNLESS they have leading zeros (001, 007) or common sequential bases (user, test)
    const hasLeadingZeros = numberStr.length > 1 && numberStr[0] === '0';

    if (numberStr.length <= 3 && base.length >= 4 && !hasLeadingZeros) {
      // Check if base contains common sequential patterns
      const commonBases = [
        'test', 'user', 'account', 'email', 'temp', 'demo', 'admin', 'guest',
        'trial', 'sample', 'hello', 'service', 'team'
      ];
      const hasCommonBase = commonBases.some(common => base.includes(common));

      // If it's a normal name + small number (no leading zeros), likely memorable/personal
      if (!hasCommonBase) {
        return {
          isSequential: false,
          basePattern: localPart,
          sequence: null,
          confidence: 0.0
        };
      }
    }

    // Now continue with normal sequential detection
    const sequenceLength = numberStr.length;

    // Calculate confidence based on several factors
    let confidence = 0.0;

    // Factor 1: Sequence length (longer sequences are more suspicious)
    // Enhanced scoring for single-digit sequences with common bases
    if (sequenceLength === 1) {
      confidence += 0.25; // Increased from 0.2
    } else if (sequenceLength === 2) {
      confidence += 0.35; // Increased from 0.3
    } else if (sequenceLength === 3) {
      confidence += 0.5;
    } else {
      confidence += 0.7;
    }

    // Factor 2: Leading zeros indicate sequential generation
    // user001, user002 is very suspicious
    if (hasLeadingZeros) {
      confidence += 0.3;
    }

    // Factor 3: Base pattern quality
    // Short base with long sequence is suspicious
    const baseLength = base.length;
    const ratio = sequenceLength / localPart.length;

    if (ratio > 0.5) {
      // More than half is numbers: very suspicious
      confidence += 0.2;
    } else if (ratio > 0.3) {
      confidence += 0.1;
    }

    // Factor 4: Very short base patterns are suspicious
    // "a123", "x456"
    if (baseLength === 1 && sequenceLength >= 2) {
      confidence += 0.2;
    }

    // Factor 5: Common sequential patterns in base
    // test, user, account, email, trial, etc.
    // Enhanced list and higher score for these patterns
    const commonBases = [
      'test', 'user', 'account', 'email', 'temp', 'demo', 'admin', 'guest',
      'trial', 'sample', 'hello', 'service', 'team', 'info', 'support'
    ];
    if (commonBases.some(common => base.includes(common))) {
      confidence += 0.25; // Increased from 0.15
    }

    // Factor 6: Single-letter bases (user_a, test_b)
    // Check for letter sequential patterns
    if (baseLength >= 3 && /^[a-z]+$/.test(base)) {
      // Word followed by single letter is suspicious
      const letterMatch = localPart.match(/^([a-z]{3,})[._-]([a-z])$/);
      if (letterMatch) {
        confidence += 0.2;
      }
    }

    // Cap at 1.0
    confidence = Math.min(confidence, 1.0);

    // Consider it sequential if confidence > 0.4 (lowered from 0.5)
    // This allows catching more simple sequential patterns
    const isSequential = confidence >= 0.4;

    return {
      isSequential,
      basePattern: base,
      sequence,
      confidence,
      metadata: {
        hasLeadingZeros,
        sequenceLength,
        totalLength: localPart.length
      }
    };
  }

  // Pattern 2: Numbers in the middle with separators
  // Examples: user.123.test, account_456_temp
  const middleNumberMatch = localPart.match(/^(.+?)[._-](\d+)[._-](.+)$/);

  if (middleNumberMatch) {
    const [, prefix, numberStr, suffix] = middleNumberMatch;
    const sequence = parseInt(numberStr, 10);
    const sequenceLength = numberStr.length;

    // Lower confidence for middle numbers (less common pattern)
    let confidence = 0.3;

    if (sequenceLength >= 3) {
      confidence += 0.2;
    }

    const hasLeadingZeros = numberStr.length > 1 && numberStr[0] === '0';
    if (hasLeadingZeros) {
      confidence += 0.2;
    }

    const isSequential = confidence >= 0.4; // Lowered from 0.5
    const basePattern = `${prefix}.[NUM].${suffix}`;

    return {
      isSequential,
      basePattern,
      sequence,
      confidence,
      metadata: {
        hasLeadingZeros,
        sequenceLength,
        totalLength: localPart.length
      }
    };
  }

  // No sequential pattern detected
  return {
    isSequential: false,
    basePattern: localPart,
    sequence: null,
    confidence: 0.0
  };
}

/**
 * Extract a normalized pattern family string for sequential patterns
 * This allows grouping similar emails: user1, user2, user3 → "user[NUM]"
 */
export function getSequentialPatternFamily(email: string): string | null {
  const result = detectSequentialPattern(email);

  if (!result.isSequential) {
    return null;
  }

  const [, domain] = email.toLowerCase().split('@');
  return `${result.basePattern}[NUM]@${domain}`;
}

/**
 * Batch analysis: detect if multiple emails follow the same sequential pattern
 * This is useful for detecting coordinated attacks
 */
export function analyzeSequentialBatch(emails: string[]): {
  hasSequentialPattern: boolean;
  patternFamily: string | null;
  confidence: number;
  matchingEmails: string[];
} {
  if (emails.length < 2) {
    return {
      hasSequentialPattern: false,
      patternFamily: null,
      confidence: 0.0,
      matchingEmails: []
    };
  }

  const patterns = new Map<string, string[]>();

  for (const email of emails) {
    const family = getSequentialPatternFamily(email);
    if (family) {
      if (!patterns.has(family)) {
        patterns.set(family, []);
      }
      patterns.get(family)!.push(email);
    }
  }

  // Find the most common pattern
  let maxCount = 0;
  let dominantPattern: string | null = null;
  let matchingEmails: string[] = [];

  for (const [pattern, matches] of patterns.entries()) {
    if (matches.length > maxCount) {
      maxCount = matches.length;
      dominantPattern = pattern;
      matchingEmails = matches;
    }
  }

  if (!dominantPattern || maxCount < 2) {
    return {
      hasSequentialPattern: false,
      patternFamily: null,
      confidence: 0.0,
      matchingEmails: []
    };
  }

  // Confidence increases with more matches
  // 2 matches: 0.6, 3 matches: 0.75, 4+ matches: 0.9
  let confidence = 0.5 + (maxCount * 0.15);
  confidence = Math.min(confidence, 1.0);

  return {
    hasSequentialPattern: true,
    patternFamily: dominantPattern,
    confidence,
    matchingEmails
  };
}
