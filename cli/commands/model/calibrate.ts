/**
 * CLI wrapper around scripts/calibrate_scores.py
 */

import { existsSync } from 'fs';
import { resolve } from 'path';
import { spawnSync } from 'child_process';

import { logger } from '../../utils/logger';
import { parseArgs, getOption } from '../../utils/args';

export default async function calibrate(rawArgs: string[]) {
	const parsed = parseArgs(rawArgs);
	const input = getOption(parsed, 'input') ?? 'data/calibration/latest.csv';
	const output = getOption(parsed, 'output') ?? 'data/calibration/calibrated.csv';
	const thresholdJson = getOption(parsed, 'threshold-output', 'threshold-json') ?? 'data/calibration/threshold-scan.json';
	const thresholdCsv = getOption(parsed, 'threshold-csv') ?? 'data/calibration/threshold-scan.csv';

	const repoRoot = process.cwd();
	const pythonPath = resolve(repoRoot, 'venv/bin/python');
	const scriptPath = resolve(repoRoot, 'scripts/calibrate_scores.py');

	if (!existsSync(pythonPath)) {
		logger.error('Python venv not found at venv/bin/python');
		logger.info('Run "python -m venv venv && source venv/bin/activate && pip install -r requirements.txt"');
		process.exit(1);
	}

	if (!existsSync(scriptPath)) {
		logger.error(`Calibration script missing: ${scriptPath}`);
		process.exit(1);
	}

	logger.section('📐 Calibrating Random Forest Scores');
	logger.info(`Input:  ${input}`);
	logger.info(`Output: ${output}`);
	logger.info(`Threshold JSON: ${thresholdJson}`);
	logger.info(`Threshold CSV:  ${thresholdCsv}`);

	const pythonArgs = [
		scriptPath,
		'--input',
		input,
		'--output',
		output,
		'--threshold-json',
		thresholdJson,
		'--threshold-csv',
		thresholdCsv,
	];

	const thresholdMin = getOption(parsed, 'threshold-min');
	if (thresholdMin) {
		pythonArgs.push('--threshold-min', thresholdMin);
	}

	const thresholdMax = getOption(parsed, 'threshold-max');
	if (thresholdMax) {
		pythonArgs.push('--threshold-max', thresholdMax);
	}

	const thresholdStep = getOption(parsed, 'threshold-step');
	if (thresholdStep) {
		pythonArgs.push('--threshold-step', thresholdStep);
	}
	const result = spawnSync(pythonPath, pythonArgs, {
		stdio: 'inherit',
	});

	if (result.status !== 0) {
		logger.error('Calibration failed. See logs above for details.');
		process.exit(result.status ?? 1);
	}

	logger.success('Calibration complete');
}
