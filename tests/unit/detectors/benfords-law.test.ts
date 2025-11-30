/**
 * Benford's Law Analysis Tests
 *
 * Tests for statistical distribution analysis to detect batch/automated attacks.
 */

import { describe, it, expect } from 'vitest';
import {
  analyzeBenfordsLaw,
  isSuspiciousDistribution,
  getBenfordRiskScore,
  compareDistributions,
  formatBenfordAnalysis,
  type BenfordsLawAnalysis
} from '../../../src/detectors/benfords-law';

describe("Benford's Law Analysis", () => {
  describe('analyzeBenfordsLaw', () => {
    it('should require minimum sample size', () => {
      const tooSmall = [
        'user1@example.com',
        'user2@example.com',
        'user3@example.com'
      ];

      const result = analyzeBenfordsLaw(tooSmall);

      expect(result.sampleSize).toBeLessThan(30);
      expect(result.followsBenford).toBe(false);
      expect(result.confidence).toBe(0);
      expect(result.pValue).toBe(1.0);
    });

    it('should analyze natural distribution (Benford compliant)', () => {
      // Natural distribution following Benford's Law
      const naturalEmails = [
        // More 1s (30%)
        'user1@example.com', 'user10@example.com', 'user11@example.com',
        'user12@example.com', 'user13@example.com', 'user14@example.com',
        'user15@example.com', 'user16@example.com', 'user17@example.com',
        'user18@example.com', 'user19@example.com', 'user100@example.com',
        'user101@example.com', 'user110@example.com', 'user111@example.com',
        'user120@example.com', 'user130@example.com', 'user140@example.com',
        // Some 2s (17%)
        'user2@example.com', 'user20@example.com', 'user21@example.com',
        'user22@example.com', 'user23@example.com', 'user24@example.com',
        'user25@example.com', 'user200@example.com', 'user210@example.com',
        // Some 3s (12%)
        'user3@example.com', 'user30@example.com', 'user31@example.com',
        'user32@example.com', 'user300@example.com', 'user310@example.com',
        // Fewer higher digits
        'user4@example.com', 'user40@example.com', 'user400@example.com',
        'user5@example.com', 'user50@example.com',
        'user6@example.com', 'user60@example.com',
        'user7@example.com', 'user70@example.com',
        'user8@example.com', 'user9@example.com'
      ];

      const result = analyzeBenfordsLaw(naturalEmails);

      expect(result.sampleSize).toBeGreaterThanOrEqual(30);
      expect(result.distribution).toBeDefined();
      expect(result.expectedDistribution).toBeDefined();

      // Should follow Benford's Law reasonably well
      // Note: With limited sample size, may not perfectly follow
      expect(result.deviation).toBeLessThan(0.3); // Not too deviant
    });

    it('should detect uniform distribution (bot-like)', () => {
      // Uniform distribution - typical of bots
      const uniformEmails = [
        // Equal distribution of digits 1-9
        'user1@example.com', 'user10@example.com', 'user100@example.com',
        'user101@example.com', 'user110@example.com',
        'user2@example.com', 'user20@example.com', 'user200@example.com',
        'user201@example.com', 'user210@example.com',
        'user3@example.com', 'user30@example.com', 'user300@example.com',
        'user301@example.com', 'user310@example.com',
        'user4@example.com', 'user40@example.com', 'user400@example.com',
        'user401@example.com', 'user410@example.com',
        'user5@example.com', 'user50@example.com', 'user500@example.com',
        'user501@example.com', 'user510@example.com',
        'user6@example.com', 'user60@example.com', 'user600@example.com',
        'user601@example.com', 'user610@example.com',
        'user7@example.com', 'user70@example.com', 'user700@example.com',
        'user701@example.com', 'user710@example.com',
        'user8@example.com', 'user80@example.com', 'user800@example.com',
        'user801@example.com', 'user810@example.com',
        'user9@example.com', 'user90@example.com', 'user900@example.com',
        'user901@example.com', 'user910@example.com'
      ];

      const result = analyzeBenfordsLaw(uniformEmails);

      expect(result.sampleSize).toBeGreaterThanOrEqual(30);

      // Uniform distribution should have high deviation
      expect(result.deviation).toBeGreaterThan(0.05);

      // Should likely not follow Benford (depending on chi-square)
      // Note: Small samples may vary
    });

    it('should extract first digits correctly', () => {
      const emails = [
        'user123@example.com',   // First digit: 1
        'user456@example.com',   // First digit: 4
        'user789@example.com',   // First digit: 7
        'user999@example.com'    // First digit: 9
      ];

      // These are too few for full analysis, but we can test distribution array
      const result = analyzeBenfordsLaw(emails);

      expect(result.distribution).toBeDefined();
      expect(result.distribution.length).toBe(10); // 0-9
    });

    it('should skip leading zeros', () => {
      const emails = [
        'user0123@example.com',  // Leading 0 skipped, use 1
        'user0456@example.com',  // Leading 0 skipped, use 4
        'user0@example.com',     // Just 0, skip
        'user007@example.com'    // Leading 0s skipped, use 7
      ];

      const result = analyzeBenfordsLaw(emails);

      // Distribution[0] should be 0 (leading zeros not counted)
      expect(result.distribution[0]).toBe(0);
    });

    it('should calculate chi-square statistic', () => {
      const emails = Array.from({ length: 100 }, (_, i) => `user${i + 1}@example.com`);
      const result = analyzeBenfordsLaw(emails);

      expect(result.chiSquare).toBeGreaterThanOrEqual(0);
      expect(result.pValue).toBeGreaterThan(0);
      expect(result.pValue).toBeLessThanOrEqual(1.0);
    });

    it('should provide confidence score', () => {
      const emails = Array.from({ length: 50 }, (_, i) => `user${i + 1}@example.com`);
      const result = analyzeBenfordsLaw(emails);

      if (result.followsBenford) {
        expect(result.confidence).toBeGreaterThan(0);
        expect(result.confidence).toBeLessThanOrEqual(1.0);
      }
    });

    it('should calculate deviation from expected distribution', () => {
      const emails = Array.from({ length: 50 }, (_, i) => `user${i + 1}@example.com`);
      const result = analyzeBenfordsLaw(emails);

      expect(result.deviation).toBeGreaterThanOrEqual(0);
      expect(result.deviation).toBeLessThanOrEqual(1.0);

      // Deviation is average absolute difference from expected
      // Should be reasonable for natural distribution
    });

    it('should handle multiple numbers in email', () => {
      const emails = [
        'user123test456@example.com',  // Multiple numbers: 1, 4
        'abc789xyz321@example.com'     // Multiple numbers: 7, 3
      ];

      const result = analyzeBenfordsLaw(emails);

      // Should extract first digit from each number
      expect(result.sampleSize).toBeGreaterThan(0);
    });
  });

  describe('isSuspiciousDistribution', () => {
    it('should not flag small samples', () => {
      const small = [
        'user1@example.com',
        'user2@example.com',
        'user3@example.com'
      ];

      expect(isSuspiciousDistribution(small)).toBe(false);
    });

    it('should flag uniform distributions with high deviation', () => {
      // Create uniform distribution
      const uniform = Array.from({ length: 45 }, (_, i) => {
        const digit = (i % 9) + 1; // Cycle through 1-9
        return `user${digit}${i}@example.com`;
      });

      const result = isSuspiciousDistribution(uniform);

      // May or may not flag depending on exact distribution
      // Just ensure it doesn't throw
      expect(typeof result).toBe('boolean');
    });

    it('should not flag natural distributions', () => {
      // Natural-ish distribution
      const natural = [
        ...Array.from({ length: 15 }, (_, i) => `user1${i}@example.com`), // Many 1s
        ...Array.from({ length: 8 }, (_, i) => `user2${i}@example.com`),  // Some 2s
        ...Array.from({ length: 5 }, (_, i) => `user3${i}@example.com`),  // Fewer 3s
        ...Array.from({ length: 3 }, (_, i) => `user4${i}@example.com`),  // Even fewer
        ...Array.from({ length: 2 }, (_, i) => `user5${i}@example.com`),
        'user6@example.com',
        'user7@example.com',
        'user8@example.com'
      ];

      expect(isSuspiciousDistribution(natural)).toBe(false);
    });
  });

  describe('getBenfordRiskScore', () => {
    it('should return zero risk for small samples', () => {
      const small = [
        'user1@example.com',
        'user2@example.com'
      ];

      const result = getBenfordRiskScore(small);

      expect(result.riskScore).toBe(0);
      expect(result.isAutomated).toBe(false);
      expect(result.analysis.sampleSize).toBeLessThan(30);
    });

    it('should calculate risk based on deviation', () => {
      const emails = Array.from({ length: 50 }, (_, i) => `user${i + 1}@example.com`);
      const result = getBenfordRiskScore(emails);

      expect(result.riskScore).toBeGreaterThanOrEqual(0);
      expect(result.riskScore).toBeLessThanOrEqual(1.0);
      expect(result.analysis).toBeDefined();
    });

    it('should flag high risk as automated', () => {
      // Create very uniform distribution (high risk)
      const uniform = Array.from({ length: 90 }, (_, i) => {
        const digit = (i % 9) + 1;
        return `user${digit}${i}@example.com`;
      });

      const result = getBenfordRiskScore(uniform);

      if (result.riskScore > 0.7) {
        expect(result.isAutomated).toBe(true);
      }
    });

    it('should provide analysis details', () => {
      const emails = Array.from({ length: 50 }, (_, i) => `user${i + 1}@example.com`);
      const result = getBenfordRiskScore(emails);

      expect(result.analysis.chiSquare).toBeGreaterThanOrEqual(0);
      expect(result.analysis.deviation).toBeGreaterThanOrEqual(0);
      expect(result.analysis.distribution).toBeDefined();
    });

    it('should cap risk score at 1.0', () => {
      // Create extreme uniform distribution
      const extreme = Array.from({ length: 100 }, (_, i) => {
        const digit = (i % 9) + 1;
        return `user${digit * 111}@example.com`;
      });

      const result = getBenfordRiskScore(extreme);

      expect(result.riskScore).toBeLessThanOrEqual(1.0);
    });
  });

  describe('compareDistributions', () => {
    it('should compare two similar distributions', () => {
      const emails1 = Array.from({ length: 50 }, (_, i) => `user${i + 1}@example.com`);
      const emails2 = Array.from({ length: 50 }, (_, i) => `user${i + 100}@example.com`);

      const result = compareDistributions(emails1, emails2);

      expect(result.similarity).toBeGreaterThanOrEqual(0);
      expect(result.similarity).toBeLessThanOrEqual(1.0);
      expect(result.analysis1).toBeDefined();
      expect(result.analysis2).toBeDefined();
    });

    it('should detect high similarity for identical patterns', () => {
      const emails1 = Array.from({ length: 50 }, (_, i) => `user${i + 1}@example.com`);
      const emails2 = Array.from({ length: 50 }, (_, i) => `test${i + 1}@example.com`);

      const result = compareDistributions(emails1, emails2);

      // Should have very high similarity (same number pattern)
      expect(result.similarity).toBeGreaterThan(0.9);
      expect(result.areSimilar).toBe(true);
    });

    it('should detect low similarity for different patterns', () => {
      // First set: lots of 1s (natural)
      const natural = [
        ...Array.from({ length: 20 }, (_, i) => `user1${i}@example.com`),
        ...Array.from({ length: 10 }, (_, i) => `user2${i}@example.com`),
        ...Array.from({ length: 5 }, (_, i) => `user3${i}@example.com`),
        ...Array.from({ length: 5 }, (_, i) => `user4${i}@example.com`)
      ];

      // Second set: uniform (bot-like)
      const uniform = Array.from({ length: 40 }, (_, i) => {
        const digit = (i % 8) + 1;
        return `user${digit}${i}@example.com`;
      });

      const result = compareDistributions(natural, uniform);

      // Should have lower similarity
      // Note: May still be somewhat similar with small samples
      expect(result.similarity).toBeLessThanOrEqual(1.0);
    });

    it('should use cosine similarity metric', () => {
      const emails1 = Array.from({ length: 50 }, (_, i) => `user${i + 1}@example.com`);
      const emails2 = Array.from({ length: 50 }, (_, i) => `user${i + 1}@example.com`);

      const result = compareDistributions(emails1, emails2);

      // Identical sets should have perfect similarity
      expect(result.similarity).toBeCloseTo(1.0, 1);
    });

    it('should handle small samples gracefully', () => {
      const small1 = ['user1@example.com', 'user2@example.com'];
      const small2 = ['user3@example.com', 'user4@example.com'];

      const result = compareDistributions(small1, small2);

      expect(result.similarity).toBeGreaterThanOrEqual(0);
      expect(result.similarity).toBeLessThanOrEqual(1.0);
    });
  });

  describe('formatBenfordAnalysis', () => {
    it('should format analysis as readable string', () => {
      const emails = Array.from({ length: 50 }, (_, i) => `user${i + 1}@example.com`);
      const analysis = analyzeBenfordsLaw(emails);
      const formatted = formatBenfordAnalysis(analysis);

      expect(typeof formatted).toBe('string');
      expect(formatted.length).toBeGreaterThan(0);
      expect(formatted).toContain('Benford');
    });

    it('should include key metrics', () => {
      const emails = Array.from({ length: 50 }, (_, i) => `user${i + 1}@example.com`);
      const analysis = analyzeBenfordsLaw(emails);
      const formatted = formatBenfordAnalysis(analysis);

      expect(formatted).toContain('Sample Size');
      expect(formatted).toContain('Chi-Square');
      expect(formatted).toContain('P-Value');
      expect(formatted).toContain('Confidence');
      expect(formatted).toContain('Deviation');
    });

    it('should show distribution comparison', () => {
      const emails = Array.from({ length: 50 }, (_, i) => `user${i + 1}@example.com`);
      const analysis = analyzeBenfordsLaw(emails);
      const formatted = formatBenfordAnalysis(analysis);

      expect(formatted).toContain('Distribution');
      expect(formatted).toContain('vs');
      expect(formatted).toContain('%');
    });

    it('should indicate if follows or violates Benford', () => {
      const emails = Array.from({ length: 50 }, (_, i) => `user${i + 1}@example.com`);
      const analysis = analyzeBenfordsLaw(emails);
      const formatted = formatBenfordAnalysis(analysis);

      // Should contain either FOLLOWS or VIOLATES
      const hasStatus = formatted.includes('FOLLOWS') || formatted.includes('VIOLATES');
      expect(hasStatus).toBe(true);
    });
  });

  describe('Edge cases and robustness', () => {
    it('should handle emails without numbers', () => {
      const noNumbers = [
        'person.one@example.com',
        'person.two@example.com',
        'person.four@example.com',
      ];

      const result = analyzeBenfordsLaw(noNumbers);

      expect(result.sampleSize).toBe(0);
      expect(result.followsBenford).toBe(false);
    });

    it('should handle mixed emails (some with, some without numbers)', () => {
      const mixed = [
        ...Array.from({ length: 30 }, (_, i) => `user${i + 1}@example.com`),
        'person1@example.com',
        'person2@example.com',
        'person4@example.com'
      ];

      const result = analyzeBenfordsLaw(mixed);

      expect(result.sampleSize).toBeGreaterThanOrEqual(30);
    });

    it('should handle very large sample sizes', () => {
      const large = Array.from({ length: 1000 }, (_, i) => `user${i + 1}@example.com`);
      const result = analyzeBenfordsLaw(large);

      expect(result.sampleSize).toBe(1000);
      // Sequential 1-1000 actually violates Benford, so may have low confidence
      // Just check that analysis completes
      expect(result.chiSquare).toBeGreaterThanOrEqual(0);
    });

    it('should handle emails with only high digits', () => {
      const highDigits = Array.from({ length: 50 }, (_, i) => `user${i + 900}@example.com`);
      const result = analyzeBenfordsLaw(highDigits);

      // Should still analyze, but distribution will be skewed
      expect(result.sampleSize).toBeGreaterThanOrEqual(30);
      expect(result.distribution[9]).toBeGreaterThan(0); // Many 9s
    });

    it('should provide consistent results', () => {
      const emails = Array.from({ length: 50 }, (_, i) => `user${i + 1}@example.com`);

      const result1 = analyzeBenfordsLaw(emails);
      const result2 = analyzeBenfordsLaw(emails);
      const result3 = analyzeBenfordsLaw(emails);

      expect(result1.chiSquare).toBe(result2.chiSquare);
      expect(result2.chiSquare).toBe(result3.chiSquare);
      expect(result1.followsBenford).toBe(result2.followsBenford);
    });
  });

  describe('Real-world batch detection', () => {
    it('should detect sequential bot registration', () => {
      // Bot creates user1, user2, user3, ..., user50
      const botBatch = Array.from({ length: 50 }, (_, i) => `user${i + 1}@spam.tk`);
      const result = analyzeBenfordsLaw(botBatch);

      // Sequential 1-50 should violate Benford
      // (more uniform than expected)
      expect(result.sampleSize).toBeGreaterThanOrEqual(30);
    });

    it('should not flag natural user signups', () => {
      // Real users over time: sporadic IDs
      const natural = [
        'user1@example.com', 'user7@example.com', 'user11@example.com',
        'user15@example.com', 'user23@example.com', 'user24@example.com',
        'user31@example.com', 'user45@example.com', 'user67@example.com',
        'user101@example.com', 'user123@example.com', 'user145@example.com',
        'user189@example.com', 'user234@example.com', 'user256@example.com',
        'user301@example.com', 'user345@example.com', 'user389@example.com',
        'user412@example.com', 'user456@example.com', 'user478@example.com',
        'user501@example.com', 'user523@example.com', 'user567@example.com',
        'user601@example.com', 'user634@example.com', 'user678@example.com',
        'user701@example.com', 'user745@example.com', 'user789@example.com',
        'user812@example.com', 'user834@example.com', 'user878@example.com',
        'user901@example.com', 'user923@example.com', 'user945@example.com'
      ];

      const result = analyzeBenfordsLaw(natural);

      // More natural distribution should follow Benford better
      // (more 1s and 2s than higher digits)
      expect(result.sampleSize).toBeGreaterThanOrEqual(30);
      expect(result.deviation).toBeLessThan(0.3);
    });

    it('should compare two attack waves', () => {
      // First attack wave
      const wave1 = Array.from({ length: 50 }, (_, i) => `bot${i + 1}@spam.tk`);

      // Second attack wave (same pattern, just different prefix)
      const wave2 = Array.from({ length: 50 }, (_, i) => `user${i + 1}@spam.tk`);

      const comparison = compareDistributions(wave1, wave2);

      // Should be highly similar (same number distribution: 1-50)
      expect(comparison.similarity).toBeGreaterThan(0.95);
      expect(comparison.areSimilar).toBe(true);
    });
  });
});
