/**
 * Guardrail command: run calibration + threshold recommendation + verification.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

import { logger } from '../../utils/logger';
import { parseArgs, getOption, hasFlag } from '../../utils/args';

import calibrateCommand from './calibrate';
import thresholdsCommand from './thresholds';

export class GuardrailError extends Error {
	details?: Record<string, unknown>;
	constructor(message: string, details?: Record<string, unknown>) {
		super(message);
		this.name = 'GuardrailError';
		this.details = details;
	}
}

type ThresholdEntry = {
	threshold: number;
	recall: number;
	fpr: number;
	fnr: number;
};

type ThresholdScan = {
	thresholds: ThresholdEntry[];
};

export type GuardrailRecommendation = {
	warnThreshold: number;
	blockThreshold: number;
	constraints?: {
		minRecall?: number;
		maxFpr?: number;
		maxFnr?: number;
		minGap?: number;
	};
};

function loadJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, 'utf-8'));
}

function findThresholdEntry(list: ThresholdEntry[], value: number): ThresholdEntry | undefined {
	return list.find((entry) => Math.abs(entry.threshold - value) < 0.0001);
}

export default async function guardrail(rawArgs: string[]): Promise<GuardrailRecommendation> {
	const parsed = parseArgs(rawArgs);

	const skipCalibrate = hasFlag(parsed, 'skip-calibrate');
	const skipThresholds = hasFlag(parsed, 'skip-thresholds');

	const calibrationInput = resolve(getOption(parsed, 'calibration-input', 'input') ?? 'data/calibration/latest.csv');
	const calibratedOutput = resolve(getOption(parsed, 'calibrated-output', 'output') ?? 'data/calibration/calibrated.guardrail.csv');
	const scanJson = resolve(getOption(parsed, 'scan', 'threshold-output', 'threshold-json') ?? 'data/calibration/threshold-scan.json');
	const scanCsv = resolve(getOption(parsed, 'scan-csv', 'threshold-csv') ?? 'data/calibration/threshold-scan.csv');
	const recommendationPath = resolve(getOption(parsed, 'recommendation', 'threshold-recommendation') ?? 'data/calibration/threshold-recommendation.json');

	const minRecall = getOption(parsed, 'min-recall');
	const maxFpr = getOption(parsed, 'max-fpr');
	const maxFnr = getOption(parsed, 'max-fnr');
	const minGap = getOption(parsed, 'min-gap');
	const thresholdMin = getOption(parsed, 'threshold-min');
	const thresholdMax = getOption(parsed, 'threshold-max');
	const thresholdStep = getOption(parsed, 'threshold-step');

	if (!skipCalibrate) {
		logger.section('1️⃣ Running calibration');
		const calibrateArgs = [
			'--input', calibrationInput,
			'--output', calibratedOutput,
			'--threshold-json', scanJson,
			'--threshold-csv', scanCsv,
		];
		if (thresholdMin) {
			calibrateArgs.push('--threshold-min', thresholdMin);
		}
		if (thresholdMax) {
			calibrateArgs.push('--threshold-max', thresholdMax);
		}
		if (thresholdStep) {
			calibrateArgs.push('--threshold-step', thresholdStep);
		}
		await calibrateCommand(calibrateArgs);
	} else {
		logger.info('Skipping calibration step (scan assumed present).');
	}

	if (!skipThresholds) {
		logger.section('2️⃣ Generating threshold recommendation');
		const thresholdArgs = [
			'--input', scanJson,
			'--output', recommendationPath,
		];
		if (minRecall) thresholdArgs.push('--min-recall', minRecall);
		if (maxFpr) thresholdArgs.push('--max-fpr', maxFpr);
		if (maxFnr) thresholdArgs.push('--max-fnr', maxFnr);
		if (minGap) thresholdArgs.push('--min-gap', minGap);
		await thresholdsCommand(thresholdArgs);
	} else {
		logger.info('Skipping threshold recommendation step (recommendation file assumed present).');
	}

	logger.section('3️⃣ Verifying guardrail constraints');

	const scan: ThresholdScan = loadJson(scanJson);
	const recommendation: GuardrailRecommendation = loadJson(recommendationPath);

	if (!scan.thresholds || scan.thresholds.length === 0) {
		throw new GuardrailError('Threshold scan file is empty.');
	}

	if (typeof recommendation.warnThreshold !== 'number' || typeof recommendation.blockThreshold !== 'number') {
		throw new GuardrailError('Recommendation file does not contain warn/block thresholds.');
	}

	const warnEntry = findThresholdEntry(scan.thresholds, recommendation.warnThreshold);
	const blockEntry = findThresholdEntry(scan.thresholds, recommendation.blockThreshold);

	if (!warnEntry || !blockEntry) {
		throw new GuardrailError('Unable to find warn/block metrics inside the threshold scan.');
	}

	const minRecallValue = recommendation.constraints?.minRecall ?? (minRecall ? Number(minRecall) : 0.95);
	const maxFprValue = recommendation.constraints?.maxFpr ?? (maxFpr ? Number(maxFpr) : 0.05);
	const maxFnrValue = recommendation.constraints?.maxFnr ?? (maxFnr ? Number(maxFnr) : 0.05);

	const warnPass = warnEntry.recall >= minRecallValue && warnEntry.fpr <= maxFprValue && warnEntry.fnr <= maxFnrValue;
	const blockPass = blockEntry.recall >= minRecallValue && blockEntry.fpr <= maxFprValue && blockEntry.fnr <= maxFnrValue;
	const gap = recommendation.blockThreshold - recommendation.warnThreshold;
	const minGapValue = recommendation.constraints?.minGap ?? (minGap ? Number(minGap) : 0.01);
	const gapPass = gap >= minGapValue;

	if (!warnPass || !blockPass || !gapPass) {
		logger.table([
			{
				role: 'warn',
				threshold: recommendation.warnThreshold.toFixed(3),
				recall: warnEntry.recall.toFixed(4),
				fpr: warnEntry.fpr.toFixed(4),
				fnr: warnEntry.fnr.toFixed(4),
				status: warnPass ? 'pass' : 'fail',
			},
			{
				role: 'block',
				threshold: recommendation.blockThreshold.toFixed(3),
				recall: blockEntry.recall.toFixed(4),
				fpr: blockEntry.fpr.toFixed(4),
				fnr: blockEntry.fnr.toFixed(4),
				status: blockPass ? 'pass' : 'fail',
			},
		]);
		throw new GuardrailError('Guardrail verification failed.', {
			warnPass,
			blockPass,
			gapPass,
			minRecall: minRecallValue,
			maxFpr: maxFprValue,
			maxFnr: maxFnrValue,
			minGap: minGapValue,
			currentGap: gap,
		});
	}

	logger.success('Guardrail verification passed. Thresholds satisfy the configured constraints.');
	logger.table([
		{
			role: 'warn',
			threshold: recommendation.warnThreshold.toFixed(3),
			recall: warnEntry.recall.toFixed(4),
			fpr: warnEntry.fpr.toFixed(4),
			fnr: warnEntry.fnr.toFixed(4),
		},
		{
			role: 'block',
			threshold: recommendation.blockThreshold.toFixed(3),
			recall: blockEntry.recall.toFixed(4),
			fpr: blockEntry.fpr.toFixed(4),
			fnr: blockEntry.fnr.toFixed(4),
		},
	]);

	logger.info('Ready to run config:update-thresholds if desired.');
	return recommendation;
}
