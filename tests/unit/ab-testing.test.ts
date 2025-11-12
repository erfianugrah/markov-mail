import { describe, it, expect } from 'vitest';
import {
	getVariant,
	getAssignment,
	getVariantConfig,
	isExperimentActive,
	validateExperimentConfig,
	type ABTestConfig,
} from '../../src/ab-testing';
import type { FraudDetectionConfig } from '../../src/config/defaults';

describe('A/B Testing Framework', () => {
	describe('getVariant', () => {
		it('should consistently assign same hash to same variant', () => {
			const config: ABTestConfig = {
				experimentId: 'test_exp',
				description: 'Test experiment',
				variants: {
					control: { weight: 90 },
					treatment: { weight: 10 },
				},
				startDate: '2025-01-01T00:00:00Z',
				endDate: '2025-12-31T23:59:59Z',
				enabled: true,
			};

			const hash = 'abc123def456';
			const variant1 = getVariant(hash, config);
			const variant2 = getVariant(hash, config);

			expect(variant1).toBe(variant2);
		});

		it('should distribute traffic according to weights', () => {
			const config: ABTestConfig = {
				experimentId: 'test_exp',
				description: 'Test experiment',
				variants: {
					control: { weight: 90 },
					treatment: { weight: 10 },
				},
				startDate: '2025-01-01T00:00:00Z',
				endDate: '2025-12-31T23:59:59Z',
				enabled: true,
			};

			// Test 100 different hashes
			let treatmentCount = 0;
			for (let i = 0; i < 100; i++) {
				const hash = `${i.toString(16).padStart(8, '0')}`;
				const variant = getVariant(hash, config);
				if (variant === 'treatment') {
					treatmentCount++;
				}
			}

			// Should be close to 10% (allow 5% margin of error)
			expect(treatmentCount).toBeGreaterThanOrEqual(5);
			expect(treatmentCount).toBeLessThanOrEqual(15);
		});

		it('should handle 50/50 split', () => {
			const config: ABTestConfig = {
				experimentId: 'test_exp',
				description: 'Test experiment',
				variants: {
					control: { weight: 50 },
					treatment: { weight: 50 },
				},
				startDate: '2025-01-01T00:00:00Z',
				endDate: '2025-12-31T23:59:59Z',
				enabled: true,
			};

			let treatmentCount = 0;
			for (let i = 0; i < 100; i++) {
				const hash = `${i.toString(16).padStart(8, '0')}`;
				const variant = getVariant(hash, config);
				if (variant === 'treatment') {
					treatmentCount++;
				}
			}

			// Should be close to 50% (allow 10% margin)
			expect(treatmentCount).toBeGreaterThanOrEqual(40);
			expect(treatmentCount).toBeLessThanOrEqual(60);
		});
	});

	describe('getAssignment', () => {
		it('should return full assignment details', () => {
			const config: ABTestConfig = {
				experimentId: 'test_exp_123',
				description: 'Test experiment',
				variants: {
					control: { weight: 90 },
					treatment: { weight: 10 },
				},
				startDate: '2025-01-01T00:00:00Z',
				endDate: '2025-12-31T23:59:59Z',
				enabled: true,
			};

			const hash = 'abc123def456';
			const assignment = getAssignment(hash, config);

			expect(assignment.fingerprintHash).toBe(hash);
			expect(assignment.experimentId).toBe('test_exp_123');
			expect(assignment.variant).toMatch(/^(control|treatment)$/);
			expect(assignment.bucket).toBeGreaterThanOrEqual(0);
			expect(assignment.bucket).toBeLessThanOrEqual(99);
		});
	});

	describe('getVariantConfig', () => {
		it('should merge variant overrides with base config', () => {
			const baseConfig: FraudDetectionConfig = {
				riskThresholds: {
					block: 0.6,
					warn: 0.3,
				},
				baseRiskScores: {
					invalidFormat: 0.8,
					disposableDomain: 0.95,
					highEntropy: 0.7,
				},
				confidenceThresholds: {
					markovFraud: 0.7,
					markovRisk: 0.6,
					patternRisk: 0.5,
				},
				riskWeights: {
					domainReputation: 0.2,
					tldRisk: 0.3,
				},
				features: {
					enableMxCheck: false,
					enableDisposableCheck: true,
					enablePatternCheck: true,
					enableNGramAnalysis: true,
					enableTLDRiskProfiling: true,
					enableBenfordsLaw: true,
					enableKeyboardWalkDetection: true,
					enableMarkovChainDetection: true,
				},
				logging: {
					logAllValidations: true,
					logLevel: 'info',
					logBlocks: true,
				},
				headers: {
					enableResponseHeaders: true,
					enableOriginHeaders: false,
					originUrl: '',
				},
				actionOverride: 'allow',
				patternThresholds: {
					sequential: 0.8,
					dated: 0.7,
					plusAddressing: 0.6,
					keyboardWalk: 0.8,
					gibberish: 0.9,
				},
				rateLimiting: {
					enabled: false,
					maxValidationsPerMinute: 60,
					maxValidationsPerHour: 1000,
				},
				admin: {
					enabled: false,
				},
				markov: {
					adaptationRate: 0.5,
					minTrainingExamples: 100,
					retrainIntervalDays: 7,
				},
				adjustments: {
					professionalEmailFactor: 0.5,
					professionalDomainFactor: 0.5,
				},
				ensemble: {
					boostMultiplier: 0.3,
					maxBoost: 0.3,
					tldAgreementThreshold: 0.5,
				},
				ood: {
					maxRisk: 0.65,
					warnZoneMin: 0.35,
				},
			};

			const abConfig: ABTestConfig = {
				experimentId: 'test_risk_weights',
				description: 'Test risk weight adjustments',
				variants: {
					control: { weight: 90 },
					treatment: {
						weight: 10,
						config: {
							riskWeights: {
								domainReputation: 0.15,
								tldRisk: 0.15,
							},
						},
					},
				},
				startDate: '2025-01-01T00:00:00Z',
				endDate: '2025-12-31T23:59:59Z',
				enabled: true,
			};

			const treatmentConfig = getVariantConfig('treatment', abConfig, baseConfig);

			// Treatment config should have overridden weights (0.15 from variant config)
			expect(treatmentConfig.riskWeights.domainReputation).toBe(0.15);
			expect(treatmentConfig.riskWeights.tldRisk).toBe(0.15);
			// Other configs should remain unchanged (from base config)
			expect(treatmentConfig.riskThresholds.block).toBe(0.6);
			expect(treatmentConfig.features.enablePatternCheck).toBe(true);
		});

		it('should not modify base config when no overrides', () => {
			const baseConfig: FraudDetectionConfig = {
				riskThresholds: {
					block: 0.6,
					warn: 0.3,
				},
				baseRiskScores: {
					invalidFormat: 0.8,
					disposableDomain: 0.95,
					highEntropy: 0.7,
				},
				confidenceThresholds: {
					markovFraud: 0.7,
					markovRisk: 0.6,
					patternRisk: 0.5,
				},
				riskWeights: {
					domainReputation: 0.2,
					tldRisk: 0.3,
				},
				features: {
					enableMxCheck: false,
					enableDisposableCheck: true,
					enablePatternCheck: true,
					enableNGramAnalysis: true,
					enableTLDRiskProfiling: true,
					enableBenfordsLaw: true,
					enableKeyboardWalkDetection: true,
					enableMarkovChainDetection: true,
				},
				logging: {
					logAllValidations: true,
					logLevel: 'info',
					logBlocks: true,
				},
				headers: {
					enableResponseHeaders: true,
					enableOriginHeaders: false,
					originUrl: '',
				},
				actionOverride: 'allow',
				patternThresholds: {
					sequential: 0.8,
					dated: 0.7,
					plusAddressing: 0.6,
					keyboardWalk: 0.8,
					gibberish: 0.9,
				},
				rateLimiting: {
					enabled: false,
					maxValidationsPerMinute: 60,
					maxValidationsPerHour: 1000,
				},
				admin: {
					enabled: false,
				},
				markov: {
					adaptationRate: 0.5,
					minTrainingExamples: 100,
					retrainIntervalDays: 7,
				},
				adjustments: {
					professionalEmailFactor: 0.5,
					professionalDomainFactor: 0.5,
				},
				ensemble: {
					boostMultiplier: 0.3,
					maxBoost: 0.3,
					tldAgreementThreshold: 0.5,
				},
				ood: {
					maxRisk: 0.65,
					warnZoneMin: 0.35,
				},
			};

			const abConfig: ABTestConfig = {
				experimentId: 'test_no_override',
				description: 'Test without overrides',
				variants: {
					control: { weight: 50 },
					treatment: { weight: 50 },
					// No config overrides
				},
				startDate: '2025-01-01T00:00:00Z',
				endDate: '2025-12-31T23:59:59Z',
				enabled: true,
			};

			const controlConfig = getVariantConfig('control', abConfig, baseConfig);

			expect(controlConfig.riskWeights).toEqual(baseConfig.riskWeights);
		});
	});

	describe('isExperimentActive', () => {
		it('should return false if not enabled', () => {
			const config: ABTestConfig = {
				experimentId: 'test',
				description: 'Test',
				variants: {
					control: { weight: 50 },
					treatment: { weight: 50 },
				},
				startDate: '2025-01-01T00:00:00Z',
				endDate: '2025-12-31T23:59:59Z',
				enabled: false,
			};

			expect(isExperimentActive(config)).toBe(false);
		});

		it('should return false if before start date', () => {
			const config: ABTestConfig = {
				experimentId: 'test',
				description: 'Test',
				variants: {
					control: { weight: 50 },
					treatment: { weight: 50 },
				},
				startDate: '2099-01-01T00:00:00Z',
				endDate: '2099-12-31T23:59:59Z',
				enabled: true,
			};

			expect(isExperimentActive(config)).toBe(false);
		});

		it('should return false if after end date', () => {
			const config: ABTestConfig = {
				experimentId: 'test',
				description: 'Test',
				variants: {
					control: { weight: 50 },
					treatment: { weight: 50 },
				},
				startDate: '2020-01-01T00:00:00Z',
				endDate: '2020-12-31T23:59:59Z',
				enabled: true,
			};

			expect(isExperimentActive(config)).toBe(false);
		});

		it('should return true if active and within date range', () => {
			const now = new Date();
			const start = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 1 day ago
			const end = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 1 day from now

			const config: ABTestConfig = {
				experimentId: 'test',
				description: 'Test',
				variants: {
					control: { weight: 50 },
					treatment: { weight: 50 },
				},
				startDate: start.toISOString(),
				endDate: end.toISOString(),
				enabled: true,
			};

			expect(isExperimentActive(config)).toBe(true);
		});
	});

	describe('validateExperimentConfig', () => {
		it('should pass for valid config', () => {
			const config: ABTestConfig = {
				experimentId: 'valid_test',
				description: 'Valid test',
				variants: {
					control: { weight: 90 },
					treatment: { weight: 10 },
				},
				startDate: '2025-01-01T00:00:00Z',
				endDate: '2025-12-31T23:59:59Z',
				enabled: true,
			};

			const result = validateExperimentConfig(config);
			expect(result.valid).toBe(true);
			expect(result.errors).toHaveLength(0);
		});

		it('should fail if weights do not sum to 100', () => {
			const config: ABTestConfig = {
				experimentId: 'invalid_test',
				description: 'Invalid test',
				variants: {
					control: { weight: 80 },
					treatment: { weight: 10 },
				},
				startDate: '2025-01-01T00:00:00Z',
				endDate: '2025-12-31T23:59:59Z',
				enabled: true,
			};

			const result = validateExperimentConfig(config);
			expect(result.valid).toBe(false);
			expect(result.errors).toContain('Variant weights must sum to 100 (currently 90)');
		});

		it('should fail if start date is after end date', () => {
			const config: ABTestConfig = {
				experimentId: 'invalid_test',
				description: 'Invalid test',
				variants: {
					control: { weight: 90 },
					treatment: { weight: 10 },
				},
				startDate: '2025-12-31T23:59:59Z',
				endDate: '2025-01-01T00:00:00Z',
				enabled: true,
			};

			const result = validateExperimentConfig(config);
			expect(result.valid).toBe(false);
			expect(result.errors).toContain('startDate must be before endDate');
		});

		it('should fail if experimentId is missing', () => {
			const config: ABTestConfig = {
				experimentId: '',
				description: 'Invalid test',
				variants: {
					control: { weight: 90 },
					treatment: { weight: 10 },
				},
				startDate: '2025-01-01T00:00:00Z',
				endDate: '2025-12-31T23:59:59Z',
				enabled: true,
			};

			const result = validateExperimentConfig(config);
			expect(result.valid).toBe(false);
			expect(result.errors).toContain('experimentId is required');
		});
	});
});
