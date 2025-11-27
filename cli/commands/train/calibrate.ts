/**
 * Calibration Training Command
 *
 * Fits a logistic calibration layer on top of the Markov outputs + metadata.
 *
 * Usage:
 *   npm run cli train:calibrate --dataset dataset/training_compiled/training_compiled.csv --models models --output calibration.json
 */

import { readFileSync, writeFileSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { parse } from 'csv-parse/sync';
import { NGramMarkovChain } from '../../../src/detectors/ngram-markov.ts';
import { normalizeEmail } from '../../../src/detectors/plus-addressing.ts';
import { detectSequentialPattern } from '../../../src/detectors/sequential.ts';
import { getPlusAddressingRiskScore } from '../../../src/detectors/plus-addressing.ts';
import { validateDomain } from '../../../src/validators/domain.ts';
import { calculateAbnormality } from '../../../src/detectors/markov-ensemble.ts';
import { buildCalibrationFeatureMap, type CalibrationCoefficients } from '../../../src/utils/calibration.ts';
import { extractLocalPartFeatureSignals } from '../../../src/detectors/linguistic-features.ts';
import { DEFAULT_CONFIG } from '../../../src/config/defaults.ts';
import { logger } from '../../utils/logger.ts';
import { parseArgs, getOption, hasFlag } from '../../utils/args.ts';
import { $ } from 'bun';

interface CalibrationOptions {
	dataset: string;
	modelsDir: string;
	output: string;
	orders: number[];
	upload: boolean;
	remote: boolean;
	binding: string;
	allowEmpty: boolean;
}

interface SampleRow {
	email: string;
	label: number;
}

interface FeatureSample {
	features: Record<string, number>;
	label: number;
}

export default async function calibrateCommand(args: string[]) {
	const parsed = parseArgs(args);

	if (hasFlag(parsed, 'help', 'h')) {
		printHelp();
		return;
	}

	const orders = (getOption(parsed, 'orders') || '2,3')
		.split(',')
		.map((s) => parseInt(s.trim(), 10))
		.filter((n) => n === 2 || n === 3);

	if (orders.length === 0) {
		logger.error('Specify at least one order using --orders "2,3"');
		process.exit(1);
	}

	const options: CalibrationOptions = {
		dataset: getOption(parsed, 'dataset') || 'dataset/training_compiled/training_compiled.csv',
		modelsDir: getOption(parsed, 'models') || 'models',
		output: getOption(parsed, 'output') || 'calibration.json',
		orders,
		upload: hasFlag(parsed, 'upload'),
		remote: hasFlag(parsed, 'remote'),
		binding: getOption(parsed, 'binding') || 'CONFIG',
		allowEmpty: hasFlag(parsed, 'allow-empty'),
	};

	if (options.remote && !options.upload) {
		logger.warn('--remote flag ignored without --upload');
		options.remote = false;
	}

	logger.section('🎯 Calibration Training');
	logger.info(`Dataset: ${options.dataset}`);
	logger.info(`Models dir: ${options.modelsDir}`);

	const samples = loadDataset(options.dataset);
	logger.info(`Loaded ${samples.length.toLocaleString()} labeled emails`);

	const models = loadMarkovModels(options.modelsDir, options.orders);

	const featureSamples: FeatureSample[] = [];
	let processed = 0;

	for (const sample of samples) {
		const normalized = normalizeEmail(sample.email);
		const providerNormalized = normalized.providerNormalized || sample.email.toLowerCase();
		const [localPart] = providerNormalized.split('@');
		if (!localPart) {
			continue;
		}

		const sequential = detectSequentialPattern(providerNormalized);
		const localPartFeatures = extractLocalPartFeatureSignals(localPart);
		const plusRisk = getPlusAddressingRiskScore(sample.email);

		const markovFeatures = computeMarkovCrossEntropies(localPart, models);
		const minEntropy = Math.min(
			markovFeatures.ceLegit2 ?? Infinity,
			markovFeatures.ceFraud2 ?? Infinity,
			markovFeatures.ceLegit3 ?? Infinity,
			markovFeatures.ceFraud3 ?? Infinity,
		);
		const abnormality = calculateAbnormality(
			isFinite(minEntropy) ? minEntropy : 0,
			{ ood: DEFAULT_CONFIG.ood },
		);

		const domain = sample.email.split('@')[1] || '';
		const domainValidation = validateDomain(domain);

		const featureMap = buildCalibrationFeatureMap({
			markov: {
				ceLegit2: markovFeatures.ceLegit2,
				ceFraud2: markovFeatures.ceFraud2,
				ceLegit3: markovFeatures.ceLegit3,
				ceFraud3: markovFeatures.ceFraud3,
				minEntropy: isFinite(minEntropy) ? minEntropy : undefined,
				abnormalityRisk: abnormality.abnormalityRisk,
			},
			sequentialConfidence: sequential.confidence,
			plusRisk,
			localPartLength: localPart.length,
			digitRatio: localPartFeatures.statistical.digitRatio,
			providerIsFree: domainValidation.isFreeProvider,
			providerIsDisposable: domainValidation.isDisposable,
			tldRisk: 0,
			linguistic: {
				pronounceability: localPartFeatures.linguistic.pronounceability,
				vowelRatio: localPartFeatures.linguistic.vowelRatio,
				maxConsonantCluster: localPartFeatures.linguistic.maxConsonantCluster,
				repeatedCharRatio: localPartFeatures.linguistic.repeatedCharRatio,
				syllableEstimate: localPartFeatures.linguistic.syllableEstimate,
				impossibleClusterCount: localPartFeatures.linguistic.impossibleClusterCount,
			},
			structure: {
				hasWordBoundaries: localPartFeatures.structure.hasWordBoundaries,
				segmentCount: localPartFeatures.structure.segmentCount,
				avgSegmentLength: localPartFeatures.structure.avgSegmentLength,
				segmentsWithoutVowelsRatio: localPartFeatures.structure.segmentsWithoutVowelsRatio,
			},
			statistical: {
				uniqueCharRatio: localPartFeatures.statistical.uniqueCharRatio,
				vowelGapRatio: localPartFeatures.statistical.vowelGapRatio,
				maxDigitRun: localPartFeatures.statistical.maxDigitRun,
			},
		});

		featureSamples.push({
			features: featureMap,
			label: sample.label,
		});

		processed++;
		if (processed % 10000 === 0) {
			logger.info(`Processed ${processed.toLocaleString()} samples`);
		}
	}

	logger.info(`Final samples with features: ${featureSamples.length.toLocaleString()}`);

	const featureNames = Object.keys(featureSamples[0]?.features || {});
	if (featureNames.length === 0) {
		logger.error('No features extracted; cannot train calibration layer');
		process.exit(1);
	}

	const calibration = trainCalibration(featureSamples, featureNames);

	const outputPath = resolve(options.output);
	writeFileSync(outputPath, JSON.stringify(calibration, null, 2));
	logger.success(`Calibration coefficients saved to ${outputPath}`);

	if (options.upload) {
		await uploadCalibrationToKV(calibration, {
			binding: options.binding,
			remote: options.remote,
			allowEmpty: options.allowEmpty,
		});
	} else {
		logger.info('To upload the calibration coefficients to KV:');
		logger.info(`  npm run cli train:calibrate --dataset ${options.dataset} --models ${options.modelsDir} --output ${options.output} --upload${options.remote ? ' --remote' : ''}`);
	}
}

function printHelp() {
	console.log(`
╔════════════════════════════════════════════════════════╗
║              Calibration Training                      ║
╚════════════════════════════════════════════════════════╝

Fits a logistic calibration layer on top of the Markov ensemble.

USAGE
  npm run cli train:calibrate [options]

OPTIONS
  --dataset <path>    Training CSV (default: dataset/training_compiled/training_compiled.csv)
  --models <dir>      Directory containing markov_legit_*.json files (default: models)
  --output <path>     Output calibration JSON (default: calibration.json)
  --orders <list>     N-gram orders to use (comma separated, default: "2,3")
  --upload            Upload calibration JSON into config KV
  --remote            Use remote KV when uploading (requires --upload)
  --binding <name>    KV binding for config (default: CONFIG)
  --allow-empty       Allow creating config.json if it doesn't already exist
  --help, -h          Show this help message

Example:
  npm run cli train:calibrate \\
    --dataset dataset/training_compiled/training_compiled.csv \\
    --models models \\
    --output calibration.json \\
    --upload --remote
`);
}

function loadDataset(path: string): SampleRow[] {
	const resolved = resolve(path);
	logger.subsection('Loading Dataset');
	logger.info(`Reading ${resolved}`);
	const content = readFileSync(resolved, 'utf-8');
	let records: Array<Record<string, any>>;

	try {
		records = parse(content, {
			columns: true,
			skip_empty_lines: true,
			relax_quotes: true,
			relax_column_count: true,
		}) as Array<Record<string, any>>;
	} catch (error) {
		logger.error(`Failed to parse dataset: ${(error as Error).message}`);
		throw error;
	}

	return records
		.map((record) => {
			const email = (record.email || record.Email || record.sender || '').trim();
			if (!email) return null;
			const labelRaw = record.label ?? record.Label ?? record.type ?? record.Type ?? record.expected ?? record.Expected ?? '0';
			const label =
				typeof labelRaw === 'string'
					? (labelRaw.trim().toLowerCase() === 'fraud' || labelRaw.trim() === '1' ? 1 : 0)
					: Number(labelRaw) === 1 ? 1 : 0;

			return { email, label };
		})
		.filter((row): row is SampleRow => !!row);
}

function loadMarkovModels(modelsDir: string, orders: number[]) {
	const resolved = resolve(modelsDir);
	const models: Record<string, NGramMarkovChain | null> = {
		legit2: null,
		fraud2: null,
		legit3: null,
		fraud3: null,
	};

	if (orders.includes(2)) {
		models.legit2 = loadModel(join(resolved, 'markov_legit_2gram.json'));
		models.fraud2 = loadModel(join(resolved, 'markov_fraud_2gram.json'));
	}

	if (orders.includes(3)) {
		models.legit3 = loadModel(join(resolved, 'markov_legit_3gram.json'));
		models.fraud3 = loadModel(join(resolved, 'markov_fraud_3gram.json'));
	}

	return models;
}

function loadModel(path: string): NGramMarkovChain {
	try {
		const json = JSON.parse(readFileSync(path, 'utf-8'));
		return NGramMarkovChain.fromJSON(json);
	} catch (error) {
		logger.error(`Failed to load model ${path}: ${(error as Error).message}`);
		throw error;
	}
}

function computeMarkovCrossEntropies(
	localPart: string,
	models: Record<string, NGramMarkovChain | null>
) {
	return {
		ceLegit2: models.legit2 ? models.legit2.crossEntropy(localPart) : undefined,
		ceFraud2: models.fraud2 ? models.fraud2.crossEntropy(localPart) : undefined,
		ceLegit3: models.legit3 ? models.legit3.crossEntropy(localPart) : undefined,
		ceFraud3: models.fraud3 ? models.fraud3.crossEntropy(localPart) : undefined,
	};
}

function trainCalibration(samples: FeatureSample[], featureNames: string[]): CalibrationCoefficients {
	const featureStats = featureNames.map((name) => {
		const values = samples.map((sample) => sample.features[name] ?? 0);
		const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
		const variance =
			values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
		const std = Math.max(Math.sqrt(variance), 1e-6);
		return { name, mean, std, weight: 0 };
	});

	const normalizedData = samples.map((sample) =>
		featureStats.map((stat) => {
			const value = sample.features[stat.name] ?? 0;
			return (value - stat.mean) / stat.std;
		}),
	);

	const labels = samples.map((sample) => sample.label);

	const { bias, weights } = logisticRegression(normalizedData, labels, 0.01, 300);

	featureStats.forEach((stat, index) => {
		stat.weight = weights[index];
	});

	const predictions = normalizedData.map((row) => sigmoid(bias + dot(weights, row)));
	const metrics = computeMetrics(predictions, labels);

	const version = `calibration_${new Date().toISOString().replace(/[-:.TZ]/g, '')}`;

	return {
		version,
		createdAt: new Date().toISOString(),
		bias,
		features: featureStats,
		metrics,
	};
}

interface UploadOptions {
	binding: string;
	remote: boolean;
	allowEmpty: boolean;
}

async function uploadCalibrationToKV(
	calibration: CalibrationCoefficients,
	options: UploadOptions
) {
	logger.section('📤 Uploading Calibration to KV');
	logger.info(`Binding: ${options.binding}`);

	const remoteFlag = options.remote ? '--remote' : '';
	let configData: Record<string, any> | null = null;

	try {
		const existingConfig = await $`npx wrangler kv key get config.json --binding=${options.binding} ${remoteFlag}`.text();
		if (existingConfig && existingConfig.trim().length > 0) {
			configData = JSON.parse(existingConfig);
		}
	} catch (error) {
		logger.error(`❌ Failed to fetch existing config.json: ${error}`);
		if (!options.allowEmpty) {
			throw new Error('Load existing config before uploading calibration or pass --allow-empty to create a new file.');
		}
	}

	if (!configData) {
		if (!options.allowEmpty) {
			throw new Error('No config.json found in KV. Upload a base config (or pass --allow-empty) before adding calibration.');
		}
		configData = {};
	}

	configData.calibration = calibration;

	const tempFile = `/tmp/config-${Date.now()}.json`;
	writeFileSync(tempFile, JSON.stringify(configData, null, 2));

	try {
		await $`npx wrangler kv key put config.json --path=${tempFile} --binding=${options.binding} ${remoteFlag}`.quiet();
		logger.success('✅ Calibration uploaded to KV');
	} catch (error) {
		logger.error(`Failed to upload calibration: ${error}`);
		throw error;
	} finally {
		try {
			rmSync(tempFile);
		} catch {
			// ignore cleanup errors
		}
	}
}

function logisticRegression(
	data: number[][],
	labels: number[],
	learningRate: number,
	epochs: number,
) {
	const featureCount = data[0]?.length || 0;
	let bias = 0;
	let weights = new Array(featureCount).fill(0);

	for (let epoch = 0; epoch < epochs; epoch++) {
		for (let i = 0; i < data.length; i++) {
			const prediction = sigmoid(bias + dot(weights, data[i]));
			const error = prediction - labels[i];

			bias -= learningRate * error;
			for (let j = 0; j < featureCount; j++) {
				weights[j] -= learningRate * error * data[i][j];
			}
		}

		if ((epoch + 1) % 50 === 0) {
			learningRate *= 0.9;
		}
	}

	return { bias, weights };
}

function sigmoid(z: number): number {
	return 1 / (1 + Math.exp(-z));
}

function dot(a: number[], b: number[]): number {
	let sum = 0;
	for (let i = 0; i < a.length; i++) {
		sum += a[i] * b[i];
	}
	return sum;
}

function computeMetrics(predictions: number[], labels: number[]) {
	let tp = 0;
	let fp = 0;
	let tn = 0;
	let fn = 0;

	for (let i = 0; i < predictions.length; i++) {
		const predLabel = predictions[i] >= 0.5 ? 1 : 0;
		if (predLabel === 1 && labels[i] === 1) tp++;
		else if (predLabel === 1 && labels[i] === 0) fp++;
		else if (predLabel === 0 && labels[i] === 0) tn++;
		else fn++;
	}

	const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
	const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
	const accuracy = (tp + tn) / (tp + tn + fp + fn);
	const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

	logger.info(`Calibration metrics: accuracy=${accuracy.toFixed(3)}, precision=${precision.toFixed(3)}, recall=${recall.toFixed(3)}, f1=${f1.toFixed(3)}`);

	return { accuracy, precision, recall, f1 };
}
