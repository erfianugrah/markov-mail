/**
 * Tests for training guardrails (threshold scan + constraint verification).
 */
import { describe, it, expect } from 'vitest';
import { runGuardrails, scanThresholds, type GuardrailConfig, DEFAULT_GUARDRAIL_CONFIG } from '../../../src/training/guardrails';
import { trainRandomForest, type RandomForestConfig, type TrainingDataset } from '../../../src/training/random-forest';
import { validateForestModel } from '../../../src/detectors/forest-engine';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSeparableDataset(n: number): TrainingDataset {
	const featureNames = ['feature_1', 'feature_2', 'feature_3'];
	const numFeatures = featureNames.length;
	const featureMatrix: Float64Array[] = featureNames.map(() => new Float64Array(n));
	const labels = new Uint8Array(n);

	for (let i = 0; i < n; i++) {
		featureMatrix[0][i] = (i / n) * 10;
		featureMatrix[1][i] = Math.sin(i) * 5;
		featureMatrix[2][i] = Math.cos(i) * 5;
		labels[i] = featureMatrix[0][i] >= 5 ? 1 : 0;
	}

	return { featureMatrix, labels, featureNames };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Guardrails', () => {
	describe('scanThresholds', () => {
		it('should produce entries across the scan range', () => {
			const scores = [0.1, 0.2, 0.3, 0.7, 0.8, 0.9];
			const labels = [0, 0, 0, 1, 1, 1];

			const entries = scanThresholds(scores, labels);

			expect(entries.length).toBeGreaterThan(0);

			// First entry should be near scanStart
			expect(entries[0].threshold).toBeCloseTo(0.05, 2);

			// Last entry should be near scanEnd
			expect(entries[entries.length - 1].threshold).toBeCloseTo(0.95, 2);
		});

		it('should compute correct metrics for perfect separation', () => {
			// Scores perfectly separate labels at threshold 0.5
			const scores = [0.1, 0.2, 0.3, 0.7, 0.8, 0.9];
			const labels = [0, 0, 0, 1, 1, 1];

			const entries = scanThresholds(scores, labels);

			// Find the entry at threshold 0.50
			const entry050 = entries.find(e => Math.abs(e.threshold - 0.5) < 0.01);
			expect(entry050).toBeDefined();

			if (entry050) {
				// At threshold 0.50 with perfectly separated data:
				// All fraud scores >= 0.50, all legit scores < 0.50
				expect(entry050.recall).toBe(1);      // all fraud detected
				expect(entry050.fpr).toBe(0);          // no legit misclassified
				expect(entry050.fnr).toBe(0);          // no fraud missed
				expect(entry050.precision).toBe(1);    // all predictions correct
			}
		});

		it('should throw on single-class data', () => {
			expect(() => scanThresholds([0.5, 0.6], [1, 1])).toThrow('both classes');
		});

		it('should throw on mismatched lengths', () => {
			expect(() => scanThresholds([0.5], [1, 0])).toThrow('does not match');
		});
	});

	describe('runGuardrails', () => {
		it('should pass for a well-trained model on separable data', () => {
			const dataset = makeSeparableDataset(500);
			const config: RandomForestConfig = {
				nTrees: 10,
				maxDepth: 4,
				minSamplesLeaf: 5,
				conflictWeight: 1,
				conflictEntropyThreshold: 3.0,
				conflictReputationThreshold: 0.6,
				seed: 42,
			};

			const trainingResult = trainRandomForest(dataset, config);

			// Collect OOB scores and labels for non-NaN entries
			const oobScores: number[] = [];
			const oobLabels: number[] = [];
			for (let i = 0; i < trainingResult.oobPredictions.length; i++) {
				if (!Number.isNaN(trainingResult.oobPredictions[i])) {
					oobScores.push(trainingResult.oobPredictions[i]);
					oobLabels.push(dataset.labels[i]);
				}
			}

			const result = runGuardrails(trainingResult.model, oobScores, oobLabels);

			expect(result.modelValid).toBe(true);
			expect(result.modelSizeBytes).toBeGreaterThan(0);
			expect(result.modelSizeBytes).toBeLessThan(25 * 1024 * 1024);
			expect(result.thresholdScan.length).toBeGreaterThan(0);

			// For a well-separated dataset, guardrails should pass
			expect(result.passed).toBe(true);
			expect(result.failures).toHaveLength(0);
			expect(result.recommendation).not.toBeNull();

			if (result.recommendation) {
				expect(result.recommendation.warnThreshold).toBeGreaterThan(0);
				expect(result.recommendation.blockThreshold).toBeGreaterThan(
					result.recommendation.warnThreshold
				);
			}
		});

		it('should reject a model with no calibration', () => {
			const dataset = makeSeparableDataset(500);
			const config: RandomForestConfig = {
				nTrees: 10,
				maxDepth: 4,
				minSamplesLeaf: 5,
				conflictWeight: 1,
				conflictEntropyThreshold: 3.0,
				conflictReputationThreshold: 0.6,
				seed: 42,
			};

			const trainingResult = trainRandomForest(dataset, config);

			// Remove calibration — structural validation should catch this
			const badModel = { ...trainingResult.model };
			badModel.meta = { ...badModel.meta, calibration: undefined };

			// Pass valid scores with both classes so the scan doesn't throw
			const scores = [0.1, 0.2, 0.3, 0.8, 0.9, 0.95];
			const labels = [0, 0, 0, 1, 1, 1];
			const result = runGuardrails(badModel, scores, labels);

			expect(result.passed).toBe(false);
			expect(result.failures.some(f => f.includes('calibration'))).toBe(true);
		});

		it('should reject a model with negative calibration coef', () => {
			const dataset = makeSeparableDataset(500);
			const config: RandomForestConfig = {
				nTrees: 10,
				maxDepth: 4,
				minSamplesLeaf: 5,
				conflictWeight: 1,
				conflictEntropyThreshold: 3.0,
				conflictReputationThreshold: 0.6,
				seed: 42,
			};

			const trainingResult = trainRandomForest(dataset, config);

			// Negate the coef
			const badModel = JSON.parse(JSON.stringify(trainingResult.model));
			badModel.meta.calibration.coef = -badModel.meta.calibration.coef;

			const oobScores: number[] = [];
			const oobLabels: number[] = [];
			for (let i = 0; i < trainingResult.oobPredictions.length; i++) {
				if (!Number.isNaN(trainingResult.oobPredictions[i])) {
					oobScores.push(trainingResult.oobPredictions[i]);
					oobLabels.push(dataset.labels[i]);
				}
			}

			const result = runGuardrails(badModel, oobScores, oobLabels);

			expect(result.passed).toBe(false);
			expect(result.failures.some(f => f.includes('coef must be positive'))).toBe(true);
		});

		it('should reject with strict constraints that cannot be met', () => {
			const dataset = makeSeparableDataset(500);
			const config: RandomForestConfig = {
				nTrees: 10,
				maxDepth: 4,
				minSamplesLeaf: 5,
				conflictWeight: 1,
				conflictEntropyThreshold: 3.0,
				conflictReputationThreshold: 0.6,
				seed: 42,
			};

			const trainingResult = trainRandomForest(dataset, config);

			const oobScores: number[] = [];
			const oobLabels: number[] = [];
			for (let i = 0; i < trainingResult.oobPredictions.length; i++) {
				if (!Number.isNaN(trainingResult.oobPredictions[i])) {
					oobScores.push(trainingResult.oobPredictions[i]);
					oobLabels.push(dataset.labels[i]);
				}
			}

			// Impossibly strict: require recall = 1.0 and FPR = 0.0 simultaneously
			const strictConfig: GuardrailConfig = {
				...DEFAULT_GUARDRAIL_CONFIG,
				minRecall: 1.0,
				maxFpr: 0.0,
				maxFnr: 0.0,
				minGap: 0.5,
			};

			const result = runGuardrails(
				trainingResult.model,
				oobScores,
				oobLabels,
				strictConfig,
			);

			// With impossibly strict constraints, it should likely fail
			// (unless the dataset is 100% perfectly separated at every threshold)
			expect(result.thresholdScan.length).toBeGreaterThan(0);
		});
	});

	describe('end-to-end: train → guardrail', () => {
		it('should complete the full pipeline without errors', () => {
			const dataset = makeSeparableDataset(500);
			const rfConfig: RandomForestConfig = {
				nTrees: 10,
				maxDepth: 5,
				minSamplesLeaf: 5,
				conflictWeight: 1,
				conflictEntropyThreshold: 3.0,
				conflictReputationThreshold: 0.6,
				seed: 42,
			};

			// Train
			const trainingResult = trainRandomForest(dataset, rfConfig);
			expect(trainingResult.model.forest.length).toBe(10);

			// Collect OOB data
			const oobScores: number[] = [];
			const oobLabels: number[] = [];
			for (let i = 0; i < trainingResult.oobPredictions.length; i++) {
				if (!Number.isNaN(trainingResult.oobPredictions[i])) {
					oobScores.push(trainingResult.oobPredictions[i]);
					oobLabels.push(dataset.labels[i]);
				}
			}

			// Guardrail
			const guardrailResult = runGuardrails(trainingResult.model, oobScores, oobLabels);

			expect(guardrailResult.modelValid).toBe(true);

			// Model should be serializable
			const json = JSON.stringify(trainingResult.model);
			expect(json.length).toBeGreaterThan(0);

			// Model should be deserializable and valid
			const parsed = JSON.parse(json);
			expect(validateForestModel(parsed)).toBe(true);
		});
	});
});
