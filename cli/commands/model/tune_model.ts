import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs, getOption, hasFlag } from '../../utils/args';
import { logger } from '../../utils/logger';

function printHelp() {
	console.log(`
╔═══════════════════════════════════════════════════════════════╗
║           Random Forest Hyperparameter Tuning                 ║
╚═══════════════════════════════════════════════════════════════╝

USAGE
  npm run cli model:tune -- [options]

OPTIONS
  --dataset <path>              Feature matrix CSV (default: data/features/export.csv)
  --label-column <name>         Label column name (default: label)
  --n-iter <n>                  Randomized search iterations (default: 25)
  --cv <n>                      Cross-validation folds (default: 5)
  --scoring <metric>            Sklearn scoring metric (default: roc_auc)
  --n-estimators-min <n>        Minimum trees sampled (default: 25)
  --n-estimators-max <n>        Maximum trees sampled (default: 250)
  --max-depth-min <n>           Minimum max_depth sampled (default: 4)
  --max-depth-max <n>           Maximum max_depth sampled (default: 18)
  --min-samples-leaf-min <n>    Minimum leaf size sampled (default: 1)
  --min-samples-leaf-max <n>    Maximum leaf size sampled (default: 50)
  --random-state <n>            Random seed (default: 42)
  --output <path>               Optional JSON file for summary results
  --help, -h                    Show this help

EXAMPLES
  npm run cli model:tune -- --dataset data/features/export.csv --n-iter 40
  npm run cli model:tune -- --scoring average_precision --output data/tuning/latest.json
`);
}

function buildPythonArgs(options: Record<string, string | undefined>): string[] {
	const args: string[] = [];
	for (const [key, value] of Object.entries(options)) {
		if (value === undefined) continue;
		args.push(`--${key}`, value);
	}
	return args;
}

export default async function tuneModelCommand(rawArgs: string[]) {
	const parsed = parseArgs(rawArgs);

	if (hasFlag(parsed, 'help', 'h')) {
		printHelp();
		return;
	}

	const datasetInput = getOption(parsed, 'dataset') ?? 'data/features/export.csv';
	const dataset = resolve(process.cwd(), datasetInput);
	const labelColumn = getOption(parsed, 'label-column') ?? 'label';
	const nIter = getOption(parsed, 'n-iter', 'iterations') ?? '25';
	const cv = getOption(parsed, 'cv') ?? '5';
	const scoring = getOption(parsed, 'scoring') ?? 'roc_auc';
	const output = getOption(parsed, 'output');
	const randomState = getOption(parsed, 'random-state');
	const nEstimatorsMin = getOption(parsed, 'n-estimators-min');
	const nEstimatorsMax = getOption(parsed, 'n-estimators-max');
	const maxDepthMin = getOption(parsed, 'max-depth-min');
	const maxDepthMax = getOption(parsed, 'max-depth-max');
	const minSamplesLeafMin = getOption(parsed, 'min-samples-leaf-min');
	const minSamplesLeafMax = getOption(parsed, 'min-samples-leaf-max');
	const nJobs = getOption(parsed, 'n-jobs');

	if (!existsSync(dataset)) {
		logger.error(`Dataset not found: ${datasetInput}`);
		process.exit(1);
	}

	const repoRoot = resolve(__dirname, '../../..');
	const pythonPath = resolve(repoRoot, 'venv/bin/python');
	if (!existsSync(pythonPath)) {
		logger.error('Python venv not found at venv/bin/python');
		logger.info('Run "python -m venv venv && source venv/bin/activate && pip install -r requirements.txt"');
		process.exit(1);
	}

	const scriptPath = resolve(__dirname, 'tune_hyperparameters.py');

	logger.section('Random Forest Hyperparameter Tuning');
	logger.info(`Dataset: ${datasetInput}`);
	logger.info(`Label column: ${labelColumn}`);
	logger.info(`Iterations: ${nIter}, CV folds: ${cv}, scoring: ${scoring}`);

	const optionMap: Record<string, string | undefined> = {
		dataset,
		'label-column': labelColumn,
		'n-iter': nIter,
		cv,
		scoring,
		'output': output ? resolve(process.cwd(), output) : undefined,
		'random-state': randomState,
		'n-estimators-min': nEstimatorsMin,
		'n-estimators-max': nEstimatorsMax,
		'max-depth-min': maxDepthMin,
		'max-depth-max': maxDepthMax,
		'min-samples-leaf-min': minSamplesLeafMin,
		'min-samples-leaf-max': minSamplesLeafMax,
		'n-jobs': nJobs,
	};

	const pythonArgs = [scriptPath, ...buildPythonArgs(optionMap)];

	const result = spawnSync(pythonPath, pythonArgs, {
		stdio: 'inherit',
		cwd: repoRoot,
	});

	if (result.error) {
		logger.error(`Failed to execute tuning script: ${result.error.message}`);
		process.exit(1);
	}

	if (result.status !== 0) {
		logger.error(`Hyperparameter tuning exited with code ${result.status}`);
		process.exit(result.status ?? 1);
	}

	logger.success('Hyperparameter search completed');
}
