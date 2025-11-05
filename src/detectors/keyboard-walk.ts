/**
 * Keyboard Walk Detector
 *
 * Detects patterns where the user types sequential keys on the keyboard.
 * Supports multiple keyboard layouts worldwide:
 * - QWERTY (US/UK standard)
 * - AZERTY (French/Belgian)
 * - QWERTZ (German/Swiss/Austrian/Central European)
 * - Dvorak (Alternative ergonomic layout)
 * - Colemak (Modern ergonomic layout)
 * - Number pad patterns (calculator/phone layouts)
 *
 * Examples:
 * - qwerty, asdfgh, zxcvbn (QWERTY rows)
 * - azerty, qsdfgh (AZERTY rows)
 * - qwertz, asdfgh (QWERTZ rows)
 * - 123456, 789456 (number patterns)
 *
 * These patterns are common in:
 * - Lazy password choices that leak into email addresses
 * - Automated generators using simple patterns
 * - Test accounts
 */

export interface KeyboardWalkResult {
  hasKeyboardWalk: boolean;
  pattern: string | null;      // The detected walk pattern
  walkType: 'horizontal' | 'vertical' | 'diagonal' | 'numeric' | 'none';
  confidence: number;           // 0.0-1.0
  metadata?: {
    walkLength: number;
    position: 'full' | 'prefix' | 'suffix' | 'middle';
    keyboard: 'qwerty' | 'azerty' | 'qwertz' | 'dvorak' | 'colemak' | 'numeric' | 'other';
  };
}

/**
 * Helper: Check if a digit string contains a plausible birth year (1940-2025)
 * Returns true if a birth year is found (indicates likely legitimate pattern)
 */
function containsBirthYear(digits: string): boolean {
  const currentYear = new Date().getFullYear();

  // Check for 4-digit years within the string
  for (let i = 0; i <= digits.length - 4; i++) {
    const yearStr = digits.substring(i, i + 4);
    const year = parseInt(yearStr, 10);
    const yearAge = currentYear - year;

    // Plausible birth year: 13-100 years old
    if (year >= 1940 && year <= currentYear && yearAge >= 13 && yearAge <= 100) {
      return true;
    }
  }

  return false;
}

// Keyboard Layout Definitions
interface KeyboardLayout {
  name: string;
  rows: string[];
  cols: string[];
  diagonals: string[];
}

// QWERTY keyboard layout (US/UK standard)
const QWERTY_LAYOUT: KeyboardLayout = {
  name: 'qwerty',
  rows: [
    '1234567890',
    'qwertyuiop',
    'asdfghjkl',
    'zxcvbnm'
  ],
  cols: [
    'qaz',
    'wsx',
    'edc',
    'rfv',
    'tgb',
    'yhn',
    'ujm',
    'ik',
    'ol',
    'p'
  ],
  diagonals: [
    'qweasd',
    'asdqwe',
    'zaqxsw',
    'wsxzaq',
    'edcrfv',
    'rfvedc',
    'tgbyhn',
    'yhnbgt'
  ]
};

// AZERTY keyboard layout (French/Belgian)
const AZERTY_LAYOUT: KeyboardLayout = {
  name: 'azerty',
  rows: [
    '1234567890',
    'azertyuiop',
    'qsdfghjklm',
    'wxcvbn'
  ],
  cols: [
    'aqw',
    'zsx',
    'edc',
    'rfv',
    'tgb',
    'yhn',
    'ujm',
    'ik',
    'ol',
    'pm'
  ],
  diagonals: [
    'azerty',
    'qsdfgh',
    'wxcvbn',
    'azeqsd',
    'qsdaze'
  ]
};

// QWERTZ keyboard layout (German/Swiss/Austrian/Central European)
const QWERTZ_LAYOUT: KeyboardLayout = {
  name: 'qwertz',
  rows: [
    '1234567890',
    'qwertzuiop',
    'asdfghjkl',
    'yxcvbnm'
  ],
  cols: [
    'qay',
    'wsx',
    'edc',
    'rfv',
    'tgb',
    'zhn',
    'ujm',
    'ik',
    'ol',
    'p'
  ],
  diagonals: [
    'qweasd',
    'asdqwe',
    'yaqxsw',
    'wsxyaq',
    'edcrfv',
    'rfvedc'
  ]
};

// Dvorak keyboard layout (Alternative ergonomic)
const DVORAK_LAYOUT: KeyboardLayout = {
  name: 'dvorak',
  rows: [
    '1234567890',
    'pyfgcrl',
    'aoeuidhtns',
    'qjkxbmwvz'
  ],
  cols: [
    'paq',
    'yoj',
    'fek',
    'gux',
    'cib',
    'rhm',
    'ldw',
    'htv',
    'nsz'
  ],
  diagonals: [
    'pyaoeu',
    'aoeupy',
    'fguidh'
  ]
};

// Colemak keyboard layout (Modern ergonomic)
const COLEMAK_LAYOUT: KeyboardLayout = {
  name: 'colemak',
  rows: [
    '1234567890',
    'qwfpgjluy',
    'arstdhneio',
    'zxcvbkm'
  ],
  cols: [
    'qaz',
    'wsx',
    'frc',
    'ptv',
    'gdb',
    'jkm',
    'lh',
    'un',
    'ye',
    'io'
  ],
  diagonals: [
    'qwarst',
    'arstqw',
    'fpdh',
    'dhfp'
  ]
};

// Number pad layouts (calculator/phone)
const NUMPAD_PATTERNS = [
  '789',
  '456',
  '123',
  '741',
  '852',
  '963',
  '7894',
  '4561',
  '1230',
  '789456',
  '456123',
  '147',
  '258',
  '369'
];

// All supported layouts
const ALL_LAYOUTS: KeyboardLayout[] = [
  QWERTY_LAYOUT,
  AZERTY_LAYOUT,
  QWERTZ_LAYOUT,
  DVORAK_LAYOUT,
  COLEMAK_LAYOUT
];

// Legacy exports for backward compatibility
const KEYBOARD_ROWS = QWERTY_LAYOUT.rows;
const KEYBOARD_COLS = QWERTY_LAYOUT.cols;
const KEYBOARD_DIAGONALS = QWERTY_LAYOUT.diagonals;

/**
 * Detect keyboard walk patterns in an email local part
 * Checks all supported keyboard layouts
 */
export function detectKeyboardWalk(email: string): KeyboardWalkResult {
  const [localPart] = email.toLowerCase().split('@');

  if (!localPart || localPart.length < 3) {
    return {
      hasKeyboardWalk: false,
      pattern: null,
      walkType: 'none',
      confidence: 0.0
    };
  }

  // Track best match across all layouts
  let bestMatch: KeyboardWalkResult = {
    hasKeyboardWalk: false,
    pattern: null,
    walkType: 'none',
    confidence: 0.0
  };

  // Check all keyboard layouts
  for (const layout of ALL_LAYOUTS) {
    // Check for horizontal walks (keyboard rows)
    const horizontalResult = detectHorizontalWalkForLayout(localPart, layout);
    if (horizontalResult.hasWalk && horizontalResult.confidence > bestMatch.confidence) {
      bestMatch = horizontalResult;
    }

    // Check for vertical walks (keyboard columns)
    const verticalResult = detectVerticalWalkForLayout(localPart, layout);
    if (verticalResult.hasWalk && verticalResult.confidence > bestMatch.confidence) {
      bestMatch = verticalResult;
    }

    // Check for diagonal patterns
    const diagonalResult = detectDiagonalWalkForLayout(localPart, layout);
    if (diagonalResult.hasWalk && diagonalResult.confidence > bestMatch.confidence) {
      bestMatch = diagonalResult;
    }
  }

  // Check for numeric sequences (applies to all layouts)
  const numericResult = detectNumericSequence(localPart);
  if (numericResult.hasWalk && numericResult.confidence > bestMatch.confidence) {
    bestMatch = numericResult;
  }

  // Check for numpad patterns
  const numpadResult = detectNumpadPattern(localPart);
  if (numpadResult.hasWalk && numpadResult.confidence > bestMatch.confidence) {
    bestMatch = numpadResult;
  }

  return bestMatch;
}

/**
 * Detect horizontal keyboard walks for a specific layout
 */
function detectHorizontalWalkForLayout(localPart: string, layout: KeyboardLayout): KeyboardWalkResult & { hasWalk: boolean } {
  for (const row of layout.rows) {
    const isNumberRow = row === layout.rows[0]; // First row is number row (1234567890)

    // For number rows, require 5+ chars to reduce false positives on birth years and short sequences
    // For letter rows, 4+ chars is fine (qwerty, asdfgh, etc.)
    const minLength = isNumberRow ? 5 : 4;

    // Check for forward walks (qwerty, asdfgh, azerty, 12345, etc.)
    const forwardMatch = findLongestSubsequence(localPart, row);
    if (forwardMatch.length >= minLength) {
      // Skip if it's a numeric pattern that contains a birth year
      if (isNumberRow && containsBirthYear(forwardMatch.sequence)) {
        continue; // Don't flag birth years as keyboard walks
      }

      return {
        hasWalk: true,
        hasKeyboardWalk: true,
        pattern: forwardMatch.sequence,
        walkType: isNumberRow ? 'numeric' : 'horizontal',
        confidence: calculateWalkConfidence(forwardMatch.length, forwardMatch.position),
        metadata: {
          walkLength: forwardMatch.length,
          position: forwardMatch.position,
          keyboard: isNumberRow ? 'numeric' : layout.name as any
        }
      };
    }

    // Check for backward walks (trewq, hgfdsa, 54321, etc.)
    const reversedRow = row.split('').reverse().join('');
    const backwardMatch = findLongestSubsequence(localPart, reversedRow);
    if (backwardMatch.length >= minLength) {
      // Skip if it's a numeric pattern that contains a birth year
      if (isNumberRow && containsBirthYear(backwardMatch.sequence)) {
        continue; // Don't flag birth years as keyboard walks
      }

      return {
        hasWalk: true,
        hasKeyboardWalk: true,
        pattern: backwardMatch.sequence,
        walkType: isNumberRow ? 'numeric' : 'horizontal',
        confidence: calculateWalkConfidence(backwardMatch.length, backwardMatch.position),
        metadata: {
          walkLength: backwardMatch.length,
          position: backwardMatch.position,
          keyboard: isNumberRow ? 'numeric' : layout.name as any
        }
      };
    }
  }

  return { hasWalk: false, hasKeyboardWalk: false, pattern: null, walkType: 'none', confidence: 0.0 };
}

/**
 * Legacy function for backward compatibility
 */
function detectHorizontalWalk(localPart: string): KeyboardWalkResult & { hasWalk: boolean } {
  return detectHorizontalWalkForLayout(localPart, QWERTY_LAYOUT);
}

/**
 * Detect vertical keyboard walks for a specific layout
 */
function detectVerticalWalkForLayout(localPart: string, layout: KeyboardLayout): KeyboardWalkResult & { hasWalk: boolean } {
  for (const col of layout.cols) {
    // Forward
    const forwardMatch = findLongestSubsequence(localPart, col);
    if (forwardMatch.length >= 3) {
      return {
        hasWalk: true,
        hasKeyboardWalk: true,
        pattern: forwardMatch.sequence,
        walkType: 'vertical',
        confidence: calculateWalkConfidence(forwardMatch.length, forwardMatch.position),
        metadata: {
          walkLength: forwardMatch.length,
          position: forwardMatch.position,
          keyboard: layout.name as any
        }
      };
    }

    // Backward
    const reversedCol = col.split('').reverse().join('');
    const backwardMatch = findLongestSubsequence(localPart, reversedCol);
    if (backwardMatch.length >= 3) {
      return {
        hasWalk: true,
        hasKeyboardWalk: true,
        pattern: backwardMatch.sequence,
        walkType: 'vertical',
        confidence: calculateWalkConfidence(backwardMatch.length, backwardMatch.position),
        metadata: {
          walkLength: backwardMatch.length,
          position: backwardMatch.position,
          keyboard: layout.name as any
        }
      };
    }
  }

  return { hasWalk: false, hasKeyboardWalk: false, pattern: null, walkType: 'none', confidence: 0.0 };
}

/**
 * Legacy function for backward compatibility
 */
function detectVerticalWalk(localPart: string): KeyboardWalkResult & { hasWalk: boolean } {
  return detectVerticalWalkForLayout(localPart, QWERTY_LAYOUT);
}

/**
 * Detect diagonal keyboard walks for a specific layout
 */
function detectDiagonalWalkForLayout(localPart: string, layout: KeyboardLayout): KeyboardWalkResult & { hasWalk: boolean } {
  for (const diagonal of layout.diagonals) {
    if (localPart.includes(diagonal)) {
      const position = localPart === diagonal ? 'full' :
                      localPart.startsWith(diagonal) ? 'prefix' :
                      localPart.endsWith(diagonal) ? 'suffix' : 'middle';

      return {
        hasWalk: true,
        hasKeyboardWalk: true,
        pattern: diagonal,
        walkType: 'diagonal',
        confidence: calculateWalkConfidence(diagonal.length, position),
        metadata: {
          walkLength: diagonal.length,
          position,
          keyboard: layout.name as any
        }
      };
    }

    // Check reversed
    const reversed = diagonal.split('').reverse().join('');
    if (localPart.includes(reversed)) {
      const position = localPart === reversed ? 'full' :
                      localPart.startsWith(reversed) ? 'prefix' :
                      localPart.endsWith(reversed) ? 'suffix' : 'middle';

      return {
        hasWalk: true,
        hasKeyboardWalk: true,
        pattern: reversed,
        walkType: 'diagonal',
        confidence: calculateWalkConfidence(reversed.length, position),
        metadata: {
          walkLength: reversed.length,
          position,
          keyboard: layout.name as any
        }
      };
    }
  }

  return { hasWalk: false, hasKeyboardWalk: false, pattern: null, walkType: 'none', confidence: 0.0 };
}

/**
 * Legacy function for backward compatibility
 */
function detectDiagonalWalk(localPart: string): KeyboardWalkResult & { hasWalk: boolean } {
  return detectDiagonalWalkForLayout(localPart, QWERTY_LAYOUT);
}

/**
 * Detect numpad patterns (calculator/phone layout)
 */
function detectNumpadPattern(localPart: string): KeyboardWalkResult & { hasWalk: boolean } {
  for (const pattern of NUMPAD_PATTERNS) {
    // Only flag patterns 5+ digits to reduce false positives on short sequences
    // "123", "321", "456" are too common in legitimate emails
    if (pattern.length < 5) {
      continue;
    }

    if (localPart.includes(pattern)) {
      // Skip if contains birth year
      if (containsBirthYear(pattern)) {
        continue;
      }

      const position = localPart === pattern ? 'full' :
                      localPart.startsWith(pattern) ? 'prefix' :
                      localPart.endsWith(pattern) ? 'suffix' : 'middle';

      return {
        hasWalk: true,
        hasKeyboardWalk: true,
        pattern: pattern,
        walkType: 'numeric',
        confidence: calculateWalkConfidence(pattern.length, position),
        metadata: {
          walkLength: pattern.length,
          position,
          keyboard: 'numeric'
        }
      };
    }

    // Check reversed
    const reversed = pattern.split('').reverse().join('');
    if (localPart.includes(reversed)) {
      // Skip if contains birth year
      if (containsBirthYear(reversed)) {
        continue;
      }

      const position = localPart === reversed ? 'full' :
                      localPart.startsWith(reversed) ? 'prefix' :
                      localPart.endsWith(reversed) ? 'suffix' : 'middle';

      return {
        hasWalk: true,
        hasKeyboardWalk: true,
        pattern: reversed,
        walkType: 'numeric',
        confidence: calculateWalkConfidence(reversed.length, position),
        metadata: {
          walkLength: reversed.length,
          position,
          keyboard: 'numeric'
        }
      };
    }
  }

  return { hasWalk: false, hasKeyboardWalk: false, pattern: null, walkType: 'none', confidence: 0.0 };
}

/**
 * Detect numeric sequences (123456, 456789, etc.)
 */
function detectNumericSequence(localPart: string): KeyboardWalkResult & { hasWalk: boolean } {
  // Extract all digit sequences
  const digitMatches = localPart.match(/\d{3,}/g);

  if (!digitMatches) {
    return { hasWalk: false, hasKeyboardWalk: false, pattern: null, walkType: 'none', confidence: 0.0 };
  }

  for (const digits of digitMatches) {
    // Skip if contains a birth year - likely legitimate
    if (containsBirthYear(digits)) {
      continue;
    }

    // Check for sequential numbers (123, 234, 345, etc.)
    // Only flag if 5+ digits to reduce false positives on short sequences like "321"
    if (isSequentialDigits(digits) && digits.length >= 5) {
      const position = localPart === digits ? 'full' :
                      localPart.startsWith(digits) ? 'prefix' :
                      localPart.endsWith(digits) ? 'suffix' : 'middle';

      return {
        hasWalk: true,
        hasKeyboardWalk: true,
        pattern: digits,
        walkType: 'numeric',
        confidence: calculateWalkConfidence(digits.length, position),
        metadata: {
          walkLength: digits.length,
          position,
          keyboard: 'numeric'
        }
      };
    }

    // Check for repeated digits (111, 222, etc.)
    if (isRepeatedDigits(digits)) {
      const position = localPart === digits ? 'full' :
                      localPart.startsWith(digits) ? 'prefix' :
                      localPart.endsWith(digits) ? 'suffix' : 'middle';

      return {
        hasWalk: true,
        hasKeyboardWalk: true,
        pattern: digits,
        walkType: 'numeric',
        confidence: calculateWalkConfidence(digits.length, position) * 0.8, // Slightly lower confidence
        metadata: {
          walkLength: digits.length,
          position,
          keyboard: 'numeric'
        }
      };
    }
  }

  return { hasWalk: false, hasKeyboardWalk: false, pattern: null, walkType: 'none', confidence: 0.0 };
}

/**
 * Find the longest matching subsequence
 */
function findLongestSubsequence(
  text: string,
  pattern: string
): { length: number; sequence: string; position: 'full' | 'prefix' | 'suffix' | 'middle' } {
  let maxLength = 0;
  let maxSequence = '';
  let position: 'full' | 'prefix' | 'suffix' | 'middle' = 'middle';

  // Try all substrings of the pattern
  for (let i = 0; i < pattern.length; i++) {
    for (let j = i + 1; j <= pattern.length; j++) {
      const substring = pattern.substring(i, j);
      if (text.includes(substring) && substring.length > maxLength) {
        maxLength = substring.length;
        maxSequence = substring;

        // Determine position
        if (text === substring) {
          position = 'full';
        } else if (text.startsWith(substring)) {
          position = 'prefix';
        } else if (text.endsWith(substring)) {
          position = 'suffix';
        } else {
          position = 'middle';
        }
      }
    }
  }

  return { length: maxLength, sequence: maxSequence, position };
}

/**
 * Check if digits are sequential (123, 234, 345, etc.)
 */
function isSequentialDigits(digits: string): boolean {
  if (digits.length < 3) return false;

  for (let i = 1; i < digits.length; i++) {
    const prev = parseInt(digits[i - 1]);
    const curr = parseInt(digits[i]);

    // Check forward sequence (123)
    if (curr !== prev + 1 && curr !== prev - 1) {
      return false;
    }
  }

  return true;
}

/**
 * Check if all digits are the same (111, 222, etc.)
 */
function isRepeatedDigits(digits: string): boolean {
  if (digits.length < 3) return false;
  const uniqueDigits = new Set(digits.split(''));
  return uniqueDigits.size === 1;
}

/**
 * Calculate confidence based on walk length and position
 */
function calculateWalkConfidence(
  walkLength: number,
  position: 'full' | 'prefix' | 'suffix' | 'middle'
): number {
  let confidence = 0.0;

  // Longer walks are more suspicious
  if (walkLength >= 6) {
    confidence = 0.9;
  } else if (walkLength >= 5) {
    confidence = 0.7;
  } else if (walkLength >= 4) {
    confidence = 0.6;
  } else if (walkLength >= 3) {
    confidence = 0.5;
  }

  // Full match or prefix is more suspicious
  if (position === 'full') {
    confidence += 0.1;
  } else if (position === 'prefix' || position === 'suffix') {
    confidence += 0.05;
  }

  return Math.min(confidence, 1.0);
}

/**
 * Get risk score contribution from keyboard walk detection
 */
export function getKeyboardWalkRiskScore(result: KeyboardWalkResult): number {
  if (!result.hasKeyboardWalk) {
    return 0.0;
  }

  // Base risk from confidence
  let risk = result.confidence * 0.5;

  // Full walks are very suspicious
  if (result.metadata?.position === 'full') {
    risk += 0.3;
  }

  // Horizontal walks (qwerty, asdfgh) are very lazy
  if (result.walkType === 'horizontal') {
    risk += 0.2;
  }

  return Math.min(risk, 1.0);
}
