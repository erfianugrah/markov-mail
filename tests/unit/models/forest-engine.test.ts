import { describe, it, expect } from 'vitest';
import {
	predictForestScore,
	predictForestScoreDetailed,
	checkFeatureAlignment,
	validateForestModel,
	type ForestModel,
	type CompactTreeNode,
} from '../../../src/detectors/forest-engine';

/**
 * M3 fix: golden-value + edge-case tests for the Random Forest inference engine.
 * Previously there were zero tests verifying forest inference correctness.
 */

// Minimal valid model: single tree, single split on feature "entropy"
// entropy <= 0.5 → leaf 0.1 (legit), entropy > 0.5 → leaf 0.9 (fraud)
const SINGLE_TREE_MODEL: ForestModel = {
	meta: {
		version: 'test-v1',
		features: ['entropy', 'digit_ratio'],
		tree_count: 1,
	},
	forest: [
		{
			t: 'n',
			f: 'entropy',
			v: 0.5,
			l: { t: 'l', v: 0.1 },
			r: { t: 'l', v: 0.9 },
		},
	],
};

// Two-tree model for averaging behavior
const TWO_TREE_MODEL: ForestModel = {
	meta: {
		version: 'test-v2',
		features: ['entropy', 'digit_ratio'],
		tree_count: 2,
	},
	forest: [
		// Tree 1: entropy <= 0.5 → 0.2, else → 0.8
		{
			t: 'n',
			f: 'entropy',
			v: 0.5,
			l: { t: 'l', v: 0.2 },
			r: { t: 'l', v: 0.8 },
		},
		// Tree 2: digit_ratio <= 0.3 → 0.1, else → 0.7
		{
			t: 'n',
			f: 'digit_ratio',
			v: 0.3,
			l: { t: 'l', v: 0.1 },
			r: { t: 'l', v: 0.7 },
		},
	],
};

// Model with calibration metadata for Platt scaling test
const CALIBRATED_MODEL: ForestModel = {
	meta: {
		version: 'test-calibrated',
		features: ['entropy'],
		tree_count: 1,
		calibration: {
			method: 'platt',
			intercept: 0,  // sigmoid(coef * x + 0)
			coef: 10,       // steep sigmoid
			samples: 1000,
		},
	},
	forest: [
		{ t: 'l', v: 0.5 }, // Always returns 0.5
	],
};

describe('forest-engine', () => {
	describe('predictForestScore', () => {
		it('returns correct score for left branch (entropy <= threshold)', () => {
			const score = predictForestScore(SINGLE_TREE_MODEL, { entropy: 0.3, digit_ratio: 0.1 });
			expect(score).toBe(0.1);
		});

		it('returns correct score for right branch (entropy > threshold)', () => {
			const score = predictForestScore(SINGLE_TREE_MODEL, { entropy: 0.7, digit_ratio: 0.1 });
			expect(score).toBe(0.9);
		});

		it('goes left when feature equals threshold exactly (scikit-learn convention)', () => {
			const score = predictForestScore(SINGLE_TREE_MODEL, { entropy: 0.5, digit_ratio: 0.1 });
			expect(score).toBe(0.1);
		});

		it('averages scores across multiple trees', () => {
			// Tree 1: entropy=0.3 <= 0.5 → 0.2; Tree 2: digit_ratio=0.5 > 0.3 → 0.7
			const score = predictForestScore(TWO_TREE_MODEL, { entropy: 0.3, digit_ratio: 0.5 });
			expect(score).toBeCloseTo(0.45, 5); // (0.2 + 0.7) / 2
		});

		it('returns 0 for invalid/empty model', () => {
			const emptyModel = { meta: { version: '', features: [], tree_count: 0 }, forest: [] };
			expect(predictForestScore(emptyModel, { entropy: 0.5 })).toBe(0);
		});

		it('returns 0 for null model', () => {
			expect(predictForestScore(null as any, { entropy: 0.5 })).toBe(0);
		});
	});

	describe('M4: NaN handling', () => {
		it('routes NaN feature values to left branch (not right)', () => {
			const score = predictForestScore(SINGLE_TREE_MODEL, { entropy: NaN, digit_ratio: 0.1 });
			// NaN should go LEFT → 0.1 (not right → 0.9)
			expect(score).toBe(0.1);
		});

		it('routes Infinity to the correct branch based on comparison', () => {
			const score = predictForestScore(SINGLE_TREE_MODEL, { entropy: Infinity, digit_ratio: 0.1 });
			// Infinity > 0.5 → right → 0.9
			expect(score).toBe(0.9);
		});

		it('routes -Infinity to the left branch', () => {
			const score = predictForestScore(SINGLE_TREE_MODEL, { entropy: -Infinity, digit_ratio: 0.1 });
			// -Infinity <= 0.5 → left → 0.1
			expect(score).toBe(0.1);
		});
	});

	describe('M5: missing feature handling', () => {
		it('routes missing features to left branch (not defaulting to 0)', () => {
			// If "entropy" is missing, it should go left (like scikit-learn missing-value convention)
			const score = predictForestScore(SINGLE_TREE_MODEL, { digit_ratio: 0.5 });
			expect(score).toBe(0.1); // left branch
		});

		it('distinguishes missing from zero-valued features', () => {
			// entropy=0 should go LEFT (0 <= 0.5), same as missing for this split
			// But for a tree splitting at threshold -0.1, zero would go RIGHT while missing goes LEFT
			const negThresholdModel: ForestModel = {
				meta: { version: 'test', features: ['x'], tree_count: 1 },
				forest: [{
					t: 'n', f: 'x', v: -0.1,
					l: { t: 'l', v: 0.0 }, // left: score 0
					r: { t: 'l', v: 1.0 }, // right: score 1
				}],
			};
			// x=0 → 0 > -0.1 → right → 1.0
			expect(predictForestScore(negThresholdModel, { x: 0 })).toBe(1.0);
			// x=missing → left → 0.0
			expect(predictForestScore(negThresholdModel, {})).toBe(0.0);
		});
	});

	describe('M1: Platt calibration', () => {
		it('applies Platt scaling when calibration metadata is present', () => {
			// Raw score = 0.5, sigmoid(10 * 0.5 + 0) = sigmoid(5) ≈ 0.9933
			const score = predictForestScore(CALIBRATED_MODEL, { entropy: 0.5 });
			const expected = 1 / (1 + Math.exp(-(10 * 0.5 + 0)));
			expect(score).toBeCloseTo(expected, 4);
		});

		it('does not apply calibration when metadata is absent', () => {
			const score = predictForestScore(SINGLE_TREE_MODEL, { entropy: 0.3, digit_ratio: 0 });
			// No calibration → raw score 0.1
			expect(score).toBe(0.1);
		});

		it('handles extreme calibration inputs without overflow', () => {
			const extremeModel: ForestModel = {
				meta: {
					version: 'extreme',
					features: ['x'],
					tree_count: 1,
					calibration: { method: 'platt', intercept: 0, coef: 10000, samples: 100 },
				},
				forest: [{ t: 'l', v: 1.0 }],
			};
			const score = predictForestScore(extremeModel, { x: 1 });
			expect(score).toBeCloseTo(1.0, 4);
			expect(Number.isFinite(score)).toBe(true);
		});
	});

	describe('predictForestScoreDetailed', () => {
		it('returns per-tree scores', () => {
			const result = predictForestScoreDetailed(TWO_TREE_MODEL, { entropy: 0.3, digit_ratio: 0.5 });
			expect(result.treeScores).toEqual([0.2, 0.7]);
			expect(result.score).toBeCloseTo(0.45, 5);
		});
	});

	describe('M6: checkFeatureAlignment', () => {
		it('returns aligned=true when features match exactly', () => {
			const result = checkFeatureAlignment(SINGLE_TREE_MODEL, { entropy: 0.5, digit_ratio: 0.3 });
			expect(result.aligned).toBe(true);
			expect(result.missingInVector).toEqual([]);
			expect(result.extraInVector).toEqual([]);
		});

		it('reports missing features without throwing when under 20% threshold', () => {
			// Use a model with enough features that 1 missing is <= 20%
			const model: ForestModel = {
				meta: { version: 'test', features: ['a', 'b', 'c', 'd', 'e'], tree_count: 1 },
				forest: [{ t: 'l', v: 0.5 }],
			};
			const result = checkFeatureAlignment(model, { a: 1, b: 2, c: 3, d: 4 });
			expect(result.aligned).toBe(false);
			expect(result.missingInVector).toEqual(['e']);
		});

		it('reports extra features', () => {
			const result = checkFeatureAlignment(SINGLE_TREE_MODEL, { entropy: 0.5, digit_ratio: 0.3, extra: 1 });
			expect(result.aligned).toBe(false);
			expect(result.extraInVector).toEqual(['extra']);
		});

		it('throws on critical mismatch (>20% features missing)', () => {
			const bigModel: ForestModel = {
				meta: {
					version: 'test',
					features: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'],
					tree_count: 1,
				},
				forest: [{ t: 'l', v: 0.5 }],
			};
			// Provide only 2 of 10 features → 80% missing → should throw
			expect(() => checkFeatureAlignment(bigModel, { a: 1, b: 2 })).toThrow('Critical feature alignment failure');
		});

		it('does not throw on minor mismatch (<= 20% missing)', () => {
			const model: ForestModel = {
				meta: {
					version: 'test',
					features: ['a', 'b', 'c', 'd', 'e'],
					tree_count: 1,
				},
				forest: [{ t: 'l', v: 0.5 }],
			};
			// 1 of 5 missing = 20% → should NOT throw
			const result = checkFeatureAlignment(model, { a: 1, b: 2, c: 3, d: 4 });
			expect(result.aligned).toBe(false);
			expect(result.missingRatio).toBeCloseTo(0.2);
		});
	});

	describe('validateForestModel', () => {
		it('accepts a valid model', () => {
			expect(validateForestModel(SINGLE_TREE_MODEL)).toBe(true);
		});

		it('rejects null', () => {
			expect(validateForestModel(null)).toBe(false);
		});

		it('rejects model with mismatched tree count', () => {
			const bad = {
				meta: { version: 'v1', features: ['x'], tree_count: 5 },
				forest: [{ t: 'l', v: 0.5 }],
			};
			expect(validateForestModel(bad)).toBe(false);
		});

		it('rejects model with NaN in feature_importance', () => {
			const bad = {
				meta: { version: 'v1', features: ['x'], tree_count: 1, feature_importance: { x: NaN } },
				forest: [{ t: 'l', v: 0.5 }],
			};
			expect(validateForestModel(bad)).toBe(false);
		});

		it('validates calibration metadata', () => {
			expect(validateForestModel(CALIBRATED_MODEL)).toBe(true);

			const badCalibration = {
				meta: {
					version: 'v1', features: ['x'], tree_count: 1,
					calibration: { intercept: 'bad', coef: 1 },
				},
				forest: [{ t: 'l', v: 0.5 }],
			};
			expect(validateForestModel(badCalibration)).toBe(false);
		});
	});

	describe('score range properties', () => {
		it('always returns a score in [0, 1]', () => {
			const features = { entropy: 0.5, digit_ratio: 0.5 };
			for (const model of [SINGLE_TREE_MODEL, TWO_TREE_MODEL, CALIBRATED_MODEL]) {
				const score = predictForestScore(model, features);
				expect(score).toBeGreaterThanOrEqual(0);
				expect(score).toBeLessThanOrEqual(1);
			}
		});
	});
});
