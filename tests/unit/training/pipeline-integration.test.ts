/**
 * Integration test for the full training pipeline.
 *
 * Exercises the complete flow: dataset JSON → parse → train → Platt calibration
 * → guardrails → validated ForestModel. This is the in-process equivalent of
 * what the container would do, minus the HTTP calls.
 */
import { describe, it, expect } from 'vitest';
import {
	trainRandomForest,
	parseTrainingDataset,
	type RandomForestConfig,
	type TrainingDatasetJSON,
} from '../../../src/training/random-forest';
import {
	runGuardrails,
	scanThresholds,
	type GuardrailConfig,
	DEFAULT_GUARDRAIL_CONFIG,
} from '../../../src/training/guardrails';
import { applyPlattScaling } from '../../../src/training/platt-scaling';
import { validateForestModel, predictForestScore } from '../../../src/detectors/forest-engine';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDatasetJSON(
	n: number,
	boundary: number = 5,
	seed: number = 42,
): TrainingDatasetJSON {
	let s = seed;
	const rng = () => {
		s = (s + 0x6d2b79f5) | 0;
		let t = Math.imul(s ^ (s >>> 15), 1 | s);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};

	const features = [
		'bigram_entropy',
		'domain_reputation_score',
		'local_part_length',
		'has_digits',
		'consecutive_consonants',
	];

	const rows: TrainingDatasetJSON['rows'] = [];
	for (let i = 0; i < n; i++) {
		const primary = (i / n) * 10;
		const label = primary >= boundary ? 1 : 0;
		rows.push({
			features: [
				primary,
				rng() * 10,
				rng() * 30,
				rng() > 0.5 ? 1 : 0,
				Math.floor(rng() * 5),
			],
			label: label as 0 | 1,
		});
	}

	return {
		version: 'test-v1',
		created: new Date().toISOString(),
		samples: n,
		features,
		rows,
	};
}

// ---------------------------------------------------------------------------
// Pipeline integration tests
// ---------------------------------------------------------------------------

describe('Training Pipeline Integration', () => {
	it('should complete the full pipeline: parse → train → calibrate → guardrails → validate', () => {
		// 1. Create dataset JSON (the format stored in KV)
		const datasetJson = makeDatasetJSON(500);

		// 2. Parse into typed arrays
		const dataset = parseTrainingDataset(datasetJson);
		expect(dataset.featureMatrix.length).toBe(5);
		expect(dataset.labels.length).toBe(500);
		expect(dataset.featureNames).toEqual(datasetJson.features);

		// 3. Train Random Forest
		const config: RandomForestConfig = {
			nTrees: 5,
			maxDepth: 4,
			minSamplesLeaf: 10,
			conflictWeight: 20,
			conflictEntropyThreshold: 3.0,
			conflictReputationThreshold: 0.6,
			seed: 42,
			version: 'pipeline-test-v1',
		};

		const result = trainRandomForest(dataset, config);

		// 4. Validate model structure
		expect(validateForestModel(result.model)).toBe(true);
		expect(result.model.meta.version).toBe('pipeline-test-v1');
		expect(result.model.meta.tree_count).toBe(5);
		expect(result.model.meta.features).toHaveLength(5);
		expect(result.model.meta.calibration).toBeDefined();
		expect(result.model.meta.calibration!.method).toBe('platt');
		expect(result.model.meta.config).toEqual({
			n_trees: 5,
			max_depth: 4,
			min_samples_leaf: 10,
			conflict_weight: 20,
		});

		// 5. Compute calibrated OOB predictions for guardrails
		const calibration = result.model.meta.calibration!;
		const calibratedScores: number[] = [];
		const labels: number[] = [];

		for (let i = 0; i < result.oobPredictions.length; i++) {
			if (!Number.isNaN(result.oobPredictions[i])) {
				calibratedScores.push(
					applyPlattScaling(result.oobPredictions[i], calibration.coef, calibration.intercept)
				);
				labels.push(dataset.labels[i]);
			}
		}

		expect(calibratedScores.length).toBeGreaterThan(100);

		// 6. Run guardrails
		const guardrailResult = runGuardrails(
			result.model,
			calibratedScores,
			labels,
			DEFAULT_GUARDRAIL_CONFIG,
		);

		expect(guardrailResult.modelValid).toBe(true);
		expect(guardrailResult.modelSizeBytes).toBeGreaterThan(0);
		expect(guardrailResult.modelSizeBytes).toBeLessThan(25 * 1024 * 1024);
		expect(guardrailResult.thresholdScan.length).toBeGreaterThan(0);

		// With a clean linearly-separable dataset, guardrails should pass
		expect(guardrailResult.passed).toBe(true);
		expect(guardrailResult.recommendation).not.toBeNull();
		expect(guardrailResult.recommendation!.warnThreshold).toBeLessThan(
			guardrailResult.recommendation!.blockThreshold
		);
	});

	it('should produce a model that can be used for inference', () => {
		const datasetJson = makeDatasetJSON(400);
		const dataset = parseTrainingDataset(datasetJson);

		const result = trainRandomForest(dataset, {
			nTrees: 3,
			maxDepth: 4,
			minSamplesLeaf: 10,
			conflictWeight: 20,
			conflictEntropyThreshold: 3.0,
			conflictReputationThreshold: 0.6,
			seed: 123,
		});

		// Model should pass validation
		expect(validateForestModel(result.model)).toBe(true);

		// Create feature vectors for inference
		const fraudFeatures: Record<string, number> = {
			bigram_entropy: 8.5,      // High → fraud
			domain_reputation_score: 2.0,
			local_part_length: 15,
			has_digits: 1,
			consecutive_consonants: 3,
		};

		const legitFeatures: Record<string, number> = {
			bigram_entropy: 1.5,      // Low → legit
			domain_reputation_score: 8.0,
			local_part_length: 10,
			has_digits: 0,
			consecutive_consonants: 1,
		};

		// Test inference
		const fraudScore = predictForestScore(result.model, fraudFeatures);
		const legitScore = predictForestScore(result.model, legitFeatures);

		// Fraud should score higher than legit
		expect(fraudScore).toBeGreaterThan(legitScore);
		// Both should be in valid range
		expect(fraudScore).toBeGreaterThanOrEqual(0);
		expect(fraudScore).toBeLessThanOrEqual(1);
		expect(legitScore).toBeGreaterThanOrEqual(0);
		expect(legitScore).toBeLessThanOrEqual(1);
	});

	it('should produce deterministic results with the same seed', () => {
		const datasetJson = makeDatasetJSON(300);
		const dataset1 = parseTrainingDataset(datasetJson);
		const dataset2 = parseTrainingDataset(datasetJson);

		const config: RandomForestConfig = {
			nTrees: 3,
			maxDepth: 3,
			minSamplesLeaf: 10,
			conflictWeight: 20,
			conflictEntropyThreshold: 3.0,
			conflictReputationThreshold: 0.6,
			seed: 42,
		};

		const result1 = trainRandomForest(dataset1, config);
		const result2 = trainRandomForest(dataset2, config);

		// Models should be identical (deterministic PRNG)
		expect(JSON.stringify(result1.model.forest)).toBe(JSON.stringify(result2.model.forest));
		expect(result1.model.meta.calibration).toEqual(result2.model.meta.calibration);
	});

	it('should serialize to valid JSON under 25 MB', () => {
		const datasetJson = makeDatasetJSON(500);
		const dataset = parseTrainingDataset(datasetJson);

		const result = trainRandomForest(dataset, {
			nTrees: 10,
			maxDepth: 6,
			minSamplesLeaf: 20,
			conflictWeight: 20,
			conflictEntropyThreshold: 3.0,
			conflictReputationThreshold: 0.6,
			seed: 42,
		});

		const json = JSON.stringify(result.model);
		const sizeBytes = new TextEncoder().encode(json).byteLength;

		// Should be valid JSON
		expect(() => JSON.parse(json)).not.toThrow();

		// Should be under 25 MB
		expect(sizeBytes).toBeLessThan(25 * 1024 * 1024);

		// For a 5-feature, 10-tree, depth-6 model, should be quite small
		expect(sizeBytes).toBeLessThan(100 * 1024); // well under 100 KB

		// Parsed model should still validate
		const parsed = JSON.parse(json);
		expect(validateForestModel(parsed)).toBe(true);
	});

	it('should include feature importance that sums to ~1', () => {
		const datasetJson = makeDatasetJSON(500);
		const dataset = parseTrainingDataset(datasetJson);

		const result = trainRandomForest(dataset, {
			nTrees: 5,
			maxDepth: 4,
			minSamplesLeaf: 10,
			conflictWeight: 20,
			conflictEntropyThreshold: 3.0,
			conflictReputationThreshold: 0.6,
			seed: 42,
		});

		const importance = result.model.meta.feature_importance!;
		expect(importance).toBeDefined();

		const sum = Object.values(importance).reduce((a, b) => a + b, 0);
		expect(sum).toBeCloseTo(1.0, 1);

		// Primary feature (bigram_entropy) should be most important
		// since it's the one that drives the label boundary
		const primaryImportance = importance['bigram_entropy'] ?? 0;
		expect(primaryImportance).toBeGreaterThan(0.1);
	});

	it('should handle threshold scanning on calibrated OOB predictions', () => {
		const datasetJson = makeDatasetJSON(400);
		const dataset = parseTrainingDataset(datasetJson);

		const result = trainRandomForest(dataset, {
			nTrees: 5,
			maxDepth: 4,
			minSamplesLeaf: 10,
			conflictWeight: 20,
			conflictEntropyThreshold: 3.0,
			conflictReputationThreshold: 0.6,
			seed: 42,
		});

		const calibration = result.model.meta.calibration!;
		const calibratedScores: number[] = [];
		const oobLabels: number[] = [];

		for (let i = 0; i < result.oobPredictions.length; i++) {
			if (!Number.isNaN(result.oobPredictions[i])) {
				calibratedScores.push(
					applyPlattScaling(result.oobPredictions[i], calibration.coef, calibration.intercept)
				);
				oobLabels.push(dataset.labels[i]);
			}
		}

		const scan = scanThresholds(calibratedScores, oobLabels);

		// Should have entries spanning the scan range
		expect(scan.length).toBeGreaterThan(10);

		// At low thresholds, recall should be high (catch everything)
		const lowThreshold = scan.find(e => e.threshold <= 0.1);
		if (lowThreshold) {
			expect(lowThreshold.recall).toBeGreaterThanOrEqual(0.9);
		}

		// At high thresholds, FPR should be low (few false positives)
		const highThreshold = scan.find(e => e.threshold >= 0.9);
		if (highThreshold) {
			expect(highThreshold.fpr).toBeLessThanOrEqual(0.1);
		}
	});
});
