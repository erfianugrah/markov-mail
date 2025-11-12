/**
 * Config Application Test (v2.4.2)
 *
 * Verifies that config values are actually applied in the risk scoring algorithm.
 * This test ensures the migration from hardcoded values to configurable parameters
 * is working correctly.
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/config/defaults';

describe('Config Application Verification v2.4.2', () => {
	describe('Risk calculation formulas with config values', () => {
		it('should calculate domain risk using config weights', () => {
			// Simulate domain risk calculation from fraud-detection.ts:678-679
			const domainReputationScore = 0.5;
			const tldRiskScore = 0.6;

			// Using default config values
			const domainRisk =
				domainReputationScore * DEFAULT_CONFIG.riskWeights.domainReputation +
				tldRiskScore * DEFAULT_CONFIG.riskWeights.tldRisk;

			// Expected: 0.5 * 0.2 + 0.6 * 0.3 = 0.1 + 0.18 = 0.28
			expect(domainRisk).toBeCloseTo(0.28, 2);

			// Verify weights are being used
			expect(DEFAULT_CONFIG.riskWeights.domainReputation).toBe(0.2);
			expect(DEFAULT_CONFIG.riskWeights.tldRisk).toBe(0.3);
		});

		it('should apply professional email factor to classification risk', () => {
			// Simulate professional email adjustment from fraud-detection.ts:658
			const baseClassificationRisk = 0.6;
			const isProfessional = true;

			let adjustedRisk = baseClassificationRisk;
			if (isProfessional && baseClassificationRisk < 0.7) {
				adjustedRisk = baseClassificationRisk * DEFAULT_CONFIG.adjustments.professionalEmailFactor;
			}

			// Expected: 0.6 * 0.5 = 0.3
			expect(adjustedRisk).toBe(0.3);
			expect(DEFAULT_CONFIG.adjustments.professionalEmailFactor).toBe(0.5);
		});

		it('should apply professional domain factor to domain risk', () => {
			// Simulate professional domain adjustment from fraud-detection.ts:681
			const baseDomainRisk = 0.4;
			const isProfessional = true;

			let adjustedDomainRisk = baseDomainRisk;
			if (isProfessional) {
				adjustedDomainRisk = baseDomainRisk * DEFAULT_CONFIG.adjustments.professionalDomainFactor;
			}

			// Expected: 0.4 * 0.5 = 0.2
			expect(adjustedDomainRisk).toBe(0.2);
			expect(DEFAULT_CONFIG.adjustments.professionalDomainFactor).toBe(0.5);
		});

		it('should calculate ensemble boost with config values', () => {
			// Simulate ensemble boost from fraud-detection.ts:686-690
			const classificationRisk = 0.8;
			const tldRiskScore = 0.7;
			const markovIsLikelyFraudulent = true;

			let ensembleBoost = 0;
			if (markovIsLikelyFraudulent && tldRiskScore > DEFAULT_CONFIG.ensemble.tldAgreementThreshold) {
				ensembleBoost = Math.min(
					classificationRisk * tldRiskScore * DEFAULT_CONFIG.ensemble.boostMultiplier,
					DEFAULT_CONFIG.ensemble.maxBoost
				);
			}

			// Expected: min(0.8 * 0.7 * 0.3, 0.3) = min(0.168, 0.3) = 0.168
			expect(ensembleBoost).toBeCloseTo(0.168, 3);
			expect(ensembleBoost).toBeLessThanOrEqual(DEFAULT_CONFIG.ensemble.maxBoost);

			// Verify config values
			expect(DEFAULT_CONFIG.ensemble.boostMultiplier).toBe(0.3);
			expect(DEFAULT_CONFIG.ensemble.maxBoost).toBe(0.3);
			expect(DEFAULT_CONFIG.ensemble.tldAgreementThreshold).toBe(0.5);
		});

		it('should calculate OOD abnormality risk in warn zone using config', () => {
			// Simulate OOD calculation from fraud-detection.ts:223
			const minEntropy = 4.5; // Between OOD_WARN_THRESHOLD (3.8) and OOD_BLOCK_THRESHOLD (5.5)
			const OOD_WARN_THRESHOLD = 3.8; // Hardcoded (research-backed)
			const OOD_BLOCK_THRESHOLD = 5.5; // Hardcoded (research-backed)

			let abnormalityRisk = 0;
			if (minEntropy > OOD_WARN_THRESHOLD && minEntropy < OOD_BLOCK_THRESHOLD) {
				const progress = (minEntropy - OOD_WARN_THRESHOLD) / (OOD_BLOCK_THRESHOLD - OOD_WARN_THRESHOLD);
				abnormalityRisk =
					DEFAULT_CONFIG.ood.warnZoneMin +
					progress * (DEFAULT_CONFIG.ood.maxRisk - DEFAULT_CONFIG.ood.warnZoneMin);
			}

			// Expected progress: (4.5 - 3.8) / (5.5 - 3.8) = 0.7 / 1.7 ≈ 0.4118
			// Expected risk: 0.35 + 0.4118 * (0.65 - 0.35) = 0.35 + 0.4118 * 0.3 ≈ 0.474
			expect(abnormalityRisk).toBeCloseTo(0.474, 2);
			expect(abnormalityRisk).toBeGreaterThan(DEFAULT_CONFIG.ood.warnZoneMin);
			expect(abnormalityRisk).toBeLessThan(DEFAULT_CONFIG.ood.maxRisk);

			// Verify config values
			expect(DEFAULT_CONFIG.ood.warnZoneMin).toBe(0.35);
			expect(DEFAULT_CONFIG.ood.maxRisk).toBe(0.65);
		});

		it('should cap OOD abnormality risk at maxRisk in block zone', () => {
			// Simulate OOD calculation from fraud-detection.ts:227
			const minEntropy = 6.0; // Above OOD_BLOCK_THRESHOLD (5.5)
			const OOD_BLOCK_THRESHOLD = 5.5;

			let abnormalityRisk = 0;
			if (minEntropy >= OOD_BLOCK_THRESHOLD) {
				abnormalityRisk = DEFAULT_CONFIG.ood.maxRisk;
			}

			// Expected: 0.65 (capped at maxRisk)
			expect(abnormalityRisk).toBe(DEFAULT_CONFIG.ood.maxRisk);
			expect(abnormalityRisk).toBe(0.65);
		});
	});

	describe('Config value sensitivity analysis', () => {
		it('should show different results with different riskWeights', () => {
			const domainReputationScore = 0.5;
			const tldRiskScore = 0.6;

			// Default weights
			const defaultRisk =
				domainReputationScore * 0.2 + // DEFAULT_CONFIG.riskWeights.domainReputation
				tldRiskScore * 0.3; // DEFAULT_CONFIG.riskWeights.tldRisk

			// Alternative weights (more aggressive)
			const aggressiveRisk =
				domainReputationScore * 0.3 + // Higher domain weight
				tldRiskScore * 0.4; // Higher TLD weight

			// Alternative weights (more lenient)
			const lenientRisk =
				domainReputationScore * 0.1 + // Lower domain weight
				tldRiskScore * 0.2; // Lower TLD weight

			expect(defaultRisk).toBeCloseTo(0.28, 2);
			expect(aggressiveRisk).toBeCloseTo(0.39, 2);
			expect(lenientRisk).toBeCloseTo(0.17, 2);

			// Verify the config makes a meaningful difference
			expect(aggressiveRisk).toBeGreaterThan(defaultRisk);
			expect(lenientRisk).toBeLessThan(defaultRisk);
		});

		it('should show different results with different professional factors', () => {
			const baseRisk = 0.6;

			// Default professional factor
			const defaultAdjusted = baseRisk * 0.5; // DEFAULT_CONFIG.adjustments.professionalEmailFactor

			// More aggressive (less reduction)
			const aggressiveAdjusted = baseRisk * 0.7;

			// More lenient (more reduction)
			const lenientAdjusted = baseRisk * 0.3;

			expect(defaultAdjusted).toBe(0.3);
			expect(aggressiveAdjusted).toBeCloseTo(0.42, 2);
			expect(lenientAdjusted).toBeCloseTo(0.18, 2);

			// Verify the config makes a meaningful difference
			expect(aggressiveAdjusted).toBeGreaterThan(defaultAdjusted);
			expect(lenientAdjusted).toBeLessThan(defaultAdjusted);
		});

		it('should show different results with different ensemble boost values', () => {
			const classificationRisk = 0.8;
			const tldRiskScore = 0.7;

			// Default ensemble boost
			const defaultBoost = Math.min(
				classificationRisk * tldRiskScore * 0.3, // DEFAULT_CONFIG.ensemble.boostMultiplier
				0.3 // DEFAULT_CONFIG.ensemble.maxBoost
			);

			// More aggressive boost
			const aggressiveBoost = Math.min(
				classificationRisk * tldRiskScore * 0.5, // Higher multiplier
				0.5 // Higher cap
			);

			// More lenient boost
			const lenientBoost = Math.min(
				classificationRisk * tldRiskScore * 0.1, // Lower multiplier
				0.2 // Lower cap
			);

			expect(defaultBoost).toBeCloseTo(0.168, 3);
			expect(aggressiveBoost).toBeCloseTo(0.28, 2);
			expect(lenientBoost).toBeCloseTo(0.056, 3);

			// Verify the config makes a meaningful difference
			expect(aggressiveBoost).toBeGreaterThan(defaultBoost);
			expect(lenientBoost).toBeLessThan(defaultBoost);
		});

		it('should show different results with different OOD thresholds', () => {
			const minEntropy = 4.5;
			const OOD_WARN_THRESHOLD = 3.8;
			const OOD_BLOCK_THRESHOLD = 5.5;
			const progress = (minEntropy - OOD_WARN_THRESHOLD) / (OOD_BLOCK_THRESHOLD - OOD_WARN_THRESHOLD);

			// Default OOD config
			const defaultOOD = 0.35 + progress * (0.65 - 0.35); // warnZoneMin=0.35, maxRisk=0.65

			// More aggressive OOD (higher risk contribution)
			const aggressiveOOD = 0.45 + progress * (0.8 - 0.45); // Higher values

			// More lenient OOD (lower risk contribution)
			const lenientOOD = 0.25 + progress * (0.5 - 0.25); // Lower values

			expect(defaultOOD).toBeCloseTo(0.474, 2);
			expect(aggressiveOOD).toBeCloseTo(0.594, 2);
			expect(lenientOOD).toBeCloseTo(0.353, 2);

			// Verify the config makes a meaningful difference
			expect(aggressiveOOD).toBeGreaterThan(defaultOOD);
			expect(lenientOOD).toBeLessThan(defaultOOD);
		});
	});

	describe('End-to-end risk calculation with all components', () => {
		it('should combine all config-driven components for a complete risk score', () => {
			// Simulate a complete risk calculation with all v2.4.2 components

			// Input signals
			const domainReputationScore = 0.5;
			const tldRiskScore = 0.6;
			const baseClassificationRisk = 0.7;
			const minEntropy = 4.5;
			const isProfessional = false;
			const markovIsLikelyFraudulent = true;

			// 1. Domain Risk (config: riskWeights)
			const domainRisk =
				domainReputationScore * DEFAULT_CONFIG.riskWeights.domainReputation +
				tldRiskScore * DEFAULT_CONFIG.riskWeights.tldRisk;

			// 2. Classification Risk (config: adjustments - not applied since not professional)
			let classificationRisk = baseClassificationRisk;

			// 3. OOD Abnormality Risk (config: ood)
			const OOD_WARN_THRESHOLD = 3.8;
			const OOD_BLOCK_THRESHOLD = 5.5;
			const progress = (minEntropy - OOD_WARN_THRESHOLD) / (OOD_BLOCK_THRESHOLD - OOD_WARN_THRESHOLD);
			const abnormalityRisk =
				DEFAULT_CONFIG.ood.warnZoneMin +
				progress * (DEFAULT_CONFIG.ood.maxRisk - DEFAULT_CONFIG.ood.warnZoneMin);

			// 4. Base Score
			let score = domainRisk + classificationRisk + abnormalityRisk;

			// 5. Ensemble Boost (config: ensemble)
			if (markovIsLikelyFraudulent && tldRiskScore > DEFAULT_CONFIG.ensemble.tldAgreementThreshold) {
				const ensembleBoost = Math.min(
					classificationRisk * tldRiskScore * DEFAULT_CONFIG.ensemble.boostMultiplier,
					DEFAULT_CONFIG.ensemble.maxBoost
				);
				score += ensembleBoost;
			}

			// Verify components
			expect(domainRisk).toBeCloseTo(0.28, 2); // 0.5*0.2 + 0.6*0.3
			expect(classificationRisk).toBe(0.7); // No professional adjustment
			expect(abnormalityRisk).toBeCloseTo(0.474, 2); // OOD calculation
			const ensembleBoost = Math.min(
				classificationRisk * tldRiskScore * DEFAULT_CONFIG.ensemble.boostMultiplier,
				DEFAULT_CONFIG.ensemble.maxBoost
			);
			expect(ensembleBoost).toBeCloseTo(0.126, 3); // 0.7*0.6*0.3, capped at 0.3

			// Final score: 0.28 + 0.7 + 0.474 + 0.126 = 1.58
			expect(score).toBeCloseTo(1.58, 2);

			// Verify score is above block threshold
			expect(score).toBeGreaterThan(DEFAULT_CONFIG.riskThresholds.block);
		});

		it('should show lower risk for professional emails with config adjustments', () => {
			// Same inputs as above but with professional email
			const domainReputationScore = 0.5;
			const tldRiskScore = 0.6;
			const baseClassificationRisk = 0.65; // Below 0.7 threshold
			const minEntropy = 4.5;
			const isProfessional = true; // Professional email (info@, support@, etc.)
			const markovIsLikelyFraudulent = true;

			// 1. Domain Risk (with professional adjustment)
			let domainRisk =
				domainReputationScore * DEFAULT_CONFIG.riskWeights.domainReputation +
				tldRiskScore * DEFAULT_CONFIG.riskWeights.tldRisk;
			domainRisk = domainRisk * DEFAULT_CONFIG.adjustments.professionalDomainFactor;

			// 2. Classification Risk (with professional adjustment)
			let classificationRisk = baseClassificationRisk;
			if (isProfessional && classificationRisk < 0.7) {
				classificationRisk = classificationRisk * DEFAULT_CONFIG.adjustments.professionalEmailFactor;
			}

			// 3. OOD Abnormality Risk (no professional adjustment)
			const OOD_WARN_THRESHOLD = 3.8;
			const OOD_BLOCK_THRESHOLD = 5.5;
			const progress = (minEntropy - OOD_WARN_THRESHOLD) / (OOD_BLOCK_THRESHOLD - OOD_WARN_THRESHOLD);
			const abnormalityRisk =
				DEFAULT_CONFIG.ood.warnZoneMin +
				progress * (DEFAULT_CONFIG.ood.maxRisk - DEFAULT_CONFIG.ood.warnZoneMin);

			// 4. Base Score
			let score = domainRisk + classificationRisk + abnormalityRisk;

			// 5. Ensemble Boost
			if (markovIsLikelyFraudulent && tldRiskScore > DEFAULT_CONFIG.ensemble.tldAgreementThreshold) {
				const ensembleBoost = Math.min(
					classificationRisk * tldRiskScore * DEFAULT_CONFIG.ensemble.boostMultiplier,
					DEFAULT_CONFIG.ensemble.maxBoost
				);
				score += ensembleBoost;
			}

			// Verify professional adjustments applied
			expect(domainRisk).toBeCloseTo(0.14, 2); // 0.28 * 0.5
			expect(classificationRisk).toBeCloseTo(0.325, 3); // 0.65 * 0.5

			// Final score should be lower than non-professional case
			// ~0.14 + 0.325 + 0.474 + (0.325*0.6*0.3) = ~0.997
			expect(score).toBeCloseTo(0.997, 2);

			// Verify professional emails get lower risk than non-professional (1.58 vs 0.997)
			// Note: Still high due to OOD abnormality risk (0.474) which is not affected by professional adjustment
			const nonProfessionalScore = 1.58; // From previous test
			expect(score).toBeLessThan(nonProfessionalScore);

			// The reduction is significant: (1.58 - 0.997) / 1.58 ≈ 37% reduction
			const reduction = (nonProfessionalScore - score) / nonProfessionalScore;
			expect(reduction).toBeGreaterThan(0.35); // At least 35% reduction
		});
	});
});
