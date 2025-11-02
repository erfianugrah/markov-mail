/**
 * Model Validation Gates
 *
 * Validates trained models against quality thresholds before deployment
 */

import { NGramMarkovChain } from '../detectors/ngram-markov';
import type { TrainedModels } from './model-training';
import { logger } from '../logger';

export interface ValidationMetrics {
	accuracy: number; // Overall accuracy (0-1)
	precision: number; // Fraud precision: TP / (TP + FP)
	recall: number; // Fraud recall: TP / (TP + FN)
	f1Score: number; // Harmonic mean of precision and recall
	falsePositiveRate: number; // FP / (FP + TN)
	trueNegativeRate: number; // TN / (TN + FP) - Specificity
	auROC?: number; // Area under ROC curve (optional)
	testSampleCount: number; // Number of test samples
	confusionMatrix: {
		truePositives: number; // Fraud correctly identified as fraud
		trueNegatives: number; // Legit correctly identified as legit
		falsePositives: number; // Legit incorrectly identified as fraud
		falseNegatives: number; // Fraud incorrectly identified as legit
	};
}

export interface ValidationResult {
	passed: boolean;
	metrics: ValidationMetrics;
	issues: string[];
	recommendation: 'deploy' | 'reject' | 'manual_review';
	comparisonWithProduction?: {
		accuracyDelta: number; // New - Old
		precisionDelta: number;
		recallDelta: number;
		f1Delta: number;
		improved: boolean;
	};
}

export interface ValidationConfig {
	minAccuracy: number; // Minimum accuracy threshold (default: 0.95)
	minPrecision: number; // Minimum precision threshold (default: 0.90)
	minRecall: number; // Minimum recall threshold (default: 0.85)
	maxFalsePositiveRate: number; // Maximum FPR (default: 0.05)
	minF1Score: number; // Minimum F1 score (default: 0.87)
	requireImprovement: boolean; // Must be better than production (default: true)
	minImprovementThreshold: number; // Minimum improvement required (default: 0.01)
}

export interface TestSample {
	localPart: string;
	label: 'legit' | 'fraud';
	source: string;
}

export interface TestDataset {
	legit: TestSample[];
	fraud: TestSample[];
	metadata: {
		created: string;
		source: string;
		totalSamples: number;
	};
}

/**
 * Default validation configuration
 */
export const DEFAULT_VALIDATION_CONFIG: ValidationConfig = {
	minAccuracy: 0.95,
	minPrecision: 0.90,
	minRecall: 0.85,
	maxFalsePositiveRate: 0.05,
	minF1Score: 0.87,
	requireImprovement: true,
	minImprovementThreshold: 0.01,
};

/**
 * Validate trained models against test dataset
 */
export function validateModels(
	trainedModels: TrainedModels,
	testDataset: TestDataset,
	config: ValidationConfig = DEFAULT_VALIDATION_CONFIG
): ValidationResult {
	logger.info({
		event: 'validation_started',
		test_sample_count: testDataset.metadata.totalSamples,
	}, 'Validating models');

	const issues: string[] = [];

	// Calculate metrics for each order and use ensemble/best
	const metrics = calculateEnsembleMetrics(trainedModels, testDataset);

	logger.info({
		event: 'validation_metrics_calculated',
		accuracy: metrics.accuracy,
		precision: metrics.precision,
		recall: metrics.recall,
		f1_score: metrics.f1Score,
		false_positive_rate: metrics.falsePositiveRate,
	}, 'Validation metrics calculated');

	// Check accuracy
	if (metrics.accuracy < config.minAccuracy) {
		issues.push(
			`Accuracy ${(metrics.accuracy * 100).toFixed(2)}% below threshold ${(config.minAccuracy * 100).toFixed(2)}%`
		);
	}

	// Check precision
	if (metrics.precision < config.minPrecision) {
		issues.push(
			`Precision ${(metrics.precision * 100).toFixed(2)}% below threshold ${(config.minPrecision * 100).toFixed(2)}%`
		);
	}

	// Check recall
	if (metrics.recall < config.minRecall) {
		issues.push(
			`Recall ${(metrics.recall * 100).toFixed(2)}% below threshold ${(config.minRecall * 100).toFixed(2)}%`
		);
	}

	// Check false positive rate
	if (metrics.falsePositiveRate > config.maxFalsePositiveRate) {
		issues.push(
			`False positive rate ${(metrics.falsePositiveRate * 100).toFixed(2)}% above threshold ${(config.maxFalsePositiveRate * 100).toFixed(2)}%`
		);
	}

	// Check F1 score
	if (metrics.f1Score < config.minF1Score) {
		issues.push(
			`F1 score ${(metrics.f1Score * 100).toFixed(2)}% below threshold ${(config.minF1Score * 100).toFixed(2)}%`
		);
	}

	// Determine recommendation
	let recommendation: 'deploy' | 'reject' | 'manual_review';
	let passed = issues.length === 0;

	if (passed) {
		recommendation = 'deploy';
	} else if (issues.length >= 3 || metrics.accuracy < 0.85) {
		recommendation = 'reject';
	} else {
		recommendation = 'manual_review';
	}

	return {
		passed,
		metrics,
		issues,
		recommendation,
	};
}

/**
 * Compare new models with production models
 */
export async function compareWithProduction(
	newModels: TrainedModels,
	productionModels: TrainedModels | null,
	testDataset: TestDataset,
	config: ValidationConfig = DEFAULT_VALIDATION_CONFIG
): Promise<ValidationResult> {
	const newMetrics = calculateEnsembleMetrics(newModels, testDataset);

	if (!productionModels) {
		logger.info({
			event: 'production_models_missing',
		}, 'No production models to compare against');
		return validateModels(newModels, testDataset, config);
	}

	logger.info({
		event: 'production_comparison_started',
	}, 'Comparing with production models');
	const productionMetrics = calculateEnsembleMetrics(productionModels, testDataset);

	const accuracyDelta = newMetrics.accuracy - productionMetrics.accuracy;
	const precisionDelta = newMetrics.precision - productionMetrics.precision;
	const recallDelta = newMetrics.recall - productionMetrics.recall;
	const f1Delta = newMetrics.f1Score - productionMetrics.f1Score;

	logger.info({
		event: 'production_comparison_complete',
		production_accuracy: productionMetrics.accuracy,
		new_accuracy: newMetrics.accuracy,
		accuracy_delta: accuracyDelta,
		production_precision: productionMetrics.precision,
		new_precision: newMetrics.precision,
		precision_delta: precisionDelta,
		production_recall: productionMetrics.recall,
		new_recall: newMetrics.recall,
		recall_delta: recallDelta,
		production_f1: productionMetrics.f1Score,
		new_f1: newMetrics.f1Score,
		f1_delta: f1Delta,
	}, 'Production comparison results');

	const improved = f1Delta > 0;

	const issues: string[] = [];

	// Check if improvement is required
	if (config.requireImprovement && !improved) {
		issues.push('No improvement over production models');
	}

	// Check minimum improvement threshold
	if (config.requireImprovement && improved && f1Delta < config.minImprovementThreshold) {
		issues.push(
			`Improvement ${(f1Delta * 100).toFixed(2)}% below minimum threshold ${(config.minImprovementThreshold * 100).toFixed(2)}%`
		);
	}

	// Check for regression
	if (accuracyDelta < -0.02) {
		issues.push(`Accuracy regression: ${(accuracyDelta * 100).toFixed(2)}%`);
	}

	if (precisionDelta < -0.02) {
		issues.push(`Precision regression: ${(precisionDelta * 100).toFixed(2)}%`);
	}

	if (recallDelta < -0.02) {
		issues.push(`Recall regression: ${(recallDelta * 100).toFixed(2)}%`);
	}

	// Run standard validation checks
	const standardValidation = validateModels(newModels, testDataset, config);
	issues.push(...standardValidation.issues);

	const passed = issues.length === 0;
	let recommendation: 'deploy' | 'reject' | 'manual_review';

	if (passed && improved) {
		recommendation = 'deploy';
	} else if (issues.length >= 3 || accuracyDelta < -0.05) {
		recommendation = 'reject';
	} else {
		recommendation = 'manual_review';
	}

	return {
		passed,
		metrics: newMetrics,
		issues,
		recommendation,
		comparisonWithProduction: {
			accuracyDelta,
			precisionDelta,
			recallDelta,
			f1Delta,
			improved,
		},
	};
}

/**
 * Calculate ensemble metrics using weighted voting
 */
function calculateEnsembleMetrics(
	trainedModels: TrainedModels,
	testDataset: TestDataset
): ValidationMetrics {
	// Use weighted ensemble (same weights as MarkovEnsembleDetector)
	const weights = {
		unigram: 0.2,
		bigram: 0.5,
		trigram: 0.3,
	};

	let truePositives = 0;
	let trueNegatives = 0;
	let falsePositives = 0;
	let falseNegatives = 0;

	// Test fraud samples
	for (const sample of testDataset.fraud) {
		const prediction = predictWithEnsemble(sample.localPart, trainedModels, weights);
		if (prediction === 'fraud') {
			truePositives++;
		} else {
			falseNegatives++;
		}
	}

	// Test legit samples
	for (const sample of testDataset.legit) {
		const prediction = predictWithEnsemble(sample.localPart, trainedModels, weights);
		if (prediction === 'legit') {
			trueNegatives++;
		} else {
			falsePositives++;
		}
	}

	// Calculate metrics
	const total = truePositives + trueNegatives + falsePositives + falseNegatives;
	const accuracy = (truePositives + trueNegatives) / total;
	const precision = truePositives / Math.max(1, truePositives + falsePositives);
	const recall = truePositives / Math.max(1, truePositives + falseNegatives);
	const f1Score = (2 * precision * recall) / Math.max(0.001, precision + recall);
	const falsePositiveRate = falsePositives / Math.max(1, falsePositives + trueNegatives);
	const trueNegativeRate = trueNegatives / Math.max(1, trueNegatives + falsePositives);

	return {
		accuracy,
		precision,
		recall,
		f1Score,
		falsePositiveRate,
		trueNegativeRate,
		testSampleCount: total,
		confusionMatrix: {
			truePositives,
			trueNegatives,
			falsePositives,
			falseNegatives,
		},
	};
}

/**
 * Predict using ensemble of models
 */
function predictWithEnsemble(
	localPart: string,
	trainedModels: TrainedModels,
	weights: { unigram: number; bigram: number; trigram: number }
): 'legit' | 'fraud' {
	const { models } = trainedModels;

	// Get predictions from each order
	const predictions: Array<{ order: number; prediction: 'legit' | 'fraud'; weight: number }> = [];

	for (const [orderStr, orderModels] of Object.entries(models)) {
		const order = parseInt(orderStr);
		const legitCrossEntropy = orderModels.legit.calculateCrossEntropy(localPart);
		const fraudCrossEntropy = orderModels.fraud.calculateCrossEntropy(localPart);

		const prediction = fraudCrossEntropy < legitCrossEntropy ? 'fraud' : 'legit';

		let weight = 0;
		if (order === 1) weight = weights.unigram;
		else if (order === 2) weight = weights.bigram;
		else if (order === 3) weight = weights.trigram;

		predictions.push({ order, prediction, weight });
	}

	// Weighted voting
	let fraudScore = 0;
	let legitScore = 0;

	for (const pred of predictions) {
		if (pred.prediction === 'fraud') {
			fraudScore += pred.weight;
		} else {
			legitScore += pred.weight;
		}
	}

	return fraudScore > legitScore ? 'fraud' : 'legit';
}

/**
 * Generate test dataset from production data
 * Uses holdout set not seen during training
 */
export async function generateTestDataset(
	kv: KVNamespace,
	days: number = 7,
	testSplitRatio: number = 0.2
): Promise<TestDataset> {
	logger.info({
		event: 'test_dataset_generation_started',
		days,
		test_split_ratio: testSplitRatio,
	}, 'Generating test dataset');

	// Load training datasets
	const allLegit: string[] = [];
	const allFraud: string[] = [];

	for (let i = 0; i < days; i++) {
		const date = new Date();
		date.setDate(date.getDate() - i);
		const dateStr = date.toISOString().split('T')[0];
		const key = `training_data_${dateStr}`;

		try {
			const data = await kv.get<any>(key, 'json');
			if (data && data.samples) {
				const legitLocalParts = data.samples.legit.map((s: any) => s.localPart);
				const fraudLocalParts = data.samples.fraud.map((s: any) => s.localPart);

				allLegit.push(...legitLocalParts);
				allFraud.push(...fraudLocalParts);
			}
		} catch (error) {
			logger.warn({
				event: 'test_dataset_load_failed',
				key,
				error: error instanceof Error ? {
					message: error.message,
					stack: error.stack,
					name: error.name,
				} : String(error),
			}, 'Failed to load dataset');
		}
	}

	// Shuffle and split
	shuffle(allLegit);
	shuffle(allFraud);

	const legitTestCount = Math.floor(allLegit.length * testSplitRatio);
	const fraudTestCount = Math.floor(allFraud.length * testSplitRatio);

	const legitTest = allLegit.slice(0, legitTestCount);
	const fraudTest = allFraud.slice(0, fraudTestCount);

	const testDataset: TestDataset = {
		legit: legitTest.map((lp) => ({
			localPart: lp,
			label: 'legit' as const,
			source: 'production',
		})),
		fraud: fraudTest.map((lp) => ({
			localPart: lp,
			label: 'fraud' as const,
			source: 'production',
		})),
		metadata: {
			created: new Date().toISOString(),
			source: 'production_holdout',
			totalSamples: legitTestCount + fraudTestCount,
		},
	};

	logger.info({
		event: 'test_dataset_generated',
		legit_count: legitTestCount,
		fraud_count: fraudTestCount,
		total_count: legitTestCount + fraudTestCount,
	}, 'Test dataset generated');

	return testDataset;
}

/**
 * Fisher-Yates shuffle
 */
function shuffle<T>(array: T[]): void {
	for (let i = array.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[array[i], array[j]] = [array[j], array[i]];
	}
}
