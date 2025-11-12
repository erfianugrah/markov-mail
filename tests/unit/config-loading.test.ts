import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, validateConfig } from '../../src/config/defaults';

describe('Config Loading v2.4.2', () => {
	describe('DEFAULT_CONFIG completeness', () => {
		it('should have all required new v2.4.2 fields', () => {
			// Verify riskWeights (simplified structure)
			expect(DEFAULT_CONFIG.riskWeights).toBeDefined();
			expect(DEFAULT_CONFIG.riskWeights.domainReputation).toBe(0.2);
			expect(DEFAULT_CONFIG.riskWeights.tldRisk).toBe(0.3);

			// Verify no deprecated fields exist
			expect(DEFAULT_CONFIG.riskWeights).not.toHaveProperty('entropy');
			expect(DEFAULT_CONFIG.riskWeights).not.toHaveProperty('patternDetection');
			expect(DEFAULT_CONFIG.riskWeights).not.toHaveProperty('markovChain');

			// Verify adjustments
			expect(DEFAULT_CONFIG.adjustments).toBeDefined();
			expect(DEFAULT_CONFIG.adjustments.professionalEmailFactor).toBe(0.5);
			expect(DEFAULT_CONFIG.adjustments.professionalDomainFactor).toBe(0.5);

			// Verify ensemble
			expect(DEFAULT_CONFIG.ensemble).toBeDefined();
			expect(DEFAULT_CONFIG.ensemble.boostMultiplier).toBe(0.3);
			expect(DEFAULT_CONFIG.ensemble.maxBoost).toBe(0.3);
			expect(DEFAULT_CONFIG.ensemble.tldAgreementThreshold).toBe(0.5);

			// Verify OOD
			expect(DEFAULT_CONFIG.ood).toBeDefined();
			expect(DEFAULT_CONFIG.ood.maxRisk).toBe(0.65);
			expect(DEFAULT_CONFIG.ood.warnZoneMin).toBe(0.35);
		});

		it('should have valid ranges for all v2.4.2 fields', () => {
			// All weights should be 0-1
			expect(DEFAULT_CONFIG.riskWeights.domainReputation).toBeGreaterThanOrEqual(0);
			expect(DEFAULT_CONFIG.riskWeights.domainReputation).toBeLessThanOrEqual(1);
			expect(DEFAULT_CONFIG.riskWeights.tldRisk).toBeGreaterThanOrEqual(0);
			expect(DEFAULT_CONFIG.riskWeights.tldRisk).toBeLessThanOrEqual(1);

			// Adjustments should be 0-1 (reduction factors)
			expect(DEFAULT_CONFIG.adjustments.professionalEmailFactor).toBeGreaterThanOrEqual(0);
			expect(DEFAULT_CONFIG.adjustments.professionalEmailFactor).toBeLessThanOrEqual(1);
			expect(DEFAULT_CONFIG.adjustments.professionalDomainFactor).toBeGreaterThanOrEqual(0);
			expect(DEFAULT_CONFIG.adjustments.professionalDomainFactor).toBeLessThanOrEqual(1);

			// Ensemble should be 0-1
			expect(DEFAULT_CONFIG.ensemble.boostMultiplier).toBeGreaterThanOrEqual(0);
			expect(DEFAULT_CONFIG.ensemble.boostMultiplier).toBeLessThanOrEqual(1);
			expect(DEFAULT_CONFIG.ensemble.maxBoost).toBeGreaterThanOrEqual(0);
			expect(DEFAULT_CONFIG.ensemble.maxBoost).toBeLessThanOrEqual(1);
			expect(DEFAULT_CONFIG.ensemble.tldAgreementThreshold).toBeGreaterThanOrEqual(0);
			expect(DEFAULT_CONFIG.ensemble.tldAgreementThreshold).toBeLessThanOrEqual(1);

			// OOD should be 0-1
			expect(DEFAULT_CONFIG.ood.maxRisk).toBeGreaterThanOrEqual(0);
			expect(DEFAULT_CONFIG.ood.maxRisk).toBeLessThanOrEqual(1);
			expect(DEFAULT_CONFIG.ood.warnZoneMin).toBeGreaterThanOrEqual(0);
			expect(DEFAULT_CONFIG.ood.warnZoneMin).toBeLessThanOrEqual(1);

			// OOD warnZoneMin must be less than maxRisk
			expect(DEFAULT_CONFIG.ood.warnZoneMin).toBeLessThan(DEFAULT_CONFIG.ood.maxRisk);
		});
	});

	describe('Config validation for v2.4.2 fields', () => {
		it('should accept valid custom config with all new fields', () => {
			const customConfig = {
				riskWeights: {
					domainReputation: 0.15,
					tldRisk: 0.25,
				},
				adjustments: {
					professionalEmailFactor: 0.6,
					professionalDomainFactor: 0.7,
				},
				ensemble: {
					boostMultiplier: 0.4,
					maxBoost: 0.4,
					tldAgreementThreshold: 0.6,
				},
				ood: {
					maxRisk: 0.7,
					warnZoneMin: 0.4,
				},
			};

			const result = validateConfig(customConfig);
			expect(result.valid).toBe(true);
			expect(result.errors).toHaveLength(0);
		});

		it('should reject invalid riskWeights values', () => {
			const invalidConfigs = [
				{
					riskWeights: {
						domainReputation: -0.1, // negative
						tldRisk: 0.3,
					},
				},
				{
					riskWeights: {
						domainReputation: 0.2,
						tldRisk: 1.5, // > 1
					},
				},
			];

			for (const config of invalidConfigs) {
				const result = validateConfig(config);
				expect(result.valid).toBe(false);
				expect(result.errors.length).toBeGreaterThan(0);
			}
		});

		it('should reject invalid adjustments values', () => {
			const invalidConfigs = [
				{
					adjustments: {
						professionalEmailFactor: -0.1, // negative
						professionalDomainFactor: 0.5,
					},
				},
				{
					adjustments: {
						professionalEmailFactor: 0.5,
						professionalDomainFactor: 1.5, // > 1
					},
				},
			];

			for (const config of invalidConfigs) {
				const result = validateConfig(config);
				expect(result.valid).toBe(false);
				expect(result.errors.length).toBeGreaterThan(0);
			}
		});

		it('should reject invalid ensemble values', () => {
			const invalidConfigs = [
				{
					ensemble: {
						boostMultiplier: -0.1, // negative
						maxBoost: 0.3,
						tldAgreementThreshold: 0.5,
					},
				},
				{
					ensemble: {
						boostMultiplier: 0.3,
						maxBoost: 1.5, // > 1
						tldAgreementThreshold: 0.5,
					},
				},
				{
					ensemble: {
						boostMultiplier: 0.3,
						maxBoost: 0.3,
						tldAgreementThreshold: 1.2, // > 1
					},
				},
			];

			for (const config of invalidConfigs) {
				const result = validateConfig(config);
				expect(result.valid).toBe(false);
				expect(result.errors.length).toBeGreaterThan(0);
			}
		});

		it('should reject invalid OOD values', () => {
			const invalidConfigs = [
				{
					ood: {
						maxRisk: -0.1, // negative
						warnZoneMin: 0.35,
					},
				},
				{
					ood: {
						maxRisk: 0.65,
						warnZoneMin: 1.5, // > 1
					},
				},
				{
					ood: {
						maxRisk: 0.4,
						warnZoneMin: 0.5, // warnZoneMin >= maxRisk
					},
				},
			];

			for (const config of invalidConfigs) {
				const result = validateConfig(config);
				expect(result.valid).toBe(false);
				expect(result.errors.length).toBeGreaterThan(0);
			}
		});

		it('should accept partial config (only updating subset of new fields)', () => {
			const partialConfig = {
				riskWeights: {
					domainReputation: 0.15,
					tldRisk: 0.25,
				},
				// Only riskWeights provided, others should use defaults
			};

			const result = validateConfig(partialConfig);
			expect(result.valid).toBe(true);
			expect(result.errors).toHaveLength(0);
		});
	});

	describe('Backwards compatibility', () => {
		it('should not have deprecated riskWeights fields', () => {
			const keys = Object.keys(DEFAULT_CONFIG.riskWeights);
			expect(keys).not.toContain('entropy');
			expect(keys).not.toContain('patternDetection');
			expect(keys).not.toContain('markovChain');
			expect(keys).toHaveLength(2); // Only domainReputation and tldRisk
		});

		it('should accept config without new v2.4.2 fields (uses defaults)', () => {
			// Simulate an old config that doesn't have the new fields
			const oldStyleConfig = {
				riskThresholds: {
					block: 0.7,
					warn: 0.4,
				},
			};

			const result = validateConfig(oldStyleConfig);
			expect(result.valid).toBe(true);
			expect(result.errors).toHaveLength(0);
		});
	});

	describe('Config value relationships', () => {
		it('should have warnZoneMin < maxRisk for OOD', () => {
			expect(DEFAULT_CONFIG.ood.warnZoneMin).toBeLessThan(DEFAULT_CONFIG.ood.maxRisk);

			// The formula uses: warnZoneMin + progress * (maxRisk - warnZoneMin)
			// This should produce values between warnZoneMin and maxRisk
			const range = DEFAULT_CONFIG.ood.maxRisk - DEFAULT_CONFIG.ood.warnZoneMin;
			expect(range).toBeGreaterThan(0);
			expect(range).toBeCloseTo(0.3, 2); // 0.65 - 0.35 ≈ 0.3
		});

		it('should have boostMultiplier <= maxBoost for ensemble', () => {
			// maxBoost is the cap, so boostMultiplier should be <= maxBoost
			// (though in practice boostMultiplier is a multiplier and maxBoost is the cap)
			expect(DEFAULT_CONFIG.ensemble.boostMultiplier).toBeLessThanOrEqual(
				DEFAULT_CONFIG.ensemble.maxBoost
			);
		});

		it('should have professional factors <= 1 (reduction not amplification)', () => {
			// Professional email factors should reduce risk, not amplify it
			expect(DEFAULT_CONFIG.adjustments.professionalEmailFactor).toBeLessThanOrEqual(1);
			expect(DEFAULT_CONFIG.adjustments.professionalDomainFactor).toBeLessThanOrEqual(1);
		});
	});

	describe('Migration verification', () => {
		it('should match hardcoded values from pre-v2.4.2', () => {
			// These should match the values that were previously hardcoded
			expect(DEFAULT_CONFIG.riskWeights.domainReputation).toBe(0.2); // was hardcoded as * 0.2
			expect(DEFAULT_CONFIG.riskWeights.tldRisk).toBe(0.3); // was hardcoded as * 0.3
			expect(DEFAULT_CONFIG.adjustments.professionalEmailFactor).toBe(0.5); // was hardcoded as * 0.5
			expect(DEFAULT_CONFIG.adjustments.professionalDomainFactor).toBe(0.5); // was hardcoded as * 0.5
			expect(DEFAULT_CONFIG.ensemble.boostMultiplier).toBe(0.3); // was hardcoded as * 0.3
			expect(DEFAULT_CONFIG.ensemble.maxBoost).toBe(0.3); // was hardcoded cap at 0.3
			expect(DEFAULT_CONFIG.ensemble.tldAgreementThreshold).toBe(0.5); // was hardcoded as > 0.5
			expect(DEFAULT_CONFIG.ood.maxRisk).toBe(0.65); // was OOD_DETECTION.MAX_OOD_RISK
			expect(DEFAULT_CONFIG.ood.warnZoneMin).toBe(0.35); // was hardcoded as 0.35
		});

		it('should maintain functional equivalence with hardcoded values', () => {
			// Test the OOD formula with default values
			const progress = 0.5; // halfway through warn zone
			const abnormalityRisk =
				DEFAULT_CONFIG.ood.warnZoneMin +
				progress * (DEFAULT_CONFIG.ood.maxRisk - DEFAULT_CONFIG.ood.warnZoneMin);

			// Should produce: 0.35 + 0.5 * 0.3 = 0.5
			expect(abnormalityRisk).toBe(0.5);

			// Test ensemble boost with default values
			const classificationRisk = 0.8;
			const tldRiskScore = 0.7;
			const ensembleBoost = Math.min(
				classificationRisk * tldRiskScore * DEFAULT_CONFIG.ensemble.boostMultiplier,
				DEFAULT_CONFIG.ensemble.maxBoost
			);

			// Should produce: min(0.8 * 0.7 * 0.3, 0.3) = min(0.168, 0.3) = 0.168
			expect(ensembleBoost).toBeCloseTo(0.168, 3);
			expect(ensembleBoost).toBeLessThanOrEqual(DEFAULT_CONFIG.ensemble.maxBoost);

			// Test professional email adjustment with default values
			const baseClassificationRisk = 0.6;
			const adjustedRisk = baseClassificationRisk * DEFAULT_CONFIG.adjustments.professionalEmailFactor;

			// Should produce: 0.6 * 0.5 = 0.3
			expect(adjustedRisk).toBe(0.3);
		});
	});
});
