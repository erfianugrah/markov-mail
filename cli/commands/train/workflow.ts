/**
 * Unified Training Workflow Command
 *
 * Orchestrates the complete training pipeline:
 * 1. Split dataset (train/val/test)
 * 2. Train models on training set
 * 3. Evaluate on validation set
 * 4. Optionally evaluate on test set
 * 5. Upload to production KV
 */

import { $ } from 'bun';
import { logger } from '../../utils/logger.ts';
import { parseArgs, getOption, hasFlag } from '../../utils/args.ts';

interface WorkflowOptions {
	dataset: string;
	ratios: string;
	orders: string;
	skipSplit: boolean;
	skipEval: boolean;
	skipTest: boolean;
	upload: boolean;
	remote: boolean;
	seed: number;
}

export default async function trainWorkflow(args: string[]) {
	const parsed = parseArgs(args);

	if (hasFlag(parsed, 'help', 'h')) {
		console.log(`
╔════════════════════════════════════════════════════════╗
║          Complete Training Workflow                    ║
╚════════════════════════════════════════════════════════╝

Orchestrates the complete ML training pipeline with proper
train/validation/test methodology.

WORKFLOW STEPS:
  1. Split dataset into train/val/test (stratified sampling)
  2. Train Markov models on training set only
  3. Evaluate on validation set (model selection)
  4. Optionally evaluate on test set (final performance)
  5. Upload models to production KV

USAGE
  npm run cli train:workflow [options]

OPTIONS
  --dataset <path>      Input dataset CSV (required)
  --ratios <list>       Split ratios (default: "0.7,0.15,0.15")
  --orders <list>       N-gram orders to train (default: "2,3")
  --seed <number>       Random seed for reproducibility (default: 42)
  --skip-split          Skip dataset split (use existing train/val/test.csv)
  --skip-eval           Skip validation evaluation
  --skip-test           Skip test set evaluation
  --upload              Upload models to KV after training
  --remote              Use remote KV (requires --upload)
  --help, -h            Show this help message

EXAMPLES
  # Complete workflow (recommended)
  npm run cli train:workflow -- --dataset dataset/main.csv --upload --remote

  # Custom split ratios (80/10/10)
  npm run cli train:workflow -- \\
    --dataset dataset/main.csv \\
    --ratios "0.8,0.1,0.1"

  # Skip split if already done
  npm run cli train:workflow -- \\
    --dataset dataset/main.csv \\
    --skip-split

  # Train only, no evaluation
  npm run cli train:workflow -- \\
    --dataset dataset/main.csv \\
    --skip-eval --skip-test

  # Include test set evaluation (use sparingly!)
  npm run cli train:workflow -- \\
    --dataset dataset/main.csv \\
    --upload --remote

BEST PRACTICES
  1. Run complete workflow once to establish baseline
  2. Iterate on validation set (don't touch test set)
  3. Evaluate on test set only for final performance check
  4. Use same --seed for reproducible experiments
  5. Upload to production only after validation looks good

OUTPUT
  - dataset/train.csv, val.csv, test.csv (if not skipped)
  - markov_legit_2gram.json, markov_fraud_2gram.json
  - markov_legit_3gram.json, markov_fraud_3gram.json
  - Validation metrics (accuracy, precision, recall, F1)
  - Test metrics (if not skipped)
`);
		return;
	}

	const options: WorkflowOptions = {
		dataset: getOption(parsed, 'dataset') || '',
		ratios: getOption(parsed, 'ratios') || '0.7,0.15,0.15',
		orders: getOption(parsed, 'orders') || '2,3',
		skipSplit: hasFlag(parsed, 'skip-split'),
		skipEval: hasFlag(parsed, 'skip-eval'),
		skipTest: hasFlag(parsed, 'skip-test'),
		upload: hasFlag(parsed, 'upload'),
		remote: hasFlag(parsed, 'remote'),
		seed: parseInt(getOption(parsed, 'seed') || '42', 10),
	};

	if (!options.dataset) {
		logger.error('--dataset is required');
		logger.error('Example: npm run cli train:workflow -- --dataset dataset/main.csv');
		process.exit(1);
	}

	logger.section('🔄 Complete Training Workflow');
	logger.info(`Dataset: ${options.dataset}`);
	logger.info(`Orders: ${options.orders}`);
	logger.info(`Seed: ${options.seed}`);

	const startTime = Date.now();

	// Step 1: Split dataset
	if (!options.skipSplit) {
		logger.section('📊 Step 1: Split Dataset');
		logger.info('Creating train/val/test splits with stratified sampling...');

		try {
			await $`npm run cli dataset:split -- --input ${options.dataset} --ratios ${options.ratios} --shuffle --seed ${options.seed}`.quiet();
			logger.success('Dataset split complete');
		} catch (error) {
			logger.error(`Dataset split failed: ${error}`);
			process.exit(1);
		}
	} else {
		logger.section('📊 Step 1: Split Dataset (Skipped)');
		logger.info('Using existing train/val/test.csv files');
	}

	// Step 2: Train models
	logger.section('🧠 Step 2: Train Models');
	logger.info('Training on training set only...');

	const trainDataset = options.skipSplit ? 'dataset/train.csv' : './dataset/train.csv';
	const uploadFlag = options.upload ? '--upload' : '';
	const remoteFlag = options.remote ? '--remote' : '';

	try {
		await $`npm run cli train:markov -- --dataset ${trainDataset} --orders ${options.orders} ${uploadFlag} ${remoteFlag}`.quiet();
		logger.success('Model training complete');
	} catch (error) {
		logger.error(`Training failed: ${error}`);
		process.exit(1);
	}

	// Step 3: Evaluate on validation set
	if (!options.skipEval) {
		logger.section('📈 Step 3: Evaluate on Validation Set');

		const ordersList = options.orders.split(',').map(s => parseInt(s.trim()));

		for (const order of ordersList) {
			logger.subsection(`Evaluating ${order}-gram model`);

			const legitModel = `markov_legit_${order}gram.json`;
			const fraudModel = `markov_fraud_${order}gram.json`;

			try {
				await $`npm run cli evaluate:markov -- --dataset ./dataset/val.csv --legit ${legitModel} --fraud ${fraudModel}`;
			} catch (error) {
				logger.warn(`Evaluation of ${order}-gram failed: ${error}`);
			}
		}
	} else {
		logger.section('📈 Step 3: Evaluate on Validation Set (Skipped)');
	}

	// Step 4: Evaluate on test set (optional, use sparingly)
	if (!options.skipTest) {
		logger.section('🎯 Step 4: Final Test Set Evaluation');
		logger.warn('⚠️  Evaluating on test set. Use this ONLY for final performance check!');

		const ordersList = options.orders.split(',').map(s => parseInt(s.trim()));

		for (const order of ordersList) {
			logger.subsection(`Testing ${order}-gram model`);

			const legitModel = `markov_legit_${order}gram.json`;
			const fraudModel = `markov_fraud_${order}gram.json`;

			try {
				await $`npm run cli evaluate:markov -- --dataset ./dataset/test.csv --legit ${legitModel} --fraud ${fraudModel}`;
			} catch (error) {
				logger.warn(`Test evaluation of ${order}-gram failed: ${error}`);
			}
		}
	} else {
		logger.section('🎯 Step 4: Final Test Set Evaluation (Skipped)');
		logger.info('✓ Test set preserved for final evaluation');
	}

	// Summary
	const duration = ((Date.now() - startTime) / 1000).toFixed(1);

	logger.section('✅ Workflow Complete!');
	logger.info(`Total time: ${duration}s`);

	if (options.upload) {
		logger.success('Models uploaded to KV');
		logger.info('Next step: Deploy worker to activate new models');
		logger.info('  npm run deploy');
	} else {
		logger.info('Next steps:');
		logger.info('1. Review validation metrics above');
		logger.info('2. If satisfied, upload to production:');
		logger.info('     npm run cli train:workflow -- --dataset dataset/main.csv --skip-split --skip-eval --skip-test --upload --remote');
		logger.info('3. Deploy worker:');
		logger.info('     npm run deploy');
	}

	logger.info('\n📊 Files generated:');
	if (!options.skipSplit) {
		logger.info('  - dataset/train.csv (training set)');
		logger.info('  - dataset/val.csv (validation set)');
		logger.info('  - dataset/test.csv (test set)');
	}
	logger.info('  - markov_legit_2gram.json');
	logger.info('  - markov_fraud_2gram.json');
	if (options.orders.includes('3')) {
		logger.info('  - markov_legit_3gram.json');
		logger.info('  - markov_fraud_3gram.json');
	}
}
