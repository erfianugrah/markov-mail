import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, validateConfig } from '../../src/config/defaults';

describe('Config defaults (decision-tree reset)', () => {
	it('exposes the lean set of tuning knobs we expect', () => {
		expect(DEFAULT_CONFIG.riskThresholds.block).toBeCloseTo(0.65);
		expect(DEFAULT_CONFIG.riskThresholds.warn).toBeCloseTo(0.35);

		expect(DEFAULT_CONFIG.baseRiskScores.invalidFormat).toBeGreaterThan(0.5);
		expect(DEFAULT_CONFIG.baseRiskScores.disposableDomain).toBeGreaterThan(0.9);

		expect(DEFAULT_CONFIG.features.enableDisposableCheck).toBe(true);
		expect(DEFAULT_CONFIG.features.enablePatternCheck).toBe(true);
		expect(DEFAULT_CONFIG.features.enableTLDRiskProfiling).toBe(true);

		expect(DEFAULT_CONFIG.riskWeights.domainReputation).toBeGreaterThan(0);
		expect(DEFAULT_CONFIG.riskWeights.tldRisk).toBeGreaterThan(0);

		expect(DEFAULT_CONFIG.patternThresholds.sequential).toBeGreaterThan(0);
		expect(DEFAULT_CONFIG.patternThresholds.plusAddressing).toBeGreaterThan(0);

		expect(DEFAULT_CONFIG.adjustments.professionalEmailFactor).toBeLessThan(1);
		expect(DEFAULT_CONFIG.adjustments.professionalDomainFactor).toBeLessThan(1);
		expect(DEFAULT_CONFIG.adjustments.professionalAbnormalityFactor).toBeLessThan(1);
	});
});

describe('validateConfig', () => {
	it('accepts overrides inside the valid ranges', () => {
		const result = validateConfig({
			riskThresholds: { block: 0.7, warn: 0.4 },
			riskWeights: { domainReputation: 0.15, tldRisk: 0.4 },
			adjustments: {
				professionalEmailFactor: 0.4,
				professionalDomainFactor: 0.4,
				professionalAbnormalityFactor: 0.6,
			},
			ood: { maxRisk: 0.7, warnZoneMin: 0.3 },
			patternThresholds: { sequential: 0.7, dated: 0.8, plusAddressing: 0.6 },
		});

		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it('rejects invalid risk thresholds', () => {
		const result = validateConfig({ riskThresholds: { block: 0.2, warn: 0.3 } });
		expect(result.valid).toBe(false);
		expect(result.errors).toContain('riskThresholds.warn must be less than riskThresholds.block');
	});

	it('rejects invalid risk weights', () => {
		const result = validateConfig({ riskWeights: { domainReputation: -0.1, tldRisk: 1.2 } as any });
		expect(result.valid).toBe(false);
		expect(result.errors.length).toBe(2);
	});

	it('rejects invalid adjustments', () => {
		const result = validateConfig({
			adjustments: {
				professionalEmailFactor: -0.2,
				professionalDomainFactor: 1.1,
				professionalAbnormalityFactor: 1.5,
			},
		});
		expect(result.valid).toBe(false);
		expect(result.errors.length).toBe(3);
	});

	it('rejects invalid OOD settings', () => {
		const result = validateConfig({ ood: { maxRisk: 0.3, warnZoneMin: 0.4 } });
		expect(result.valid).toBe(false);
		expect(result.errors).toContain('ood.warnZoneMin must be less than ood.maxRisk');
	});
});
