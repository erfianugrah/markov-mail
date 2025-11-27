/**
 * Dataset Split Command
 *
 * Splits a dataset into train/validation/test sets with stratified sampling
 * to maintain label balance across all splits.
 */

import { readFile, writeFile } from 'fs/promises';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { logger } from '../../utils/logger.ts';
import { parseArgs, getOption, hasFlag } from '../../utils/args.ts';

interface SplitOptions {
	input: string;
	output: string;
	ratios: [number, number, number]; // [train, val, test]
	shuffle: boolean;
	seed: number;
}

interface Record {
	email: string;
	label: string;
	category?: string;
	[key: string]: any;
}

/**
 * Shuffle array using Fisher-Yates algorithm with optional seeding
 */
function shuffleArray<T>(array: T[], seed?: number): T[] {
	const shuffled = [...array];

	// Simple seeded random if seed provided
	let random = seed !== undefined
		? () => {
			seed = (seed * 9301 + 49297) % 233280;
			return seed / 233280;
		}
		: Math.random;

	for (let i = shuffled.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
	}

	return shuffled;
}

/**
 * Stratified split: maintain label balance across all splits
 */
function stratifiedSplit(
	records: Record[],
	ratios: [number, number, number],
	shuffle: boolean,
	seed?: number
): { train: Record[]; val: Record[]; test: Record[] } {
	// Group by label
	const byLabel = new Map<string, Record[]>();

	for (const record of records) {
		const label = record.label;
		if (!byLabel.has(label)) {
			byLabel.set(label, []);
		}
		byLabel.get(label)!.push(record);
	}

	logger.info(`Found ${byLabel.size} unique labels`);
	for (const [label, items] of byLabel.entries()) {
		logger.info(`  Label ${label}: ${items.length.toLocaleString()} samples`);
	}

	const train: Record[] = [];
	const val: Record[] = [];
	const test: Record[] = [];

	// Split each label group proportionally
	for (const [label, items] of byLabel.entries()) {
		const shuffled = shuffle ? shuffleArray(items, seed) : items;
		const total = shuffled.length;

		const trainCount = Math.floor(total * ratios[0]);
		const valCount = Math.floor(total * ratios[1]);
		// Remaining go to test (handles rounding)

		train.push(...shuffled.slice(0, trainCount));
		val.push(...shuffled.slice(trainCount, trainCount + valCount));
		test.push(...shuffled.slice(trainCount + valCount));
	}

	// Shuffle the combined sets to mix labels
	if (shuffle) {
		return {
			train: shuffleArray(train, seed),
			val: shuffleArray(val, seed ? seed + 1 : undefined),
			test: shuffleArray(test, seed ? seed + 2 : undefined),
		};
	}

	return { train, val, test };
}

export default async function splitDataset(args: string[]) {
	const parsed = parseArgs(args);

	if (hasFlag(parsed, 'help', 'h')) {
		console.log(`
╔════════════════════════════════════════════════════════╗
║          Split Dataset into Train/Val/Test             ║
╚════════════════════════════════════════════════════════╝

Splits a labeled CSV dataset into training, validation, and test sets
using stratified sampling to maintain label balance.

USAGE
  npm run cli dataset:split [options]

OPTIONS
  --input <path>      Input CSV file (required)
  --output <dir>      Output directory (default: ./dataset)
  --ratios <list>     Split ratios as train,val,test (default: "0.7,0.15,0.15")
                      Must sum to 1.0
  --shuffle           Shuffle data before splitting (recommended)
  --seed <number>     Random seed for reproducibility (default: 42)
  --help, -h          Show this help message

OUTPUT FILES
  <output>/train.csv       Training set (default: 70%)
  <output>/val.csv         Validation set (default: 15%)
  <output>/test.csv        Test set (default: 15%)

EXAMPLES
  # Basic split with defaults (70/15/15)
  npm run cli dataset:split -- --input dataset/main.csv

  # Custom ratios (80/10/10)
  npm run cli dataset:split -- --input dataset/main.csv --ratios "0.8,0.1,0.1"

  # With shuffling and custom seed
  npm run cli dataset:split -- --input dataset/main.csv --shuffle --seed 12345

  # Output to custom directory
  npm run cli dataset:split -- --input dataset/main.csv --output ./splits

WHY STRATIFIED SPLIT?
  Stratified sampling ensures each split has the same proportion of
  labels as the original dataset. This is critical for:
  - Preventing class imbalance in validation/test sets
  - Ensuring reliable evaluation metrics
  - Fair comparison across different model configurations

BEST PRACTICES
  1. Always use --shuffle to avoid source clustering
  2. Use same --seed for reproducible experiments
  3. Keep test set separate - evaluate on it only ONCE
  4. Use validation set for hyperparameter tuning
  5. Never train on validation or test data
`);
		return;
	}

	// Parse and validate ratios
	const ratiosStr = getOption(parsed, 'ratios') || '0.7,0.15,0.15';
	const ratios = ratiosStr.split(',').map(s => parseFloat(s.trim())) as [number, number, number];

	if (ratios.length !== 3) {
		logger.error('Ratios must have exactly 3 values: train,val,test');
		logger.error('Example: --ratios "0.7,0.15,0.15"');
		process.exit(1);
	}

	const sum = ratios.reduce((a, b) => a + b, 0);
	if (Math.abs(sum - 1.0) > 0.001) {
		logger.error(`Ratios must sum to 1.0 (got ${sum.toFixed(3)})`);
		process.exit(1);
	}

	if (ratios.some(r => r <= 0 || r >= 1)) {
		logger.error('Each ratio must be between 0 and 1');
		process.exit(1);
	}

	const options: SplitOptions = {
		input: getOption(parsed, 'input') || '',
		output: getOption(parsed, 'output') || './dataset',
		ratios,
		shuffle: hasFlag(parsed, 'shuffle'),
		seed: parseInt(getOption(parsed, 'seed') || '42', 10),
	};

	if (!options.input) {
		logger.error('--input is required');
		logger.error('Example: npm run cli dataset:split -- --input dataset/main.csv');
		process.exit(1);
	}

	logger.section('📊 Dataset Split');
	logger.info(`Input: ${options.input}`);
	logger.info(`Output: ${options.output}`);
	logger.info(`Ratios: ${(ratios[0] * 100).toFixed(0)}% train / ${(ratios[1] * 100).toFixed(0)}% val / ${(ratios[2] * 100).toFixed(0)}% test`);
	logger.info(`Shuffle: ${options.shuffle ? 'Yes' : 'No'}`);
	if (options.shuffle) {
		logger.info(`Seed: ${options.seed}`);
	}

	// Load dataset
	logger.subsection('Loading Dataset');
	let content: string;
	try {
		content = await readFile(options.input, 'utf-8');
	} catch (error) {
		logger.error(`Failed to read ${options.input}: ${error}`);
		process.exit(1);
	}

	const records = parse(content, {
		columns: true,
		skip_empty_lines: true,
		relax_quotes: true,
		relax_column_count: true,
	}) as Record[];

	logger.info(`Loaded ${records.length.toLocaleString()} records`);

	// Validate required columns
	if (records.length === 0) {
		logger.error('Dataset is empty');
		process.exit(1);
	}

	const firstRecord = records[0];
	if (!firstRecord.email || firstRecord.label === undefined) {
		logger.error('Dataset must have "email" and "label" columns');
		logger.error(`Found columns: ${Object.keys(firstRecord).join(', ')}`);
		process.exit(1);
	}

	// Perform stratified split
	logger.subsection('Splitting Dataset');
	const splits = stratifiedSplit(records, ratios, options.shuffle, options.seed);

	logger.info(`Train: ${splits.train.length.toLocaleString()} samples (${((splits.train.length / records.length) * 100).toFixed(1)}%)`);
	logger.info(`Val:   ${splits.val.length.toLocaleString()} samples (${((splits.val.length / records.length) * 100).toFixed(1)}%)`);
	logger.info(`Test:  ${splits.test.length.toLocaleString()} samples (${((splits.test.length / records.length) * 100).toFixed(1)}%)`);

	// Show label distribution in each split
	logger.subsection('Label Distribution');
	for (const [name, data] of Object.entries(splits)) {
		const labelCounts = new Map<string, number>();
		for (const record of data) {
			labelCounts.set(record.label, (labelCounts.get(record.label) || 0) + 1);
		}

		logger.info(`${name}:`);
		for (const [label, count] of labelCounts.entries()) {
			const pct = ((count / data.length) * 100).toFixed(1);
			logger.info(`  Label ${label}: ${count.toLocaleString()} (${pct}%)`);
		}
	}

	// Save splits
	logger.subsection('Saving Splits');

	const trainPath = `${options.output}/train.csv`;
	const valPath = `${options.output}/val.csv`;
	const testPath = `${options.output}/test.csv`;

	try {
		await writeFile(trainPath, stringify(splits.train, { header: true }));
		logger.success(`Saved ${trainPath}`);

		await writeFile(valPath, stringify(splits.val, { header: true }));
		logger.success(`Saved ${valPath}`);

		await writeFile(testPath, stringify(splits.test, { header: true }));
		logger.success(`Saved ${testPath}`);
	} catch (error) {
		logger.error(`Failed to save splits: ${error}`);
		process.exit(1);
	}

	logger.section('✅ Split Complete!');
	logger.info('\nNext steps:');
	logger.info(`1. Train models on training set:`);
	logger.info(`   npm run cli train:markov -- --dataset ${trainPath} --orders "2,3"`);
	logger.info(`2. Evaluate on validation set:`);
	logger.info(`   npm run cli evaluate:markov -- --dataset ${valPath} --models ./markov_*.json`);
	logger.info(`3. Final test evaluation (once):`);
	logger.info(`   npm run cli evaluate:markov -- --dataset ${testPath} --models ./markov_*.json`);
}
