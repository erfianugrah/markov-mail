/**
 * Tests for Platt scaling (1D logistic regression).
 */
import { describe, it, expect } from 'vitest';
import { fitPlattScaling, applyPlattScaling } from '../../../src/training/platt-scaling';

describe('Platt Scaling', () => {
	describe('fitPlattScaling', () => {
		it('should fit a positive coefficient for well-separated scores', () => {
			// Legit samples have low scores, fraud samples have high scores
			const scores = [0.1, 0.15, 0.2, 0.12, 0.18, 0.85, 0.9, 0.88, 0.95, 0.87];
			const labels = [0, 0, 0, 0, 0, 1, 1, 1, 1, 1];

			const result = fitPlattScaling(scores, labels);

			expect(result.coef).toBeGreaterThan(0);
			expect(result.samples).toBe(10);
			expect(result.iterations).toBeGreaterThan(0);
			expect(result.iterations).toBeLessThanOrEqual(100);
		});

		it('should produce calibrated probabilities near 0 and 1 for separated data', () => {
			const scores: number[] = [];
			const labels: number[] = [];

			// 50 legit with scores around 0.1-0.3
			for (let i = 0; i < 50; i++) {
				scores.push(0.1 + (i / 50) * 0.2);
				labels.push(0);
			}
			// 50 fraud with scores around 0.7-0.9
			for (let i = 0; i < 50; i++) {
				scores.push(0.7 + (i / 50) * 0.2);
				labels.push(1);
			}

			const result = fitPlattScaling(scores, labels);

			// Low scores should calibrate near 0
			const lowCalibrated = applyPlattScaling(0.1, result.coef, result.intercept);
			expect(lowCalibrated).toBeLessThan(0.3);

			// High scores should calibrate near 1
			const highCalibrated = applyPlattScaling(0.9, result.coef, result.intercept);
			expect(highCalibrated).toBeGreaterThan(0.7);
		});

		it('should converge in reasonable iterations', () => {
			// Seeded PRNG (mulberry32) for deterministic tests — Math.random() flakes
			let seed = 42;
			const rand = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

			const scores: number[] = [];
			const labels: number[] = [];

			for (let i = 0; i < 200; i++) {
				scores.push(i < 100 ? 0.2 + rand() * 0.2 : 0.6 + rand() * 0.2);
				labels.push(i < 100 ? 0 : 1);
			}

			const result = fitPlattScaling(scores, labels);
			expect(result.iterations).toBeLessThan(50);
		});

		it('should throw on fewer than 10 samples', () => {
			expect(() => fitPlattScaling([0.1, 0.9], [0, 1])).toThrow('at least 10');
		});

		it('should throw on single-class data', () => {
			const scores = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95];
			const labels = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

			expect(() => fitPlattScaling(scores, labels)).toThrow('both classes');
		});

		it('should throw on mismatched lengths', () => {
			expect(() => fitPlattScaling([0.1, 0.2], [0])).toThrow('does not match');
		});

		it('should round coefficients to 6 decimal places', () => {
			const scores: number[] = [];
			const labels: number[] = [];
			for (let i = 0; i < 50; i++) {
				scores.push(i < 25 ? 0.2 : 0.8);
				labels.push(i < 25 ? 0 : 1);
			}

			const result = fitPlattScaling(scores, labels);

			const coefStr = result.coef.toString();
			const interceptStr = result.intercept.toString();
			const coefDecimals = coefStr.includes('.') ? coefStr.split('.')[1].length : 0;
			const interceptDecimals = interceptStr.includes('.') ? interceptStr.split('.')[1].length : 0;

			expect(coefDecimals).toBeLessThanOrEqual(6);
			expect(interceptDecimals).toBeLessThanOrEqual(6);
		});
	});

	describe('applyPlattScaling', () => {
		it('should return 0.5 when coef*score + intercept = 0', () => {
			// sigmoid(0) = 0.5
			const result = applyPlattScaling(0, 1, 0);
			expect(result).toBeCloseTo(0.5, 5);
		});

		it('should handle extreme positive logits', () => {
			const result = applyPlattScaling(1000, 1, 0);
			expect(result).toBe(1);
		});

		it('should handle extreme negative logits', () => {
			const result = applyPlattScaling(-1000, 1, 0);
			expect(result).toBeCloseTo(0, 10);
		});

		it('should be monotonically increasing for positive coef', () => {
			const coef = 5;
			const intercept = -2;
			let prev = -1;
			for (let s = 0; s <= 1; s += 0.1) {
				const result = applyPlattScaling(s, coef, intercept);
				expect(result).toBeGreaterThanOrEqual(prev);
				prev = result;
			}
		});
	});
});
