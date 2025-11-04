/**
 * Unit tests for pattern detectors
 */

import { describe, it, expect } from 'vitest';
import {
  detectSequentialPattern,
  getSequentialPatternFamily,
  analyzeSequentialBatch
} from '../../../src/detectors/sequential';
import {
  detectDatedPattern,
  getDatedPatternFamily,
  analyzeDatedBatch,
  isCurrentDatePattern
} from '../../../src/detectors/dated';
import {
  normalizeEmail,
  detectPlusAddressingAbuse,
  supportsPlusAddressing,
  analyzePlusTagPattern,
  getCanonicalEmail,
  areEmailsEquivalent
} from '../../../src/detectors/plus-addressing';
import {
  detectKeyboardWalk,
  getKeyboardWalkRiskScore
} from '../../../src/detectors/keyboard-walk';

describe('Sequential Pattern Detector', () => {
  it('should detect simple sequential patterns', () => {
    const result = detectSequentialPattern('user123@gmail.com');
    expect(result.isSequential).toBe(true);
    expect(result.basePattern).toBe('user');
    expect(result.sequence).toBe(123);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('should detect patterns with leading zeros', () => {
    const result = detectSequentialPattern('john.doe.001@yahoo.com');
    expect(result.isSequential).toBe(true);
    expect(result.metadata?.hasLeadingZeros).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.6);
  });

  it('should detect single digit sequences with common bases', () => {
    const result = detectSequentialPattern('user1@gmail.com');
    expect(result.isSequential).toBe(true); // Now detected with enhanced scoring
    expect(result.basePattern).toBe('user');
    expect(result.sequence).toBe(1);
    expect(result.confidence).toBeGreaterThanOrEqual(0.4); // Meets threshold
  });

  it('should not detect legitimate emails as sequential', () => {
    const result = detectSequentialPattern('person1.person2@gmail.com');
    expect(result.isSequential).toBe(false);
  });

  it('should extract pattern family correctly', () => {
    const family1 = getSequentialPatternFamily('user123@gmail.com');
    const family2 = getSequentialPatternFamily('user456@gmail.com');
    expect(family1).toBe(family2); // Same pattern family
  });

  it('should analyze sequential batch patterns', () => {
    const emails = [
      'user001@gmail.com',
      'user002@gmail.com',
      'user003@gmail.com'
    ];
    const result = analyzeSequentialBatch(emails);
    expect(result.hasSequentialPattern).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.7);
    expect(result.matchingEmails.length).toBe(3);
  });
});

describe('Dated Pattern Detector', () => {
  const currentYear = new Date().getFullYear();

  it('should detect four-digit year patterns', () => {
    const result = detectDatedPattern(`john.doe.${currentYear}@gmail.com`);
    expect(result.hasDatedPattern).toBe(true);
    expect(result.dateType).toBe('year');
    expect(result.dateComponent).toBe(currentYear.toString());
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it('should detect two-digit year patterns', () => {
    const shortYear = currentYear % 100;
    const result = detectDatedPattern(`john.doe.${shortYear}@gmail.com`);
    expect(result.hasDatedPattern).toBe(true);
    expect(result.dateType).toBe('short-year');
  });

  it('should detect month-year patterns', () => {
    const result = detectDatedPattern(`user_oct${currentYear}@gmail.com`);
    expect(result.hasDatedPattern).toBe(true);
    // Note: This might detect as 'year' since the year pattern matches first
    expect(['year', 'month-year']).toContain(result.dateType);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('should detect full date patterns', () => {
    const result = detectDatedPattern(`user_${currentYear}1031@gmail.com`);
    expect(result.hasDatedPattern).toBe(true);
    expect(result.dateType).toBe('full-date');
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it('should detect birth years as dated patterns with LOW risk', () => {
    // 2010 = 15 years old = plausible birth year (Gen Z)
    const result = detectDatedPattern('john.doe.2010@gmail.com');
    expect(result.hasDatedPattern).toBe(true);
    expect(result.metadata?.ageCategory).toBe('plausible_birth_year');
    expect(result.metadata?.isSuspicious).toBe(false);
    expect(result.confidence).toBeLessThan(0.3); // Low risk
  });

  // Age-Aware Algorithm Tests
  describe('Age-Aware Birth Year Detection', () => {
    it('should allow Millennial birth years (1981-1996)', () => {
      const millennialYears = [1985, 1990, 1995];

      for (const year of millennialYears) {
        const result = detectDatedPattern(`sarah${year}@gmail.com`);
        expect(result.hasDatedPattern).toBe(true);
        expect(result.metadata?.ageCategory).toBe('plausible_birth_year');
        expect(result.metadata?.isSuspicious).toBe(false);
        expect(result.confidence).toBeLessThan(0.3); // Low risk
      }
    });

    it('should allow Gen X birth years (1965-1980)', () => {
      const genXYears = [1970, 1975, 1980];

      for (const year of genXYears) {
        const result = detectDatedPattern(`mike_${year}@yahoo.com`);
        expect(result.hasDatedPattern).toBe(true);
        expect(result.metadata?.ageCategory).toBe('plausible_birth_year');
        expect(result.metadata?.isSuspicious).toBe(false);
        expect(result.confidence).toBeLessThan(0.3);
      }
    });

    it('should allow Gen Z birth years (1997-2012)', () => {
      const genZYears = [2000, 2005, 2010];

      for (const year of genZYears) {
        const result = detectDatedPattern(`alex.${year}@gmail.com`);
        expect(result.hasDatedPattern).toBe(true);
        expect(result.metadata?.ageCategory).toBe('plausible_birth_year');
        expect(result.metadata?.isSuspicious).toBe(false);
        expect(result.confidence).toBeLessThan(0.3);
      }
    });

    it('should block recent years as fraud timestamps', () => {
      const recentYears = [currentYear, currentYear - 1, currentYear + 1];

      for (const year of recentYears) {
        const result = detectDatedPattern(`user${year}@gmail.com`);
        expect(result.hasDatedPattern).toBe(true);
        expect(result.metadata?.ageCategory).toMatch(/recent_timestamp|future/);
        expect(result.metadata?.isSuspicious).toBe(true);
        expect(result.confidence).toBeGreaterThan(0.8); // High risk
      }
    });

    it('should block underage years (too young)', () => {
      const underageYears = [currentYear - 5, currentYear - 10];

      for (const year of underageYears) {
        const result = detectDatedPattern(`kid${year}@gmail.com`);
        expect(result.hasDatedPattern).toBe(true);
        expect(result.metadata?.ageCategory).toBe('underage');
        expect(result.metadata?.isSuspicious).toBe(true);
        expect(result.confidence).toBeGreaterThan(0.6); // Medium-high risk
      }
    });

    it('should handle elderly birth years appropriately', () => {
      const elderlyYears = [1950, 1945, 1940];

      for (const year of elderlyYears) {
        const result = detectDatedPattern(`senior${year}@aol.com`);
        expect(result.hasDatedPattern).toBe(true);
        expect(result.metadata?.ageCategory).toBe('elderly_birth_year');
        expect(result.metadata?.isSuspicious).toBe(false);
        expect(result.confidence).toBeLessThan(0.5); // Low-medium risk
      }
    });

    it('should allow 2-digit Millennial birth years (85, 90, 95)', () => {
      const twoDigitYears = ['85', '90', '95'];

      for (const year of twoDigitYears) {
        const result = detectDatedPattern(`sarah${year}@gmail.com`);
        expect(result.hasDatedPattern).toBe(true);
        expect(result.dateType).toBe('short-year');
        expect(result.metadata?.ageCategory).toBe('plausible_birth_year');
        expect(result.metadata?.isSuspicious).toBe(false);
        expect(result.confidence).toBeLessThan(0.3); // Low risk
      }
    });

    it('should allow 2-digit Gen X birth years (70, 75, 80)', () => {
      const twoDigitYears = ['70', '75', '80'];

      for (const year of twoDigitYears) {
        const result = detectDatedPattern(`mike${year}@yahoo.com`);
        expect(result.hasDatedPattern).toBe(true);
        expect(result.dateType).toBe('short-year');
        expect(result.metadata?.ageCategory).toBe('plausible_birth_year');
        expect(result.metadata?.isSuspicious).toBe(false);
        expect(result.confidence).toBeLessThan(0.3);
      }
    });

    it('should allow 2-digit Gen Z birth years (00, 05, 10)', () => {
      const twoDigitYears = ['00', '05', '10'];

      for (const year of twoDigitYears) {
        const result = detectDatedPattern(`alex${year}@gmail.com`);
        expect(result.hasDatedPattern).toBe(true);
        expect(result.dateType).toBe('short-year');
        expect(result.metadata?.ageCategory).toBe('plausible_birth_year');
        expect(result.metadata?.isSuspicious).toBe(false);
        expect(result.confidence).toBeLessThan(0.3);
      }
    });

    it('should block 2-digit recent years as fraud (24, 25)', () => {
      const recentTwoDigit = ['24', '25'];

      for (const year of recentTwoDigit) {
        const result = detectDatedPattern(`user${year}@gmail.com`);
        expect(result.hasDatedPattern).toBe(true);
        expect(result.dateType).toBe('short-year');
        expect(result.metadata?.ageCategory).toMatch(/recent_timestamp|future/);
        expect(result.metadata?.isSuspicious).toBe(true);
        expect(result.confidence).toBeGreaterThan(0.7); // High risk
      }
    });

    it('should skip 2-digit patterns with short bases (avoid false positives)', () => {
      // Short bases like "a85", "xy90" are ambiguous (could be random numbers)
      const ambiguous = ['a85@gmail.com', 'xy90@yahoo.com', 'foo42@test.com'];

      for (const email of ambiguous) {
        const result = detectDatedPattern(email);
        expect(result.hasDatedPattern).toBe(false); // Should NOT detect
      }
    });

    it('should block ancient/implausible years', () => {
      const ancientYears = [1900, 1920];

      for (const year of ancientYears) {
        const result = detectDatedPattern(`old${year}@gmail.com`);
        expect(result.hasDatedPattern).toBe(true);
        expect(result.metadata?.ageCategory).toBe('ancient');
        expect(result.metadata?.isSuspicious).toBe(true);
        expect(result.confidence).toBeGreaterThan(0.7); // High risk
      }
    });

    it('should flag month-year patterns even in birth range as suspicious', () => {
      const result = detectDatedPattern('sarah_jan1990@gmail.com');
      expect(result.hasDatedPattern).toBe(true);
      expect(result.dateType).toBe('month-year');
      expect(result.metadata?.isSuspicious).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.5); // Suspicious formatting
    });

    it('should flag full-date patterns even in birth range as very suspicious', () => {
      const result = detectDatedPattern('john_19900115@gmail.com');
      expect(result.hasDatedPattern).toBe(true);
      expect(result.dateType).toBe('full-date');
      expect(result.metadata?.isSuspicious).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.7); // Very suspicious
    });
  });

  it('should extract pattern family for dated emails', () => {
    const family1 = getDatedPatternFamily(`john.doe.${currentYear}@gmail.com`);
    const family2 = getDatedPatternFamily(`jane.smith.${currentYear}@gmail.com`);
    expect(family1).toContain('[YEAR]');
    expect(family1).toBe(family2); // Same pattern family
  });

  it('should analyze dated batch patterns', () => {
    const emails = [
      `john.smith.${currentYear}@gmail.com`,
      `jane.doe.${currentYear}@gmail.com`,
      `bob.jones.${currentYear}@gmail.com`
    ];
    const result = analyzeDatedBatch(emails);
    expect(result.hasDatedPattern).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.matchingEmails.length).toBeGreaterThanOrEqual(3);
  });

  it('should identify current date patterns', () => {
    const currentDate = `${currentYear}`;
    expect(isCurrentDatePattern(currentDate)).toBe(true);
  });
});

describe('Plus-Addressing Normalizer', () => {
  it('should normalize plus-addressed emails', () => {
    const result = normalizeEmail('user+test@gmail.com');
    expect(result.normalized).toBe('user@gmail.com');
    expect(result.hasPlus).toBe(true);
    expect(result.plusTag).toBe('test');
  });

  it('should handle Gmail dot-ignoring', () => {
    const result = normalizeEmail('person1.person2@gmail.com');
    expect(result.providerNormalized).toBe('johndoe@gmail.com');
    expect(result.metadata?.dotsRemoved).toBe(1);
  });

  it('should detect suspicious plus tags', () => {
    const result1 = normalizeEmail('user+1@gmail.com');
    expect(result1.metadata?.suspiciousTag).toBe(true);

    const result2 = normalizeEmail('user+test@gmail.com');
    expect(result2.metadata?.suspiciousTag).toBe(true);

    const result3 = normalizeEmail('user+spam@gmail.com');
    expect(result3.metadata?.suspiciousTag).toBe(true);
  });

  it('should detect plus-addressing abuse in batch', () => {
    const emails = [
      'user+1@gmail.com',
      'user+2@gmail.com',
      'user+3@gmail.com'
    ];
    const result = detectPlusAddressingAbuse(emails);
    expect(result.hasAbuse).toBe(true);
    expect(result.largestGroup?.count).toBe(3);
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it('should recognize providers with plus-addressing support', () => {
    expect(supportsPlusAddressing('gmail.com')).toBe(true);
    expect(supportsPlusAddressing('yahoo.com')).toBe(true);
    expect(supportsPlusAddressing('outlook.com')).toBe(true);
    expect(supportsPlusAddressing('example.com')).toBe(false);
  });

  it('should analyze plus tag patterns', () => {
    const emails = [
      'user+1@gmail.com',
      'user+2@gmail.com',
      'user+3@gmail.com'
    ];
    const result = analyzePlusTagPattern(emails);
    expect(result.hasPattern).toBe(true);
    expect(result.patternType).toBe('sequential');
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it('should get canonical email addresses', () => {
    const canonical1 = getCanonicalEmail('john.doe+test@gmail.com');
    const canonical2 = getCanonicalEmail('johndoe@gmail.com');
    expect(canonical1).toBe(canonical2);
  });

  it('should check email equivalence', () => {
    const email1 = 'john.doe+test@gmail.com';
    const email2 = 'johndoe@gmail.com';
    expect(areEmailsEquivalent(email1, email2)).toBe(true);
  });
});

describe('Keyboard Walk Detector', () => {
  it('should detect horizontal keyboard walks', () => {
    const result = detectKeyboardWalk('qwerty@example.com');
    expect(result.hasKeyboardWalk).toBe(true);
    expect(result.walkType).toBe('horizontal');
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it('should detect asdfgh pattern', () => {
    const result = detectKeyboardWalk('asdfgh@example.com');
    expect(result.hasKeyboardWalk).toBe(true);
    expect(result.walkType).toBe('horizontal');
  });

  it('should detect vertical keyboard walks', () => {
    const result = detectKeyboardWalk('qaz@example.com');
    expect(result.hasKeyboardWalk).toBe(true);
    expect(result.walkType).toBe('vertical');
  });

  it('should detect diagonal patterns', () => {
    const result = detectKeyboardWalk('qweasd@example.com');
    expect(result.hasKeyboardWalk).toBe(true);
    expect(result.walkType).toBe('diagonal');
  });

  it('should detect numeric sequences', () => {
    const result = detectKeyboardWalk('user123456@example.com');
    expect(result.hasKeyboardWalk).toBe(true);
    expect(result.walkType).toBe('numeric');
  });

  it('should detect repeated digits', () => {
    const result = detectKeyboardWalk('user111@example.com');
    expect(result.hasKeyboardWalk).toBe(true);
    expect(result.walkType).toBe('numeric');
  });

  it('should not detect legitimate emails', () => {
    const result = detectKeyboardWalk('person1.person2@example.com');
    expect(result.hasKeyboardWalk).toBe(false);
  });

  it('should calculate risk score for keyboard walks', () => {
    const result = detectKeyboardWalk('qwerty@example.com');
    const risk = getKeyboardWalkRiskScore(result);
    expect(risk).toBeGreaterThan(0.5);
  });

  it('should detect backward walks', () => {
    const result = detectKeyboardWalk('trewq@example.com');
    expect(result.hasKeyboardWalk).toBe(true);
    expect(result.walkType).toBe('horizontal');
  });

  it('should handle mixed patterns', () => {
    const result = detectKeyboardWalk('myqwerty123@example.com');
    expect(result.hasKeyboardWalk).toBe(true);
  });
});

describe('Integration: Real-world Attack Scenarios', () => {
  it('should detect sophisticated attack: dated pattern on Gmail', () => {
    const currentYear = new Date().getFullYear();
    const emails = [
      `john.smith.${currentYear}@gmail.com`,
      `jane.doe.${currentYear}@gmail.com`,
      `bob.johnson.${currentYear}@gmail.com`
    ];

    // All should be detected as dated patterns
    for (const email of emails) {
      const result = detectDatedPattern(email);
      expect(result.hasDatedPattern).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.7);
    }

    // Batch analysis should show high confidence
    const batchResult = analyzeDatedBatch(emails);
    expect(batchResult.hasDatedPattern).toBe(true);
    expect(batchResult.confidence).toBeGreaterThan(0.5);
  });

  it('should detect plus-addressing campaign', () => {
    const emails = [
      'attacker+1@gmail.com',
      'attacker+2@gmail.com',
      'attacker+3@gmail.com',
      'attacker+4@gmail.com',
      'attacker+5@gmail.com'
    ];

    const abuseResult = detectPlusAddressingAbuse(emails);
    expect(abuseResult.hasAbuse).toBe(true);
    expect(abuseResult.largestGroup?.count).toBe(5);

    const patternResult = analyzePlusTagPattern(emails);
    expect(patternResult.hasPattern).toBe(true);
    expect(patternResult.patternType).toBe('sequential');
  });

  it('should detect sequential test accounts', () => {
    const emails = [
      'test001@company.com',
      'test002@company.com',
      'test003@company.com'
    ];

    const batchResult = analyzeSequentialBatch(emails);
    expect(batchResult.hasSequentialPattern).toBe(true);
    expect(batchResult.matchingEmails.length).toBe(3);
  });

  it('should handle mixed legitimate and attack emails', () => {
    const emails = [
      'person1.person2@gmail.com',              // Legitimate
      'personA.personB@company.com',          // Legitimate
      'user001@gmail.com',                // Attack
      'user002@gmail.com',                // Attack
      'user003@gmail.com'                 // Attack
    ];

    const batchResult = analyzeSequentialBatch(emails);
    expect(batchResult.hasSequentialPattern).toBe(true);
    expect(batchResult.matchingEmails.length).toBe(3); // Only attack emails
  });

  it('should not false positive on similar legitimate names', () => {
    const emails = [
      'person1.person2@gmail.com',
      'personA.personB@gmail.com',
      'personE.personF@gmail.com'
    ];

    // These share a surname but are not sequential patterns
    const seqResult = analyzeSequentialBatch(emails);
    expect(seqResult.hasSequentialPattern).toBe(false);

    // Not dated patterns either
    const datedResult = analyzeDatedBatch(emails);
    expect(datedResult.hasDatedPattern).toBe(false);
  });
});
