/**
 * Unit Tests for Model Validation
 */

import { describe, test, expect } from 'vitest';
import {
	validateModels,
	DEFAULT_VALIDATION_CONFIG,
	type TestDataset,
	type TrainedModels,
} from '../../src/training/model-validation';
import { NGramMarkovChain } from '../../src/detectors/ngram-markov';

describe('Model Validation', () => {
	// Helper to create mock trained models
	function createMockModels(): TrainedModels {
		const models: any = {};

		for (const order of [1, 2, 3]) {
			const legitModel = new NGramMarkovChain(order);
			const fraudModel = new NGramMarkovChain(order);

			// Train with sample data
			const legitSamples = ['john.doe', 'jane.smith', 'bob.wilson'];
			const fraudSamples = ['user001', 'user002', 'user003'];

			legitSamples.forEach((s) => legitModel.train(s, 0.3));
			fraudSamples.forEach((s) => fraudModel.train(s, 0.3));

			models[order] = { legit: legitModel, fraud: fraudModel };
		}

		return {
			version: '20251102_120000',
			createdAt: new Date().toISOString(),
			models,
			metadata: {
				trainingSamples: { legit: 3, fraud: 3, total: 6 },
				trainingDuration: 1000,
				datasetDates: ['2025-11-02'],
				orders: [1, 2, 3],
			},
		};
	}

	// Helper to create test dataset
	function createTestDataset(legitCount: number = 10, fraudCount: number = 10): TestDataset {
		const legit = Array.from({ length: legitCount }, (_, i) => ({
			localPart: `legit${i}`,
			label: 'legit' as const,
			source: 'test',
		}));

		const fraud = Array.from({ length: fraudCount }, (_, i) => ({
			localPart: `fraud${i}`,
			label: 'fraud' as const,
			source: 'test',
		}));

		return {
			legit,
			fraud,
			metadata: {
				created: new Date().toISOString(),
				source: 'test',
				totalSamples: legitCount + fraudCount,
			},
		};
	}

	describe('validateModels', () => {
		test('should validate models successfully with good metrics', () => {
			const trainedModels = createMockModels();
			const testDataset = createTestDataset(10, 10);

			const result = validateModels(trainedModels, testDataset, {
				...DEFAULT_VALIDATION_CONFIG,
				minAccuracy: 0.0, // Lower thresholds for mock data
				minPrecision: 0.0,
				minRecall: 0.0,
				maxFalsePositiveRate: 1.0,
				minF1Score: 0.0,
			});

			expect(result).toBeDefined();
			expect(result.metrics).toBeDefined();
			expect(result.metrics.accuracy).toBeGreaterThanOrEqual(0);
			expect(result.metrics.accuracy).toBeLessThanOrEqual(1);
			expect(result.metrics.testSampleCount).toBe(20);
		});

		test('should fail validation when accuracy below threshold', () => {
			const trainedModels = createMockModels();
			const testDataset = createTestDataset(10, 10);

			const result = validateModels(trainedModels, testDataset, {
				...DEFAULT_VALIDATION_CONFIG,
				minAccuracy: 0.99, // Unrealistically high threshold
			});

			expect(result.passed).toBe(false);
			expect(result.issues.length).toBeGreaterThan(0);
			expect(result.recommendation).not.toBe('deploy');
		});

		test('should calculate confusion matrix correctly', () => {
			const trainedModels = createMockModels();
			const testDataset = createTestDataset(10, 10);

			const result = validateModels(trainedModels, testDataset, {
				...DEFAULT_VALIDATION_CONFIG,
				minAccuracy: 0.0,
			});

			const cm = result.metrics.confusionMatrix;
			expect(cm.truePositives + cm.falseNegatives).toBe(10); // Total fraud samples
			expect(cm.trueNegatives + cm.falsePositives).toBe(10); // Total legit samples
			expect(cm.truePositives + cm.trueNegatives + cm.falsePositives + cm.falseNegatives).toBe(
				20
			);
		});

		test('should calculate precision and recall correctly', () => {
			const trainedModels = createMockModels();
			const testDataset = createTestDataset(10, 10);

			const result = validateModels(trainedModels, testDataset, {
				...DEFAULT_VALIDATION_CONFIG,
				minAccuracy: 0.0,
			});

			const { precision, recall, f1Score } = result.metrics;

			// Precision = TP / (TP + FP)
			expect(precision).toBeGreaterThanOrEqual(0);
			expect(precision).toBeLessThanOrEqual(1);

			// Recall = TP / (TP + FN)
			expect(recall).toBeGreaterThanOrEqual(0);
			expect(recall).toBeLessThanOrEqual(1);

			// F1 = 2 * (precision * recall) / (precision + recall)
			expect(f1Score).toBeGreaterThanOrEqual(0);
			expect(f1Score).toBeLessThanOrEqual(1);

			if (precision > 0 && recall > 0) {
				const expectedF1 = (2 * precision * recall) / (precision + recall);
				expect(Math.abs(f1Score - expectedF1)).toBeLessThan(0.01);
			}
		});

		test('should set recommendation based on validation results', () => {
			const trainedModels = createMockModels();
			const testDataset = createTestDataset(10, 10);

			// Should pass with low thresholds
			const passResult = validateModels(trainedModels, testDataset, {
				...DEFAULT_VALIDATION_CONFIG,
				minAccuracy: 0.0,
				minPrecision: 0.0,
				minRecall: 0.0,
				maxFalsePositiveRate: 1.0,
				minF1Score: 0.0,
			});

			expect(passResult.passed).toBe(true);
			expect(passResult.recommendation).toBe('deploy');

			// Should reject with very high thresholds
			const rejectResult = validateModels(trainedModels, testDataset, {
				...DEFAULT_VALIDATION_CONFIG,
				minAccuracy: 0.99,
				minPrecision: 0.99,
				minRecall: 0.99,
			});

			expect(rejectResult.passed).toBe(false);
			expect(rejectResult.recommendation).toBe('reject');
		});

		test('should handle empty test dataset gracefully', () => {
			const trainedModels = createMockModels();
			const testDataset = createTestDataset(0, 0);

			const result = validateModels(trainedModels, testDataset, DEFAULT_VALIDATION_CONFIG);

			expect(result).toBeDefined();
			expect(result.metrics.testSampleCount).toBe(0);
		});

		test('should handle imbalanced test datasets', () => {
			const trainedModels = createMockModels();
			const testDataset = createTestDataset(100, 10); // 10:1 ratio

			const result = validateModels(trainedModels, testDataset, {
				...DEFAULT_VALIDATION_CONFIG,
				minAccuracy: 0.0,
			});

			expect(result.metrics.testSampleCount).toBe(110);
			expect(result.metrics.confusionMatrix.trueNegatives + result.metrics.confusionMatrix.falsePositives).toBe(100);
			expect(result.metrics.confusionMatrix.truePositives + result.metrics.confusionMatrix.falseNegatives).toBe(10);
		});
	});

	describe('DEFAULT_VALIDATION_CONFIG', () => {
		test('should have sensible default thresholds', () => {
			expect(DEFAULT_VALIDATION_CONFIG.minAccuracy).toBeGreaterThanOrEqual(0.9);
			expect(DEFAULT_VALIDATION_CONFIG.minPrecision).toBeGreaterThanOrEqual(0.85);
			expect(DEFAULT_VALIDATION_CONFIG.minRecall).toBeGreaterThanOrEqual(0.8);
			expect(DEFAULT_VALIDATION_CONFIG.maxFalsePositiveRate).toBeLessThanOrEqual(0.1);
			expect(DEFAULT_VALIDATION_CONFIG.minF1Score).toBeGreaterThanOrEqual(0.85);
		});

		test('should require improvement by default', () => {
			expect(DEFAULT_VALIDATION_CONFIG.requireImprovement).toBe(true);
			expect(DEFAULT_VALIDATION_CONFIG.minImprovementThreshold).toBeGreaterThan(0);
		});
	});
});
