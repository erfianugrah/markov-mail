/**
 * Update config thresholds in both production JSON and DEFAULT_CONFIG.
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

import { logger } from '../../utils/logger';
import { parseArgs, getOption, hasFlag } from '../../utils/args';

type ThresholdRecommendation = {
	warnThreshold?: number;
	blockThreshold?: number;
	warn?: number;
	block?: number;
};

function parseThreshold(value: string | undefined, label: string): number | undefined {
	if (value === undefined) return undefined;
	const parsed = Number(value);
	if (Number.isNaN(parsed)) {
		throw new Error(`Invalid ${label} threshold: ${value}`);
	}
	return parsed;
}

function formatThreshold(value: number): string {
	return Number(value.toFixed(4)).toString();
}

function updateConfigJson(filePath: string, warn: number, block: number) {
	const content = readFileSync(filePath, 'utf-8');
	const json = JSON.parse(content);
	json.riskThresholds = json.riskThresholds || {};
	json.riskThresholds.warn = warn;
	json.riskThresholds.block = block;
	writeFileSync(filePath, `${JSON.stringify(json, null, 2)}\n`);
}

function updateDefaultsTs(filePath: string, warn: number, block: number) {
	let content = readFileSync(filePath, 'utf-8');
	const blockPattern = /(riskThresholds:\s*\{\s*\n[^\S\r\n]*block:\s*)([0-9.]+)/;
	const warnPattern = /(riskThresholds:\s*\{\s*\n[^\S\r\n]*block:\s*[0-9.]+\s*,\s*\n[^\S\r\n]*warn:\s*)([0-9.]+)/;

	if (!blockPattern.test(content) || !warnPattern.test(content)) {
		throw new Error('Unable to locate riskThresholds in src/config/defaults.ts');
	}

	content = content
		.replace(blockPattern, (_, prefix) => `${prefix}${formatThreshold(block)}`)
		.replace(warnPattern, (_, prefix) => `${prefix}${formatThreshold(warn)}`);

	writeFileSync(filePath, content);
}

function updateChangelog(filePath: string, warn: number, block: number) {
	const date = new Date().toISOString().slice(0, 10);
	const entry = `- Updated risk thresholds to warn=${formatThreshold(warn)}, block=${formatThreshold(block)} on ${date} via config:update-thresholds.`;
	const lines = readFileSync(filePath, 'utf-8').split('\n');
	const sectionIndex = lines.findIndex((line) => line.trim() === '### Model Pipeline');

	if (sectionIndex === -1) {
		throw new Error('Unable to locate "### Model Pipeline" section in CHANGELOG.md');
	}

	lines.splice(sectionIndex + 1, 0, entry);
	writeFileSync(filePath, `${lines.join('\n')}\n`);
}

export default async function updateThresholds(rawArgs: string[]) {
	const parsed = parseArgs(rawArgs);
	const warnOption = parseThreshold(getOption(parsed, 'warn'), 'warn');
	const blockOption = parseThreshold(getOption(parsed, 'block'), 'block');
	const recommendationPath = getOption(parsed, 'input', 'source', 'recommendation') ?? 'data/calibration/threshold-recommendation.json';
	const productionConfigPath = resolve(getOption(parsed, 'config') ?? 'config/production/config.json');
	const defaultsPath = resolve(getOption(parsed, 'defaults') ?? 'src/config/defaults.ts');
	const changelogPath = resolve(getOption(parsed, 'changelog') ?? 'CHANGELOG.md');
	const dryRun = hasFlag(parsed, 'dry-run');

	let warn = warnOption;
	let block = blockOption;

	if (warn === undefined || block === undefined) {
		const recommendationFile = resolve(recommendationPath);
		let payload: ThresholdRecommendation;
		try {
			payload = JSON.parse(readFileSync(recommendationFile, 'utf-8'));
		} catch (error) {
			logger.error(`Failed to read recommendation file (${recommendationFile}): ${(error as Error).message}`);
			process.exit(1);
		}

		warn = warn ?? payload.warnThreshold ?? payload.warn;
		block = block ?? payload.blockThreshold ?? payload.block;

		if (warn === undefined || block === undefined) {
			logger.error('Recommendation file does not contain warn/block thresholds. Provide --warn and --block.');
			process.exit(1);
		}

		logger.info(`Loaded thresholds from ${recommendationFile}`);
	}

	if (warn <= 0 || warn >= 1 || block <= 0 || block >= 1) {
		logger.error('Warn/block thresholds must be between 0 and 1.');
		process.exit(1);
	}

	if (warn >= block) {
		logger.error(`Warn threshold (${warn}) must be less than block threshold (${block}).`);
		process.exit(1);
	}

	if (dryRun) {
		logger.info(`[dry-run] Would update ${productionConfigPath}`);
		logger.info(`[dry-run] Would update ${defaultsPath}`);
		logger.info(`[dry-run] Would append changelog entry to ${changelogPath}`);
	} else {
		updateConfigJson(productionConfigPath, warn, block);
		logger.success(`Updated ${productionConfigPath}`);

		updateDefaultsTs(defaultsPath, warn, block);
		logger.success(`Updated ${defaultsPath}`);

		updateChangelog(changelogPath, warn, block);
		logger.success(`Logged change in ${changelogPath}`);
	}

	logger.section('✅ Thresholds Updated');
	logger.info(`Warn:  ${formatThreshold(warn)}`);
	logger.info(`Block: ${formatThreshold(block)}`);
}
