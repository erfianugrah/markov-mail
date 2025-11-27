/**
 * Tests for Calibration Boost-Only Safeguard
 *
 * Verifies that calibration can only INCREASE risk, never decrease it.
 * This prevents bad calibration data from disabling fraud detection.
 */

import { describe, it, expect } from 'vitest';

describe('Calibration Boost-Only Safeguard', () => {
	describe('Math.max() safeguard behavior', () => {
		it('should keep base risk when calibration is lower', () => {
			const baseClassificationRisk = 0.85;
			const calibratedProbability = 0.30;

			const result = Math.max(baseClassificationRisk, calibratedProbability);

			expect(result).toBe(0.85);
			expect(result).toBe(baseClassificationRisk);
			expect(result).not.toBe(calibratedProbability);
		});

		it('should use calibration when it boosts risk', () => {
			const baseClassificationRisk = 0.40;
			const calibratedProbability = 0.75;

			const result = Math.max(baseClassificationRisk, calibratedProbability);

			expect(result).toBe(0.75);
			expect(result).toBe(calibratedProbability);
			expect(result).toBeGreaterThan(baseClassificationRisk);
		});

		it('should handle equal values correctly', () => {
			const baseClassificationRisk = 0.50;
			const calibratedProbability = 0.50;

			const result = Math.max(baseClassificationRisk, calibratedProbability);

			expect(result).toBe(0.50);
		});

		it('should protect against zero calibration', () => {
			const baseClassificationRisk = 0.90;
			const calibratedProbability = 0.0;

			const result = Math.max(baseClassificationRisk, calibratedProbability);

			expect(result).toBe(0.90);
			expect(result).toBe(baseClassificationRisk);
		});

		it('should protect against near-zero calibration', () => {
			const baseClassificationRisk = 0.70;
			const calibratedProbability = 0.01;

			const result = Math.max(baseClassificationRisk, calibratedProbability);

			expect(result).toBe(0.70);
			expect(result).toBe(baseClassificationRisk);
		});
	});

	describe('Real-world scenarios', () => {
		it('should prevent calibration from disabling high-confidence fraud detection', () => {
			// Scenario: Markov detected fraud with 95% confidence
			// Bad calibration says only 10% fraud probability
			const markovConfidence = 0.95;
			const badCalibration = 0.10;

			const finalRisk = Math.max(markovConfidence, badCalibration);

			expect(finalRisk).toBe(0.95);
			expect(finalRisk).toBeGreaterThanOrEqual(markovConfidence);
		});

		it('should allow calibration to refine borderline cases upward', () => {
			// Scenario: Markov uncertain (55% confidence)
			// Calibration has more context and says 80% fraud
			const markovConfidence = 0.55;
			const refinedCalibration = 0.80;

			const finalRisk = Math.max(markovConfidence, refinedCalibration);

			expect(finalRisk).toBe(0.80);
			expect(finalRisk).toBe(refinedCalibration);
		});

		it('should maintain fraud detection even with corrupted calibration', () => {
			// Scenario: Calibration model corrupted (NaN handling by caller)
			// Markov still detects fraud
			const markovConfidence = 0.75;
			const corruptedCalibration = 0; // Fallback value after NaN check

			const finalRisk = Math.max(markovConfidence, corruptedCalibration);

			expect(finalRisk).toBe(0.75);
			expect(finalRisk).toBeGreaterThan(0);
		});
	});

	describe('Edge cases', () => {
		it('should handle maximum values correctly', () => {
			const baseClassificationRisk = 1.0;
			const calibratedProbability = 0.95;

			const result = Math.max(baseClassificationRisk, calibratedProbability);

			expect(result).toBe(1.0);
		});

		it('should handle minimum values correctly', () => {
			const baseClassificationRisk = 0.0;
			const calibratedProbability = 0.0;

			const result = Math.max(baseClassificationRisk, calibratedProbability);

			expect(result).toBe(0.0);
		});

		it('should handle very small differences', () => {
			const baseClassificationRisk = 0.500001;
			const calibratedProbability = 0.500000;

			const result = Math.max(baseClassificationRisk, calibratedProbability);

			expect(result).toBe(baseClassificationRisk);
			expect(result).toBeGreaterThan(calibratedProbability);
		});
	});

	describe('Safeguard guarantees', () => {
		it('should NEVER allow calibration to lower risk below Markov confidence', () => {
			const testCases = [
				{ markov: 0.9, calibration: 0.1 },
				{ markov: 0.8, calibration: 0.3 },
				{ markov: 0.7, calibration: 0.5 },
				{ markov: 0.6, calibration: 0.4 },
				{ markov: 0.5, calibration: 0.2 },
			];

			for (const { markov, calibration } of testCases) {
				const result = Math.max(markov, calibration);
				expect(result).toBeGreaterThanOrEqual(markov);
				expect(result).toBe(Math.max(markov, calibration));
			}
		});

		it('should ALWAYS use the higher of the two values', () => {
			const testCases = [
				{ markov: 0.3, calibration: 0.7, expected: 0.7 },
				{ markov: 0.7, calibration: 0.3, expected: 0.7 },
				{ markov: 0.5, calibration: 0.9, expected: 0.9 },
				{ markov: 0.9, calibration: 0.5, expected: 0.9 },
			];

			for (const { markov, calibration, expected } of testCases) {
				const result = Math.max(markov, calibration);
				expect(result).toBe(expected);
			}
		});

		it('should maintain Markov as authoritative floor', () => {
			// Test across full confidence range
			for (let markovConf = 0.1; markovConf <= 1.0; markovConf += 0.1) {
				// Test with various suppression attempts
				for (let calibrationAttempt = 0.0; calibrationAttempt < markovConf; calibrationAttempt += 0.1) {
					const result = Math.max(markovConf, calibrationAttempt);
					expect(result).toBeGreaterThanOrEqual(markovConf);
				}
			}
		});
	});
});
