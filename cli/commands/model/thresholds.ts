/**
 * Recommend warn/block thresholds from calibration scan results.
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

import { logger } from '../../utils/logger';
import { parseArgs, getOption } from '../../utils/args';

type ThresholdMetrics = {
	threshold: number;
	tp: number;
	fp: number;
	tn: number;
	fn: number;
	precision: number;
	recall: number;
	fpr: number;
	fnr: number;
	support_positive?: number;
	support_negative?: number;
};

type ThresholdScanReport = {
	generated_at?: string;
	input?: string;
	calibration_output?: string;
	thresholds: ThresholdMetrics[];
};

type Recommendation = {
	warnThreshold: number;
	blockThreshold: number;
	warnMetrics: ThresholdMetrics;
	blockMetrics: ThresholdMetrics;
	constraints: {
		minRecall: number;
		maxFpr: number;
		maxFnr: number;
		minGap: number;
	};
	source: string;
	generatedAt: string;
};

function toPercent(value: number): string {
	return `${(value * 100).toFixed(2)}%`;
}

function parseNumber(value: string | undefined, fallback: number): number {
	if (value === undefined) return fallback;
	const parsed = Number(value);
	if (Number.isNaN(parsed)) {
		throw new Error(`Invalid numeric value: ${value}`);
	}
	return parsed;
}

function findThresholdPair(entries: ThresholdMetrics[], minGap: number) {
	for (let i = 0; i < entries.length - 1; i++) {
		const warn = entries[i];
		for (let j = i + 1; j < entries.length; j++) {
			const block = entries[j];
			if (block.threshold - warn.threshold >= minGap) {
				return { warn, block };
			}
		}
	}
	return null;
}

export default async function recommendThresholds(rawArgs: string[]) {
	const parsed = parseArgs(rawArgs);
	const inputPath = resolve(getOption(parsed, 'input') ?? 'data/calibration/threshold-scan.json');
	const outputPath = resolve(getOption(parsed, 'output') ?? 'data/calibration/threshold-recommendation.json');
	const minRecall = parseNumber(getOption(parsed, 'min-recall'), 0.95);
	const maxFpr = parseNumber(getOption(parsed, 'max-fpr'), 0.05);
	const maxFnr = parseNumber(getOption(parsed, 'max-fnr'), 0.05);
	const minGap = parseNumber(getOption(parsed, 'min-gap'), 0.01);
	const top = Math.max(1, Math.floor(parseNumber(getOption(parsed, 'top'), 5)));

	const raw = readFileSync(inputPath, 'utf-8');
	let report: ThresholdScanReport;
	try {
		report = JSON.parse(raw);
	} catch (error) {
		logger.error(`Failed to parse threshold scan: ${(error as Error).message}`);
		process.exit(1);
	}

	if (!report.thresholds || !Array.isArray(report.thresholds) || report.thresholds.length === 0) {
		logger.error('Threshold scan JSON does not contain any thresholds.');
		process.exit(1);
	}

	const sorted = report.thresholds
		.map((entry) => ({
			...entry,
			threshold: Number(entry.threshold),
		}))
		.sort((a, b) => a.threshold - b.threshold);

	const passing = sorted.filter((entry) => (
		entry.recall >= minRecall &&
		entry.fpr <= maxFpr &&
		entry.fnr <= maxFnr
	));

	if (passing.length < 2) {
		logger.error(`Only ${passing.length} thresholds satisfy the constraints (need at least 2 for warn/block pair).`);
		logger.info(`Constraints: recall ≥ ${minRecall}, FPR ≤ ${maxFpr}, FNR ≤ ${maxFnr}`);
		logger.info('Consider relaxing the constraints or re-running calibration with more data.');
		process.exit(1);
	}

	const pair = findThresholdPair(passing, minGap);
	if (!pair) {
		logger.error(`No threshold pair satisfies min gap of ${minGap}.`);
		process.exit(1);
	}

	const warnThreshold = Number(pair.warn.threshold.toFixed(4));
	const blockThreshold = Number(pair.block.threshold.toFixed(4));

	const recommendation: Recommendation = {
		warnThreshold,
		blockThreshold,
		warnMetrics: pair.warn,
		blockMetrics: pair.block,
		constraints: {
			minRecall,
			maxFpr,
			maxFnr,
			minGap,
		},
		source: inputPath,
		generatedAt: new Date().toISOString(),
	};

	writeFileSync(outputPath, JSON.stringify(recommendation, null, 2));

	logger.section('📊 Threshold Recommendation');
	logger.info(`Source: ${inputPath}`);
	logger.info(`Output: ${outputPath}`);
	logger.info(`Constraints: recall ≥ ${minRecall}, FPR ≤ ${maxFpr}, FNR ≤ ${maxFnr}, gap ≥ ${minGap}`);
	logger.info(`Warn threshold:  ${warnThreshold} (recall ${toPercent(pair.warn.recall)}, FPR ${toPercent(pair.warn.fpr)})`);
	logger.info(`Block threshold: ${blockThreshold} (recall ${toPercent(pair.block.recall)}, FPR ${toPercent(pair.block.fpr)})`);

	const tableRows = passing.slice(0, top).map((entry) => ({
		threshold: entry.threshold.toFixed(3),
		recall: toPercent(entry.recall),
		fpr: toPercent(entry.fpr),
		fnr: toPercent(entry.fnr),
		precision: toPercent(entry.precision),
	}));
	logger.subsection(`Top ${Math.min(top, passing.length)} thresholds meeting constraints`);
	logger.table(tableRows);

	logger.success('Threshold recommendation saved. Run "npm run cli -- config:update-thresholds" to apply.');
}
