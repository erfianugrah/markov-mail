/**
 * Model Evaluation Command
 *
 * Evaluates trained Markov models on a labeled test dataset.
 * Calculates precision, recall, F1, perplexity, and confusion matrix.
 */

import { readFile } from 'fs/promises';
import { parse } from 'csv-parse/sync';
import { NGramMarkovChain } from '../../../src/detectors/ngram-markov.ts';
import { logger } from '../../utils/logger.ts';
import { parseArgs, getOption, hasFlag } from '../../utils/args.ts';

interface EvalOptions {
	dataset: string;
	legitModel: string;
	fraudModel: string;
	threshold: number; // Cross-entropy difference threshold for classification
	verbose: boolean;
}

interface EvalMetrics {
	accuracy: number;
	precision: number;
	recall: number;
	f1: number;
	perplexityLegit: number;
	perplexityFraud: number;
	confusionMatrix: {
		truePositives: number;
		falsePositives: number;
		trueNegatives: number;
		falseNegatives: number;
	};
	samples: number;
}

interface TestCase {
	email: string;
	localPart: string;
	trueLabel: number; // 0 = legit, 1 = fraud
	predictedLabel: number;
	crossEntropyLegit: number;
	crossEntropyFraud: number;
	difference: number;
	correct: boolean;
}

function extractLocalPart(email: string): string | null {
	const parts = email.split('@');
	if (parts.length < 2) return null;

	const localPart = parts[0];
	if (!localPart || localPart.length < 2 || localPart.length > 64) {
		return null;
	}

	return localPart;
}

function calculateMetrics(testCases: TestCase[]): EvalMetrics {
	let tp = 0, fp = 0, tn = 0, fn = 0;
	let sumPerplexityLegit = 0;
	let sumPerplexityFraud = 0;

	for (const tc of testCases) {
		// Confusion matrix
		if (tc.trueLabel === 1 && tc.predictedLabel === 1) tp++;
		else if (tc.trueLabel === 0 && tc.predictedLabel === 1) fp++;
		else if (tc.trueLabel === 0 && tc.predictedLabel === 0) tn++;
		else if (tc.trueLabel === 1 && tc.predictedLabel === 0) fn++;

		// Perplexity = 2^(cross-entropy)
		sumPerplexityLegit += Math.pow(2, tc.crossEntropyLegit);
		sumPerplexityFraud += Math.pow(2, tc.crossEntropyFraud);
	}

	const total = testCases.length;
	const accuracy = (tp + tn) / total;
	const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
	const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
	const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

	return {
		accuracy,
		precision,
		recall,
		f1,
		perplexityLegit: sumPerplexityLegit / total,
		perplexityFraud: sumPerplexityFraud / total,
		confusionMatrix: {
			truePositives: tp,
			falsePositives: fp,
			trueNegatives: tn,
			falseNegatives: fn,
		},
		samples: total,
	};
}

export default async function evaluateMarkov(args: string[]) {
	const parsed = parseArgs(args);

	if (hasFlag(parsed, 'help', 'h')) {
		console.log(`
╔════════════════════════════════════════════════════════╗
║          Evaluate Markov Chain Models                  ║
╚════════════════════════════════════════════════════════╝

Evaluates trained Markov Chain models on a labeled test dataset.
Calculates precision, recall, F1 score, perplexity, and confusion matrix.

USAGE
  npm run cli evaluate:markov [options]

OPTIONS
  --dataset <path>      Test dataset CSV (required)
  --legit <path>        Legitimate model JSON (required)
  --fraud <path>        Fraudulent model JSON (required)
  --threshold <num>     Classification threshold (default: 0.0)
                        Positive = fraud if (H_legit - H_fraud) > threshold
  --verbose, -v         Show per-sample predictions
  --help, -h            Show this help message

OUTPUT METRICS
  Accuracy              (TP + TN) / Total
  Precision             TP / (TP + FP)
  Recall                TP / (TP + FN)
  F1 Score              2 * (Precision * Recall) / (Precision + Recall)
  Perplexity            2^(average cross-entropy)
  Confusion Matrix      TP, FP, TN, FN counts

EXAMPLES
  # Evaluate 2-gram models on validation set
  npm run cli evaluate:markov -- \\
    --dataset dataset/val.csv \\
    --legit markov_legit_2gram.json \\
    --fraud markov_fraud_2gram.json

  # With verbose output
  npm run cli evaluate:markov -- \\
    --dataset dataset/test.csv \\
    --legit markov_legit_3gram.json \\
    --fraud markov_fraud_3gram.json \\
    --verbose

  # Adjust classification threshold
  npm run cli evaluate:markov -- \\
    --dataset dataset/val.csv \\
    --legit markov_legit_2gram.json \\
    --fraud markov_fraud_2gram.json \\
    --threshold 0.1

INTERPRETATION
  - Perplexity: Lower is better (model is less "surprised")
  - F1 Score: Harmonic mean of precision and recall
  - Use validation set for model selection
  - Evaluate on test set only ONCE (final evaluation)

TYPICAL VALUES
  Good model:
    - Accuracy: >90%
    - Precision: >90%
    - Recall: >90%
    - F1: >90%
    - Perplexity (2-gram): ~137
    - Perplexity (3-gram): ~74
`);
		return;
	}

	const options: EvalOptions = {
		dataset: getOption(parsed, 'dataset') || '',
		legitModel: getOption(parsed, 'legit') || '',
		fraudModel: getOption(parsed, 'fraud') || '',
		threshold: parseFloat(getOption(parsed, 'threshold') || '0.0'),
		verbose: hasFlag(parsed, 'verbose', 'v'),
	};

	// Validate required options
	if (!options.dataset) {
		logger.error('--dataset is required');
		process.exit(1);
	}
	if (!options.legitModel) {
		logger.error('--legit model path is required');
		process.exit(1);
	}
	if (!options.fraudModel) {
		logger.error('--fraud model path is required');
		process.exit(1);
	}

	logger.section('🧪 Model Evaluation');
	logger.info(`Dataset: ${options.dataset}`);
	logger.info(`Legit model: ${options.legitModel}`);
	logger.info(`Fraud model: ${options.fraudModel}`);
	logger.info(`Threshold: ${options.threshold.toFixed(2)}`);

	// Load models
	logger.subsection('Loading Models');
	let legitModel: NGramMarkovChain;
	let fraudModel: NGramMarkovChain;

	try {
		const legitJSON = JSON.parse(await readFile(options.legitModel, 'utf-8'));
		legitModel = NGramMarkovChain.fromJSON(legitJSON);
		logger.success(`Loaded ${options.legitModel} (order: ${legitModel.getOrder()}, training count: ${legitJSON.trainingCount})`);
	} catch (error) {
		logger.error(`Failed to load legit model: ${error}`);
		process.exit(1);
	}

	try {
		const fraudJSON = JSON.parse(await readFile(options.fraudModel, 'utf-8'));
		fraudModel = NGramMarkovChain.fromJSON(fraudJSON);
		logger.success(`Loaded ${options.fraudModel} (order: ${fraudModel.getOrder()}, training count: ${fraudJSON.trainingCount})`);
	} catch (error) {
		logger.error(`Failed to load fraud model: ${error}`);
		process.exit(1);
	}

	if (legitModel.getOrder() !== fraudModel.getOrder()) {
		logger.warn(`Model orders don't match: legit=${legitModel.getOrder()}, fraud=${fraudModel.getOrder()}`);
	}

	// Load dataset
	logger.subsection('Loading Dataset');
	let content: string;
	try {
		content = await readFile(options.dataset, 'utf-8');
	} catch (error) {
		logger.error(`Failed to read dataset: ${error}`);
		process.exit(1);
	}

	const records = parse(content, {
		columns: true,
		skip_empty_lines: true,
		relax_quotes: true,
		relax_column_count: true,
	}) as Array<{ email: string; label: string; [key: string]: any }>;

	logger.info(`Loaded ${records.length.toLocaleString()} samples`);

	// Evaluate each sample
	logger.subsection('Evaluating Samples');
	const testCases: TestCase[] = [];
	let skipped = 0;

	for (const record of records) {
		const localPart = extractLocalPart(record.email);
		if (!localPart) {
			skipped++;
			continue;
		}

		const trueLabel = parseInt(record.label, 10);
		if (trueLabel !== 0 && trueLabel !== 1) {
			logger.warn(`Invalid label for ${record.email}: ${record.label}`);
			skipped++;
			continue;
		}

		const H_legit = legitModel.crossEntropy(localPart);
		const H_fraud = fraudModel.crossEntropy(localPart);
		const diff = H_legit - H_fraud;

		// Classification: if fraud cross-entropy is lower, predict fraud
		const predictedLabel = diff > options.threshold ? 1 : 0;
		const correct = predictedLabel === trueLabel;

		testCases.push({
			email: record.email,
			localPart,
			trueLabel,
			predictedLabel,
			crossEntropyLegit: H_legit,
			crossEntropyFraud: H_fraud,
			difference: diff,
			correct,
		});
	}

	if (skipped > 0) {
		logger.warn(`Skipped ${skipped} invalid samples`);
	}

	logger.info(`Evaluated ${testCases.length.toLocaleString()} samples`);

	// Calculate metrics
	logger.subsection('Results');
	const metrics = calculateMetrics(testCases);

	logger.info(`\nPerformance Metrics:`);
	logger.info(`  Accuracy:  ${(metrics.accuracy * 100).toFixed(2)}%`);
	logger.info(`  Precision: ${(metrics.precision * 100).toFixed(2)}%`);
	logger.info(`  Recall:    ${(metrics.recall * 100).toFixed(2)}%`);
	logger.info(`  F1 Score:  ${(metrics.f1 * 100).toFixed(2)}%`);

	logger.info(`\nPerplexity:`);
	logger.info(`  Legit model: ${metrics.perplexityLegit.toFixed(2)}`);
	logger.info(`  Fraud model: ${metrics.perplexityFraud.toFixed(2)}`);

	logger.info(`\nConfusion Matrix:`);
	logger.info(`                  Predicted Legit  Predicted Fraud`);
	logger.info(`  Actual Legit    ${String(metrics.confusionMatrix.trueNegatives).padStart(15)}  ${String(metrics.confusionMatrix.falsePositives).padStart(15)}`);
	logger.info(`  Actual Fraud    ${String(metrics.confusionMatrix.falseNegatives).padStart(15)}  ${String(metrics.confusionMatrix.truePositives).padStart(15)}`);

	// Verbose output
	if (options.verbose) {
		logger.subsection('Sample Predictions');

		// Show some correct and incorrect predictions
		const correct = testCases.filter(tc => tc.correct).slice(0, 5);
		const incorrect = testCases.filter(tc => !tc.correct).slice(0, 10);

		if (correct.length > 0) {
			logger.info('\nCorrect predictions (first 5):');
			for (const tc of correct) {
				const label = tc.trueLabel === 1 ? 'fraud' : 'legit';
				logger.info(`  ✓ ${tc.localPart} → ${label} (H_legit=${tc.crossEntropyLegit.toFixed(2)}, H_fraud=${tc.crossEntropyFraud.toFixed(2)}, diff=${tc.difference.toFixed(2)})`);
			}
		}

		if (incorrect.length > 0) {
			logger.info('\nIncorrect predictions (first 10):');
			for (const tc of incorrect) {
				const trueLabel = tc.trueLabel === 1 ? 'fraud' : 'legit';
				const predLabel = tc.predictedLabel === 1 ? 'fraud' : 'legit';
				logger.info(`  ✗ ${tc.localPart} → predicted ${predLabel}, actual ${trueLabel} (H_legit=${tc.crossEntropyLegit.toFixed(2)}, H_fraud=${tc.crossEntropyFraud.toFixed(2)}, diff=${tc.difference.toFixed(2)})`);
			}
		}
	}

	logger.section('✅ Evaluation Complete!');

	// Quality assessment
	if (metrics.f1 >= 0.9) {
		logger.success(`Excellent performance! F1 score: ${(metrics.f1 * 100).toFixed(2)}%`);
	} else if (metrics.f1 >= 0.8) {
		logger.info(`Good performance. F1 score: ${(metrics.f1 * 100).toFixed(2)}%`);
	} else if (metrics.f1 >= 0.7) {
		logger.warn(`Moderate performance. F1 score: ${(metrics.f1 * 100).toFixed(2)}%`);
		logger.warn('Consider retraining with more data or adjusting threshold.');
	} else {
		logger.error(`Poor performance. F1 score: ${(metrics.f1 * 100).toFixed(2)}%`);
		logger.error('Model needs significant improvement.');
	}
}
