/**
 * Tests for the hand-rolled Random Forest trainer.
 */
import { describe, it, expect } from 'vitest';
import {
	trainRandomForest,
	parseTrainingDataset,
	type RandomForestConfig,
	type TrainingDataset,
	type TrainingDatasetJSON,
} from '../../../src/training/random-forest';
import { validateForestModel, predictForestScore } from '../../../src/detectors/forest-engine';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a synthetic linearly-separable dataset.
 * feature_1 drives the label: < boundary → legit, >= boundary → fraud.
 * feature_2 is noise. feature_3 is correlated noise.
 */
function makeDataset(
	n: number,
	boundary: number = 5,
	numFeatures: number = 3,
	seed: number = 42,
): TrainingDataset {
	// Simple deterministic PRNG
	let s = seed;
	const rng = () => {
		s = (s + 0x6d2b79f5) | 0;
		let t = Math.imul(s ^ (s >>> 15), 1 | s);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};

	const featureNames = Array.from({ length: numFeatures }, (_, i) => `feature_${i + 1}`);
	const featureMatrix: Float64Array[] = featureNames.map(() => new Float64Array(n));
	const labels = new Uint8Array(n);

	for (let i = 0; i < n; i++) {
		// Primary feature: deterministic gradient
		featureMatrix[0][i] = (i / n) * 10;
		// Noise features
		for (let f = 1; f < numFeatures; f++) {
			featureMatrix[f][i] = rng() * 10;
		}
		labels[i] = featureMatrix[0][i] >= boundary ? 1 : 0;
	}

	return { featureMatrix, labels, featureNames };
}

/**
 * Generate a dataset with conflict zone (for testing weighted bootstrap).
 */
function makeConflictDataset(n: number): TrainingDataset {
	const featureNames = ['bigram_entropy', 'domain_reputation_score', 'digit_ratio'];
	const featureMatrix: Float64Array[] = featureNames.map(() => new Float64Array(n));
	const labels = new Uint8Array(n);

	for (let i = 0; i < n; i++) {
		const isFraud = i >= n / 2;
		featureMatrix[0][i] = isFraud ? 3.5 + (i / n) : 2.0 + (i / n); // bigram_entropy
		featureMatrix[1][i] = isFraud ? 0.7 : 0.3; // domain_reputation_score
		featureMatrix[2][i] = isFraud ? 0.4 + (i / n) * 0.1 : 0.1; // digit_ratio
		labels[i] = isFraud ? 1 : 0;
	}

	return { featureMatrix, labels, featureNames };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Random Forest Trainer', () => {
	describe('basic training', () => {
		it('should train a forest on a separable dataset', () => {
			const dataset = makeDataset(200, 5, 3);
			const config: RandomForestConfig = {
				nTrees: 5,
				maxDepth: 4,
				minSamplesLeaf: 5,
				conflictWeight: 1,
				conflictEntropyThreshold: 3.0,
				conflictReputationThreshold: 0.6,
				seed: 42,
			};

			const result = trainRandomForest(dataset, config);

			expect(result.model.forest.length).toBe(5);
			expect(result.model.meta.tree_count).toBe(5);
			expect(result.model.meta.features).toHaveLength(3);
			expect(result.stats.totalSamples).toBe(200);
			expect(result.durationMs).toBeGreaterThanOrEqual(0);
		});

		it('should produce a valid ForestModel', () => {
			const dataset = makeDataset(300, 5, 5);
			const config: RandomForestConfig = {
				nTrees: 3,
				maxDepth: 4,
				minSamplesLeaf: 10,
				conflictWeight: 1,
				conflictEntropyThreshold: 3.0,
				conflictReputationThreshold: 0.6,
				seed: 42,
			};

			const result = trainRandomForest(dataset, config);

			// Must pass the existing model validator
			expect(validateForestModel(result.model)).toBe(true);
		});

		it('should produce a model usable by the existing inference engine', () => {
			const dataset = makeDataset(300, 5, 3);
			const config: RandomForestConfig = {
				nTrees: 5,
				maxDepth: 4,
				minSamplesLeaf: 5,
				conflictWeight: 1,
				conflictEntropyThreshold: 3.0,
				conflictReputationThreshold: 0.6,
				seed: 42,
			};

			const result = trainRandomForest(dataset, config);

			// Run through the EXISTING inference engine (forest-engine.ts)
			const lowRiskFeatures: Record<string, number> = {
				feature_1: 1,  // clearly below boundary
				feature_2: 5,
				feature_3: 5,
			};
			const highRiskFeatures: Record<string, number> = {
				feature_1: 9,  // clearly above boundary
				feature_2: 5,
				feature_3: 5,
			};

			const lowScore = predictForestScore(result.model, lowRiskFeatures);
			const highScore = predictForestScore(result.model, highRiskFeatures);

			// Low-risk sample should score lower than high-risk
			expect(lowScore).toBeLessThan(highScore);
			// Both should be in [0, 1]
			expect(lowScore).toBeGreaterThanOrEqual(0);
			expect(lowScore).toBeLessThanOrEqual(1);
			expect(highScore).toBeGreaterThanOrEqual(0);
			expect(highScore).toBeLessThanOrEqual(1);
		});
	});

	describe('OOB predictions', () => {
		it('should produce OOB predictions for most samples', () => {
			const dataset = makeDataset(500, 5, 3);
			const config: RandomForestConfig = {
				nTrees: 10,
				maxDepth: 4,
				minSamplesLeaf: 5,
				conflictWeight: 1,
				conflictEntropyThreshold: 3.0,
				conflictReputationThreshold: 0.6,
				seed: 42,
			};

			const result = trainRandomForest(dataset, config);

			// With 10 trees, probability of a sample being in ALL bootstraps is ~(1-1/e)^10 ≈ 0.00005
			// So virtually all samples should have OOB predictions
			expect(result.stats.oobSamplesUsed).toBeGreaterThan(400);

			// OOB predictions should be in [0, 1] for non-NaN entries
			for (let i = 0; i < result.oobPredictions.length; i++) {
				if (!Number.isNaN(result.oobPredictions[i])) {
					expect(result.oobPredictions[i]).toBeGreaterThanOrEqual(0);
					expect(result.oobPredictions[i]).toBeLessThanOrEqual(1);
				}
			}
		});

		it('should track per-tree OOB accuracy', () => {
			const dataset = makeDataset(300, 5, 3);
			const config: RandomForestConfig = {
				nTrees: 5,
				maxDepth: 4,
				minSamplesLeaf: 5,
				conflictWeight: 1,
				conflictEntropyThreshold: 3.0,
				conflictReputationThreshold: 0.6,
				seed: 42,
			};

			const result = trainRandomForest(dataset, config);

			expect(result.treeOobAccuracies).toHaveLength(5);
			for (const acc of result.treeOobAccuracies) {
				expect(acc).toBeGreaterThanOrEqual(0);
				expect(acc).toBeLessThanOrEqual(1);
			}

			// On a linearly-separable dataset, OOB accuracy should be high
			expect(result.stats.meanOobAccuracy).toBeGreaterThan(0.7);
		});
	});

	describe('calibration', () => {
		it('should include Platt calibration coefficients in the model', () => {
			const dataset = makeDataset(500, 5, 3);
			const config: RandomForestConfig = {
				nTrees: 10,
				maxDepth: 4,
				minSamplesLeaf: 5,
				conflictWeight: 1,
				conflictEntropyThreshold: 3.0,
				conflictReputationThreshold: 0.6,
				seed: 42,
			};

			const result = trainRandomForest(dataset, config);

			expect(result.model.meta.calibration).toBeDefined();
			expect(result.model.meta.calibration!.method).toBe('platt');
			expect(typeof result.model.meta.calibration!.coef).toBe('number');
			expect(typeof result.model.meta.calibration!.intercept).toBe('number');
			expect(result.model.meta.calibration!.samples).toBeGreaterThan(0);

			// For a well-separated dataset, coef should be positive
			expect(result.model.meta.calibration!.coef).toBeGreaterThan(0);
		});
	});

	describe('conflict-zone weighting', () => {
		it('should detect conflict zone samples', () => {
			const dataset = makeConflictDataset(200);
			const config: RandomForestConfig = {
				nTrees: 5,
				maxDepth: 4,
				minSamplesLeaf: 5,
				conflictWeight: 20,
				conflictEntropyThreshold: 3.0,
				conflictReputationThreshold: 0.6,
				seed: 42,
			};

			const result = trainRandomForest(dataset, config);

			expect(result.stats.conflictZoneSamples).toBeGreaterThan(0);
		});
	});

	describe('feature importance', () => {
		it('should assign highest importance to the discriminative feature', () => {
			const dataset = makeDataset(500, 5, 5);
			const config: RandomForestConfig = {
				nTrees: 10,
				maxDepth: 4,
				minSamplesLeaf: 5,
				conflictWeight: 1,
				conflictEntropyThreshold: 3.0,
				conflictReputationThreshold: 0.6,
				seed: 42,
			};

			const result = trainRandomForest(dataset, config);

			const importance = result.model.meta.feature_importance!;
			expect(importance).toBeDefined();

			// feature_1 is the discriminative feature — it should have highest importance
			const f1Importance = importance['feature_1'] ?? 0;
			for (const [name, value] of Object.entries(importance)) {
				if (name !== 'feature_1') {
					expect(f1Importance).toBeGreaterThanOrEqual(value);
				}
			}
		});

		it('should have importances that sum to approximately 1', () => {
			const dataset = makeDataset(300, 5, 3);
			const config: RandomForestConfig = {
				nTrees: 5,
				maxDepth: 4,
				minSamplesLeaf: 5,
				conflictWeight: 1,
				conflictEntropyThreshold: 3.0,
				conflictReputationThreshold: 0.6,
				seed: 42,
			};

			const result = trainRandomForest(dataset, config);

			const total = Object.values(result.model.meta.feature_importance!)
				.reduce((a, b) => a + b, 0);
			expect(total).toBeCloseTo(1, 1);
		});
	});

	describe('determinism', () => {
		it('should produce identical models with the same seed', () => {
			const dataset = makeDataset(200, 5, 3);
			const config: RandomForestConfig = {
				nTrees: 3,
				maxDepth: 4,
				minSamplesLeaf: 5,
				conflictWeight: 1,
				conflictEntropyThreshold: 3.0,
				conflictReputationThreshold: 0.6,
				seed: 42,
			};

			const result1 = trainRandomForest(dataset, config);
			const result2 = trainRandomForest(dataset, config);

			expect(JSON.stringify(result1.model)).toBe(JSON.stringify(result2.model));
		});
	});

	describe('model config metadata', () => {
		it('should store training config in model metadata', () => {
			const dataset = makeDataset(200, 5, 3);
			const config: RandomForestConfig = {
				nTrees: 7,
				maxDepth: 5,
				minSamplesLeaf: 15,
				conflictWeight: 10,
				conflictEntropyThreshold: 3.0,
				conflictReputationThreshold: 0.6,
				seed: 42,
			};

			const result = trainRandomForest(dataset, config);

			expect(result.model.meta.config).toBeDefined();
			expect(result.model.meta.config!.n_trees).toBe(7);
			expect(result.model.meta.config!.max_depth).toBe(5);
			expect(result.model.meta.config!.min_samples_leaf).toBe(15);
			expect(result.model.meta.config!.conflict_weight).toBe(10);
		});

		it('should store sorted feature names', () => {
			const dataset = makeDataset(200, 5, 3);
			const config: RandomForestConfig = {
				nTrees: 3,
				maxDepth: 4,
				minSamplesLeaf: 5,
				conflictWeight: 1,
				conflictEntropyThreshold: 3.0,
				conflictReputationThreshold: 0.6,
				seed: 42,
			};

			const result = trainRandomForest(dataset, config);

			const features = result.model.meta.features;
			const sorted = [...features].sort();
			expect(features).toEqual(sorted);
		});
	});

	describe('parseTrainingDataset', () => {
		it('should parse valid JSON dataset', () => {
			const json: TrainingDatasetJSON = {
				version: '1.0',
				created: '2026-03-13T00:00:00Z',
				samples: 4,
				features: ['f1', 'f2'],
				rows: [
					{ features: [1, 2], label: 0 },
					{ features: [3, 4], label: 0 },
					{ features: [5, 6], label: 1 },
					{ features: [7, 8], label: 1 },
				],
			};

			const dataset = parseTrainingDataset(json);

			expect(dataset.featureNames).toEqual(['f1', 'f2']);
			expect(dataset.labels).toEqual(new Uint8Array([0, 0, 1, 1]));
			expect(dataset.featureMatrix[0][0]).toBe(1); // f1[0]
			expect(dataset.featureMatrix[1][2]).toBe(6); // f2[2]
		});

		it('should throw on empty rows', () => {
			expect(() => parseTrainingDataset({
				version: '1.0',
				created: '',
				samples: 0,
				features: ['f1'],
				rows: [],
			})).toThrow('no rows');
		});

		it('should throw on feature dimension mismatch', () => {
			expect(() => parseTrainingDataset({
				version: '1.0',
				created: '',
				samples: 1,
				features: ['f1', 'f2'],
				rows: [{ features: [1], label: 0 }], // only 1 feature, header says 2
			})).toThrow('mismatch');
		});
	});

	describe('error handling', () => {
		it('should throw on empty dataset', () => {
			const dataset: TrainingDataset = {
				featureMatrix: [],
				labels: new Uint8Array(0),
				featureNames: [],
			};

			expect(() => trainRandomForest(dataset)).toThrow('empty dataset');
		});
	});

	describe('progress callback', () => {
		it('should call onProgress for each tree', () => {
			const dataset = makeDataset(200, 5, 3);
			const config: RandomForestConfig = {
				nTrees: 5,
				maxDepth: 3,
				minSamplesLeaf: 5,
				conflictWeight: 1,
				conflictEntropyThreshold: 3.0,
				conflictReputationThreshold: 0.6,
				seed: 42,
			};

			const calls: [number, number][] = [];
			trainRandomForest(dataset, config, (i, total) => {
				calls.push([i, total]);
			});

			expect(calls).toHaveLength(5);
			expect(calls[0]).toEqual([1, 5]);
			expect(calls[4]).toEqual([5, 5]);
		});
	});
});
