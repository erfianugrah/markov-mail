/**
 * TLD Risk Profiling Tests
 *
 * Tests for domain extension risk analysis based on abuse statistics.
 */

import { describe, it, expect } from 'vitest';
import {
  analyzeTLDRisk,
  getTLDCategory,
  isHighRiskTLD,
  isTrustedTLD,
  getHighRiskTLDs,
  getTLDStats,
  type TLDRiskAnalysis
} from '../../../src/detectors/tld-risk';

describe('TLD Risk Profiling', () => {
  describe('analyzeTLDRisk', () => {
    it('should identify trusted TLDs with low risk', () => {
      const trustedDomains = [
        'university.edu',
        'government.gov',
        'military.mil'
      ];

      trustedDomains.forEach(domain => {
        const analysis = analyzeTLDRisk(domain);
        expect(analysis.category).toBe('trusted');
        expect(analysis.riskScore).toBeLessThan(0.3);
        expect(analysis.hasProfile).toBe(true);
      });
    });

    it('should identify high-risk free TLDs', () => {
      const highRiskDomains = [
        'spam.tk',
        'phishing.ml',
        'scam.ga',
        'fake.cf',
        'bot.gq'
      ];

      highRiskDomains.forEach(domain => {
        const analysis = analyzeTLDRisk(domain);
        expect(analysis.category).toBe('high_risk');
        expect(analysis.riskScore).toBeGreaterThan(0.7);
        expect(analysis.hasProfile).toBe(true);
        if (analysis.profile) {
          expect(analysis.profile.registrationCost).toBe('free');
        }
      });
    });

    it('should identify standard commercial TLDs', () => {
      const standardDomains = [
        'example.com',
        'business.net',
        'nonprofit.org'
      ];

      standardDomains.forEach(domain => {
        const analysis = analyzeTLDRisk(domain);
        expect(analysis.category).toBe('standard');
        expect(analysis.riskScore).toBeGreaterThanOrEqual(0);
        expect(analysis.riskScore).toBeLessThan(0.5);
      });
    });

    it('should identify suspicious TLDs', () => {
      const suspiciousDomains = [
        'spam.xyz',
        'phishing.top',
        'scam.site',
        'fake.online',
        'bot.club'
      ];

      suspiciousDomains.forEach(domain => {
        const analysis = analyzeTLDRisk(domain);
        expect(analysis.category).toBe('suspicious');
        expect(analysis.riskScore).toBeGreaterThan(0.5);
        expect(analysis.riskScore).toBeLessThanOrEqual(0.9);
      });
    });

    it('should handle unknown TLDs with moderate risk', () => {
      const unknownDomains = [
        'example.unknown',
        'test.xyz123',
        'domain.newgtld'
      ];

      unknownDomains.forEach(domain => {
        const analysis = analyzeTLDRisk(domain);
        expect(analysis.category).toBe('unknown');
        expect(analysis.riskScore).toBeGreaterThanOrEqual(0.15);
        expect(analysis.riskScore).toBeLessThanOrEqual(0.4);
        expect(analysis.hasProfile).toBe(false);
        expect(analysis.profile).toBeNull();
        expect(analysis.registrableDomain).toContain('.');
      });
    });

    it('should extract TLD correctly from subdomains', () => {
      const domainWithSubdomains = 'mail.example.com';
      const analysis = analyzeTLDRisk(domainWithSubdomains);

      expect(analysis.tld).toBe('com');
      expect(analysis.category).toBe('standard');
      expect(analysis.subdomainDepth).toBe(1);
      expect(analysis.registrableDomain).toBe('example.com');
    });

    it('should be case-insensitive', () => {
      const lower = 'example.com';
      const upper = 'EXAMPLE.COM';
      const mixed = 'Example.CoM';

      const result1 = analyzeTLDRisk(lower);
      const result2 = analyzeTLDRisk(upper);
      const result3 = analyzeTLDRisk(mixed);

      expect(result1.riskScore).toBe(result2.riskScore);
      expect(result1.riskScore).toBe(result3.riskScore);
      expect(result1.category).toBe(result2.category);
    });

    it('should boost risk for hosted application suffixes', () => {
      const analysis = analyzeTLDRisk('scam-site.vercel.app');
      expect(analysis.isHostedPlatform).toBe(true);
      expect(analysis.hostingPlatform).toBe('vercel');
      expect(analysis.riskScore).toBeGreaterThan(0.3);
      expect(analysis.registrableDomain).toBe('scam-site.vercel.app');
    });

    it('should provide detailed profile information', () => {
      const domain = 'example.com';
      const analysis = analyzeTLDRisk(domain);

      expect(analysis.profile).toBeDefined();
      if (analysis.profile) {
        expect(analysis.profile.tld).toBe('com');
        expect(analysis.profile.category).toBeTruthy();
        expect(analysis.profile.disposableRatio).toBeGreaterThanOrEqual(0);
        expect(analysis.profile.spamRatio).toBeGreaterThanOrEqual(0);
        expect(analysis.profile.riskMultiplier).toBeGreaterThan(0);
        expect(analysis.profile.registrationCost).toBeTruthy();
        expect(analysis.profile.description).toBeTruthy();
      }
    });

    it('should normalize risk multiplier to 0-1 range', () => {
      const allDomains = [
        'example.mil',  // 0.2x multiplier
        'example.com',  // 1.0x multiplier
        'example.xyz',  // 2.5x multiplier
        'example.tk'    // 3.0x multiplier
      ];

      allDomains.forEach(domain => {
        const analysis = analyzeTLDRisk(domain);
        expect(analysis.riskScore).toBeGreaterThanOrEqual(0);
        expect(analysis.riskScore).toBeLessThanOrEqual(1.0);
      });
    });
  });

  describe('getTLDCategory', () => {
    it('should return correct categories for known TLDs', () => {
      expect(getTLDCategory('example.edu')).toBe('trusted');
      expect(getTLDCategory('example.gov')).toBe('trusted');
      expect(getTLDCategory('example.com')).toBe('standard');
      expect(getTLDCategory('example.xyz')).toBe('suspicious');
      expect(getTLDCategory('example.tk')).toBe('high_risk');
    });

    it('should return unknown for unrecognized TLDs', () => {
      expect(getTLDCategory('example.unknowntld')).toBe('unknown');
      expect(getTLDCategory('test.newgtld123')).toBe('unknown');
    });

    it('should handle various domain formats', () => {
      expect(getTLDCategory('mail.google.com')).toBe('standard');
      expect(getTLDCategory('subdomain.example.edu')).toBe('trusted');
    });
  });

  describe('isHighRiskTLD', () => {
    it('should identify high-risk free TLDs', () => {
      const highRiskDomains = [
        'example.tk',
        'example.ml',
        'example.ga',
        'example.cf',
        'example.gq'
      ];

      highRiskDomains.forEach(domain => {
        expect(isHighRiskTLD(domain)).toBe(true);
      });
    });

    it('should identify suspicious TLDs as high risk', () => {
      const suspiciousDomains = [
        'example.xyz',
        'example.top',
        'example.site'
      ];

      suspiciousDomains.forEach(domain => {
        expect(isHighRiskTLD(domain)).toBe(true);
      });
    });

    it('should not flag standard TLDs as high risk', () => {
      const standardDomains = [
        'example.com',
        'example.net',
        'example.org',
        'example.io',
        'example.dev'
      ];

      standardDomains.forEach(domain => {
        expect(isHighRiskTLD(domain)).toBe(false);
      });
    });

    it('should not flag trusted TLDs as high risk', () => {
      const trustedDomains = [
        'example.edu',
        'example.gov',
        'example.mil'
      ];

      trustedDomains.forEach(domain => {
        expect(isHighRiskTLD(domain)).toBe(false);
      });
    });
  });

  describe('isTrustedTLD', () => {
    it('should identify trusted restricted TLDs', () => {
      const trustedDomains = [
        'university.edu',
        'government.gov',
        'military.mil'
      ];

      trustedDomains.forEach(domain => {
        expect(isTrustedTLD(domain)).toBe(true);
      });
    });

    it('should not flag standard TLDs as trusted', () => {
      const standardDomains = [
        'example.com',
        'example.net',
        'example.org'
      ];

      standardDomains.forEach(domain => {
        expect(isTrustedTLD(domain)).toBe(false);
      });
    });

    it('should not flag suspicious or high-risk TLDs as trusted', () => {
      const untrustedDomains = [
        'example.xyz',
        'example.tk',
        'example.top'
      ];

      untrustedDomains.forEach(domain => {
        expect(isTrustedTLD(domain)).toBe(false);
      });
    });
  });

  describe('getHighRiskTLDs', () => {
    it('should return list of high-risk TLDs', () => {
      const highRiskList = getHighRiskTLDs();

      expect(Array.isArray(highRiskList)).toBe(true);
      expect(highRiskList.length).toBeGreaterThan(0);

      // Should include free registration TLDs
      expect(highRiskList).toContain('tk');
      expect(highRiskList).toContain('ml');
      expect(highRiskList).toContain('ga');
      expect(highRiskList).toContain('cf');
      expect(highRiskList).toContain('gq');
    });

    it('should only include high_risk category TLDs', () => {
      const highRiskList = getHighRiskTLDs();

      // Should not include standard or suspicious TLDs
      expect(highRiskList).not.toContain('com');
      expect(highRiskList).not.toContain('xyz');
      expect(highRiskList).not.toContain('edu');
    });
  });

  describe('getTLDStats', () => {
    it('should return statistics about TLD profiles', () => {
      const stats = getTLDStats();

      expect(stats.total).toBeGreaterThan(0);
      expect(stats.trusted).toBeGreaterThan(0);
      expect(stats.standard).toBeGreaterThan(0);
      expect(stats.suspicious).toBeGreaterThan(0);
      expect(stats.highRisk).toBeGreaterThan(0);
    });

    it('should have consistent totals', () => {
      const stats = getTLDStats();

      const sum = stats.trusted + stats.standard + stats.suspicious + stats.highRisk;
      expect(sum).toBe(stats.total);
    });

    it('should have reasonable distribution', () => {
      const stats = getTLDStats();

      // Should have more standard TLDs than others
      expect(stats.standard).toBeGreaterThanOrEqual(stats.trusted);

      // Should have at least 3 trusted TLDs (edu, gov, mil)
      expect(stats.trusted).toBeGreaterThanOrEqual(3);

      // Should have at least 5 high-risk TLDs (tk, ml, ga, cf, gq)
      expect(stats.highRisk).toBeGreaterThanOrEqual(5);
    });
  });

  describe('Risk scoring accuracy', () => {
    it('should assign lower risk to reputable country codes', () => {
      const reputableCountries = [
        'example.uk',
        'example.de',
        'example.fr',
        'example.ca',
        'example.au'
      ];

      reputableCountries.forEach(domain => {
        const analysis = analyzeTLDRisk(domain);
        expect(analysis.riskScore).toBeLessThan(0.4);
      });
    });

    it('should assign appropriate risk to tech TLDs', () => {
      const techDomains = [
        'example.io',
        'example.dev',
        'example.tech',
        'example.app'
      ];

      techDomains.forEach(domain => {
        const analysis = analyzeTLDRisk(domain);
        expect(analysis.category).toBe('standard');
        expect(analysis.riskScore).toBeLessThan(0.5);
      });
    });

    it('should correlate risk with registration cost', () => {
      // Free registration should have higher risk
      const freeReg = analyzeTLDRisk('example.tk');

      // Expensive registration should have lower risk
      const expensiveReg = analyzeTLDRisk('example.io');

      expect(freeReg.riskScore).toBeGreaterThan(expensiveReg.riskScore);
    });

    it('should correlate risk with abuse ratios', () => {
      const domain = 'example.com';
      const analysis = analyzeTLDRisk(domain);

      if (analysis.profile) {
        // Higher disposable/spam ratios should correlate with higher risk multiplier
        const totalAbuseRatio = analysis.profile.disposableRatio + analysis.profile.spamRatio;

        // For .com, abuse should be relatively low
        expect(totalAbuseRatio).toBeLessThan(0.3);
      }
    });
  });

  describe('Edge cases and robustness', () => {
    it('should handle domains with multiple dots', () => {
      const domain = 'mail.subdomain.example.co.uk';
      const analysis = analyzeTLDRisk(domain);

      // Should extract the last segment (.uk)
      expect(analysis.tld).toBe('uk');
    });

    it('should handle single-character TLDs', () => {
      const domain = 'example.x';
      const analysis = analyzeTLDRisk(domain);

      expect(analysis).toBeDefined();
      expect(analysis.category).toBe('unknown'); // Single char TLDs unlikely to be in our list
    });

    it('should handle numeric TLDs', () => {
      const domain = 'example.123';
      const analysis = analyzeTLDRisk(domain);

      expect(analysis).toBeDefined();
      expect(analysis.category).toBe('unknown');
    });

    it('should handle empty domain parts', () => {
      const domain = '.com';
      const analysis = analyzeTLDRisk(domain);

      expect(analysis.tld).toBe('com');
    });

    it('should provide consistent results', () => {
      const domain = 'test.example.com';

      const result1 = analyzeTLDRisk(domain);
      const result2 = analyzeTLDRisk(domain);
      const result3 = analyzeTLDRisk(domain);

      expect(result1.riskScore).toBe(result2.riskScore);
      expect(result2.riskScore).toBe(result3.riskScore);
      expect(result1.category).toBe(result2.category);
    });
  });

  describe('Real-world scenarios', () => {
    it('should flag disposable email TLDs', () => {
      // Common disposable email patterns
      const disposableDomains = [
        'tempmail.tk',
        '10minutemail.ml',
        'throwaway.ga'
      ];

      disposableDomains.forEach(domain => {
        const analysis = analyzeTLDRisk(domain);
        expect(analysis.riskScore).toBeGreaterThan(0.7);
      });
    });

    it('should trust educational and government domains', () => {
      const institutionalDomains = [
        'stanford.edu',
        'mit.edu',
        'irs.gov',
        'fbi.gov'
      ];

      institutionalDomains.forEach(domain => {
        expect(isTrustedTLD(domain)).toBe(true);
        const analysis = analyzeTLDRisk(domain);
        expect(analysis.riskScore).toBeLessThan(0.3);
      });
    });

    it('should handle popular corporate domains appropriately', () => {
      const corporateDomains = [
        'google.com',
        'microsoft.net',
        'mozilla.org',
        'github.io',
        'gitlab.com'
      ];

      corporateDomains.forEach(domain => {
        const analysis = analyzeTLDRisk(domain);
        expect(analysis.riskScore).toBeLessThan(0.5);
        expect(analysis.category).toBe('standard');
      });
    });

    it('should flag known spam-prone TLDs', () => {
      const spamProneDomains = [
        'spam.xyz',
        'phishing.top',
        'scam.club'
      ];

      spamProneDomains.forEach(domain => {
        const analysis = analyzeTLDRisk(domain);
        expect(analysis.category).toBe('suspicious');
        expect(analysis.riskScore).toBeGreaterThan(0.5);
      });
    });
  });
});
