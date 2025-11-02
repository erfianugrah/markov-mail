import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeValidationMetric, type ValidationMetric } from '../../src/utils/metrics';

describe('Analytics Engine Metrics', () => {
	let mockAnalytics: any;
	let capturedDataPoints: any[];

	beforeEach(() => {
		capturedDataPoints = [];
		mockAnalytics = {
			writeDataPoint: vi.fn((dataPoint: any) => {
				capturedDataPoints.push(dataPoint);
			}),
		};
	});

	describe('writeValidationMetric', () => {
		it('should write validation metrics to Analytics Engine', () => {
			const metric: ValidationMetric = {
				decision: 'allow',
				riskScore: 0.15,
				entropyScore: 4.2,
				botScore: 85,
				country: 'US',
				asn: 15169,
				fingerprintHash: 'abc123def456',
				latency: 45,
			};

			writeValidationMetric(mockAnalytics, metric);

			expect(mockAnalytics.writeDataPoint).toHaveBeenCalledTimes(1);
			expect(capturedDataPoints).toHaveLength(1);

			const dataPoint = capturedDataPoints[0];
			expect(dataPoint.blobs).toBeDefined();
			expect(dataPoint.doubles).toBeDefined();
			expect(dataPoint.indexes).toBeDefined();
		});

		it('should correctly map decision to blob1', () => {
			const metric: ValidationMetric = {
				decision: 'block',
				riskScore: 0.95,
				fingerprintHash: 'test123',
				latency: 50,
			};

			writeValidationMetric(mockAnalytics, metric);

			const dataPoint = capturedDataPoints[0];
			expect(dataPoint.blobs[0]).toBe('block');
		});

		it('should correctly map risk score to double1', () => {
			const metric: ValidationMetric = {
				decision: 'warn',
				riskScore: 0.67,
				fingerprintHash: 'test123',
				latency: 50,
			};

			writeValidationMetric(mockAnalytics, metric);

			const dataPoint = capturedDataPoints[0];
			expect(dataPoint.doubles[0]).toBe(0.67);
		});

		it('should handle block reasons', () => {
			const metric: ValidationMetric = {
				decision: 'block',
				riskScore: 0.92,
				blockReason: 'high_risk_score',
				fingerprintHash: 'test123',
				latency: 50,
			};

			writeValidationMetric(mockAnalytics, metric);

			const dataPoint = capturedDataPoints[0];
			expect(dataPoint.blobs[1]).toBe('high_risk_score'); // blob2
		});

		it('should default block reason to "none"', () => {
			const metric: ValidationMetric = {
				decision: 'allow',
				riskScore: 0.10,
				fingerprintHash: 'test123',
				latency: 50,
			};

			writeValidationMetric(mockAnalytics, metric);

			const dataPoint = capturedDataPoints[0];
			expect(dataPoint.blobs[1]).toBe('none'); // blob2
		});

		it('should convert risk score to bucket', () => {
			const testCases = [
				{ riskScore: 0.05, expected: 'very_low' },
				{ riskScore: 0.25, expected: 'low' },
				{ riskScore: 0.50, expected: 'medium' },
				{ riskScore: 0.70, expected: 'high' },
				{ riskScore: 0.95, expected: 'very_high' },
			];

			testCases.forEach(({ riskScore, expected }) => {
				capturedDataPoints = [];
				const metric: ValidationMetric = {
					decision: 'warn',
					riskScore,
					fingerprintHash: 'test123',
					latency: 50,
				};

				writeValidationMetric(mockAnalytics, metric);

				const dataPoint = capturedDataPoints[0];
				expect(dataPoint.blobs[3]).toBe(expected); // blob4 is risk bucket
			});
		});

		it('should handle country and ASN', () => {
			const metric: ValidationMetric = {
				decision: 'allow',
				riskScore: 0.20,
				country: 'GB',
				asn: 12345,
				fingerprintHash: 'test123',
				latency: 50,
			};

			writeValidationMetric(mockAnalytics, metric);

			const dataPoint = capturedDataPoints[0];
			expect(dataPoint.blobs[2]).toBe('GB'); // blob3
			expect(dataPoint.doubles[3]).toBe(12345); // double4
		});

		it('should default country to "unknown"', () => {
			const metric: ValidationMetric = {
				decision: 'allow',
				riskScore: 0.20,
				fingerprintHash: 'test123',
				latency: 50,
			};

			writeValidationMetric(mockAnalytics, metric);

			const dataPoint = capturedDataPoints[0];
			expect(dataPoint.blobs[2]).toBe('unknown'); // blob3
		});

		it('should handle enhanced email fields', () => {
			const metric: ValidationMetric = {
				decision: 'block',
				riskScore: 0.85,
				emailLocalPart: 'suspicious123',
				domain: 'fraud.com',
				tld: 'com',
				fingerprintHash: 'test123',
				latency: 50,
			};

			writeValidationMetric(mockAnalytics, metric);

			const dataPoint = capturedDataPoints[0];
			expect(dataPoint.blobs[4]).toBe('fraud.com'); // blob5 - domain
			expect(dataPoint.blobs[5]).toBe('com'); // blob6 - tld
			expect(dataPoint.blobs[13]).toBe('suspicious123'); // blob14 - emailLocalPart
		});

		it('should handle pattern detection fields', () => {
			const metric: ValidationMetric = {
				decision: 'block',
				riskScore: 0.88,
				patternType: 'random',
				patternFamily: 'gibberish',
				patternConfidence: 0.92,
				fingerprintHash: 'test123',
				latency: 50,
			};

			writeValidationMetric(mockAnalytics, metric);

			const dataPoint = capturedDataPoints[0];
			expect(dataPoint.blobs[6]).toBe('random'); // blob7 - patternType
			expect(dataPoint.blobs[7]).toBe('gibberish'); // blob8 - patternFamily
			expect(dataPoint.doubles[7]).toBe(0.92); // double8 - patternConfidence
		});

		it('should handle boolean flags correctly', () => {
			const metric: ValidationMetric = {
				decision: 'block',
				riskScore: 0.90,
				isDisposable: true,
				isFreeProvider: false,
				hasPlusAddressing: true,
				hasKeyboardWalk: false,
				isGibberish: true,
				fingerprintHash: 'test123',
				latency: 50,
			};

			writeValidationMetric(mockAnalytics, metric);

			const dataPoint = capturedDataPoints[0];
			expect(dataPoint.blobs[8]).toBe('disposable'); // blob9
			expect(dataPoint.blobs[9]).toBe('normal'); // blob10 (not free)
			expect(dataPoint.blobs[10]).toBe('yes'); // blob11 (plus addressing)
			expect(dataPoint.blobs[11]).toBe('no'); // blob12 (no keyboard walk)
			expect(dataPoint.blobs[12]).toBe('yes'); // blob13 (gibberish)
		});

		it('should handle Markov detection fields', () => {
			const metric: ValidationMetric = {
				decision: 'block',
				riskScore: 0.93,
				markovDetected: true,
				markovConfidence: 0.87,
				markovCrossEntropyLegit: 5.2,
				markovCrossEntropyFraud: 2.1,
				fingerprintHash: 'test123',
				latency: 50,
			};

			writeValidationMetric(mockAnalytics, metric);

			const dataPoint = capturedDataPoints[0];
			expect(dataPoint.blobs[18]).toBe('yes'); // blob19 - markovDetected
			expect(dataPoint.doubles[8]).toBe(0.87); // double9 - markovConfidence
			expect(dataPoint.doubles[9]).toBe(5.2); // double10 - markovCrossEntropyLegit
			expect(dataPoint.doubles[10]).toBe(2.1); // double11 - markovCrossEntropyFraud
		});

		it('should handle A/B test fields', () => {
			const metric: ValidationMetric = {
				decision: 'allow',
				riskScore: 0.25,
				experimentId: 'exp_20250102',
				variant: 'treatment',
				bucket: 42,
				fingerprintHash: 'test123',
				latency: 50,
			};

			writeValidationMetric(mockAnalytics, metric);

			const dataPoint = capturedDataPoints[0];
			expect(dataPoint.blobs[19]).toBe('exp_20250102'); // blob20 - experimentId
			expect(dataPoint.blobs[16]).toBe('treatment'); // blob17 - variant
			expect(dataPoint.doubles[12]).toBe(42); // double13 - bucket
		});

		it('should handle online learning fields', () => {
			const metric: ValidationMetric = {
				decision: 'block',
				riskScore: 0.89,
				clientIp: '192.168.1.1',
				userAgent: 'Mozilla/5.0',
				modelVersion: 'v2.0',
				excludeFromTraining: true,
				ipReputationScore: 75,
				fingerprintHash: 'test123',
				latency: 50,
			};

			writeValidationMetric(mockAnalytics, metric);

			const dataPoint = capturedDataPoints[0];
			expect(dataPoint.blobs[14]).toBe('192.168.1.1'); // blob15 - clientIp
			expect(dataPoint.blobs[15]).toBe('Mozilla/5.0'); // blob16 - userAgent
			expect(dataPoint.blobs[17]).toBe('exclude'); // blob18 - excludeFromTraining
			expect(dataPoint.doubles[11]).toBe(75); // double12 - ipReputationScore
		});

		it('should truncate fingerprint hash to 32 chars for index', () => {
			const longHash = 'a'.repeat(64);
			const metric: ValidationMetric = {
				decision: 'allow',
				riskScore: 0.10,
				fingerprintHash: longHash,
				latency: 50,
			};

			writeValidationMetric(mockAnalytics, metric);

			const dataPoint = capturedDataPoints[0];
			expect(dataPoint.indexes[0]).toHaveLength(32);
			expect(dataPoint.indexes[0]).toBe('a'.repeat(32));
		});

		it('should handle latency field', () => {
			const metric: ValidationMetric = {
				decision: 'allow',
				riskScore: 0.15,
				fingerprintHash: 'test123',
				latency: 127,
			};

			writeValidationMetric(mockAnalytics, metric);

			const dataPoint = capturedDataPoints[0];
			expect(dataPoint.doubles[4]).toBe(127); // double5 - latency
		});

		it('should handle undefined analytics gracefully', () => {
			const metric: ValidationMetric = {
				decision: 'allow',
				riskScore: 0.20,
				fingerprintHash: 'test123',
				latency: 50,
			};

			// Should not throw
			expect(() => {
				writeValidationMetric(undefined, metric);
			}).not.toThrow();
		});

		it('should catch and log errors from Analytics Engine', () => {
			const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			const failingAnalytics = {
				writeDataPoint: vi.fn(() => {
					throw new Error('Analytics write failed');
				}),
			};

			const metric: ValidationMetric = {
				decision: 'allow',
				riskScore: 0.20,
				fingerprintHash: 'test123',
				latency: 50,
			};

			// Should not throw - errors are caught
			expect(() => {
				writeValidationMetric(failingAnalytics, metric);
			}).not.toThrow();

			expect(consoleErrorSpy).toHaveBeenCalled();
			consoleErrorSpy.mockRestore();
		});

		it('should write complete data point with all fields', () => {
			const metric: ValidationMetric = {
				decision: 'block',
				riskScore: 0.92,
				entropyScore: 3.5,
				botScore: 15,
				country: 'RU',
				asn: 99999,
				blockReason: 'multiple_signals',
				fingerprintHash: 'complete_hash_123',
				latency: 89,
				emailLocalPart: 'fraud123',
				domain: 'bad.com',
				tld: 'com',
				patternType: 'random',
				patternFamily: 'gibberish',
				isDisposable: true,
				isFreeProvider: false,
				hasPlusAddressing: false,
				hasKeyboardWalk: true,
				isGibberish: true,
				tldRiskScore: 0.75,
				domainReputationScore: 0.85,
				patternConfidence: 0.88,
				markovDetected: true,
				markovConfidence: 0.91,
				markovCrossEntropyLegit: 6.1,
				markovCrossEntropyFraud: 1.8,
				clientIp: '10.0.0.1',
				userAgent: 'BadBot/1.0',
				modelVersion: 'canary',
				excludeFromTraining: true,
				ipReputationScore: 95,
				experimentId: 'exp_full_test',
				variant: 'treatment',
				bucket: 73,
			};

			writeValidationMetric(mockAnalytics, metric);

			const dataPoint = capturedDataPoints[0];

			// Verify structure
			expect(dataPoint.blobs).toHaveLength(20);
			expect(dataPoint.doubles).toHaveLength(13);
			expect(dataPoint.indexes).toHaveLength(1);

			// Spot check key fields
			expect(dataPoint.blobs[0]).toBe('block');
			expect(dataPoint.blobs[1]).toBe('multiple_signals');
			expect(dataPoint.doubles[0]).toBe(0.92);
			expect(dataPoint.indexes[0]).toBe('complete_hash_123'.substring(0, 32));
		});
	});

	describe('Analytics Engine schema limits', () => {
		it('should respect 20 blob limit', () => {
			const metric: ValidationMetric = {
				decision: 'allow',
				riskScore: 0.20,
				fingerprintHash: 'test123',
				latency: 50,
			};

			writeValidationMetric(mockAnalytics, metric);

			const dataPoint = capturedDataPoints[0];
			expect(dataPoint.blobs.length).toBeLessThanOrEqual(20);
		});

		it('should respect 20 double limit', () => {
			const metric: ValidationMetric = {
				decision: 'allow',
				riskScore: 0.20,
				fingerprintHash: 'test123',
				latency: 50,
			};

			writeValidationMetric(mockAnalytics, metric);

			const dataPoint = capturedDataPoints[0];
			expect(dataPoint.doubles.length).toBeLessThanOrEqual(20);
		});

		it('should use exactly 1 index', () => {
			const metric: ValidationMetric = {
				decision: 'allow',
				riskScore: 0.20,
				fingerprintHash: 'test123',
				latency: 50,
			};

			writeValidationMetric(mockAnalytics, metric);

			const dataPoint = capturedDataPoints[0];
			expect(dataPoint.indexes).toHaveLength(1);
		});
	});

	describe('Data type correctness', () => {
		it('should ensure all blobs are strings', () => {
			const metric: ValidationMetric = {
				decision: 'allow',
				riskScore: 0.20,
				country: 'US',
				fingerprintHash: 'test123',
				latency: 50,
			};

			writeValidationMetric(mockAnalytics, metric);

			const dataPoint = capturedDataPoints[0];
			dataPoint.blobs.forEach((blob: any) => {
				expect(typeof blob).toBe('string');
			});
		});

		it('should ensure all doubles are numbers', () => {
			const metric: ValidationMetric = {
				decision: 'allow',
				riskScore: 0.20,
				entropyScore: 4.5,
				botScore: 80,
				latency: 50,
				fingerprintHash: 'test123',
			};

			writeValidationMetric(mockAnalytics, metric);

			const dataPoint = capturedDataPoints[0];
			dataPoint.doubles.forEach((double: any) => {
				expect(typeof double).toBe('number');
			});
		});

		it('should handle missing optional fields with defaults', () => {
			const minimalMetric: ValidationMetric = {
				decision: 'allow',
				riskScore: 0.20,
				fingerprintHash: 'test123',
				latency: 50,
			};

			writeValidationMetric(mockAnalytics, minimalMetric);

			const dataPoint = capturedDataPoints[0];

			// Should have defaults for missing fields
			expect(dataPoint.blobs[1]).toBe('none'); // blockReason
			expect(dataPoint.blobs[2]).toBe('unknown'); // country
			expect(dataPoint.doubles[1]).toBe(0); // entropyScore
			expect(dataPoint.doubles[2]).toBe(0); // botScore
		});
	});
});
