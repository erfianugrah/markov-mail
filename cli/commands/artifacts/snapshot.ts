import { mkdirSync, existsSync, copyFileSync } from 'fs';
import { resolve, join } from 'path';

import { logger } from '../../utils/logger';
import { parseArgs, getOption } from '../../utils/args';

type Artifact = {
	label: string;
	filename: string;
	defaultPath: string;
	required?: boolean;
	optionKeys?: string[];
};

const ARTIFACTS: Artifact[] = [
	{
		label: 'calibrated_scores',
		filename: 'calibrated.guardrail.csv',
		defaultPath: 'data/calibration/calibrated.guardrail.csv',
		optionKeys: ['calibrated', 'calibrated-output'],
	},
	{
		label: 'threshold_scan_json',
		filename: 'threshold-scan.json',
		defaultPath: 'data/calibration/threshold-scan.json',
		required: true,
		optionKeys: ['scan-json', 'scan'],
	},
	{
		label: 'threshold_scan_csv',
		filename: 'threshold-scan.csv',
		defaultPath: 'data/calibration/threshold-scan.csv',
		optionKeys: ['scan-csv'],
	},
	{
		label: 'threshold_recommendation',
		filename: 'threshold-recommendation.json',
		defaultPath: 'data/calibration/threshold-recommendation.json',
		required: true,
		optionKeys: ['recommendation'],
	},
];

function resolveArtifactPath(parsed: ReturnType<typeof parseArgs>, artifact: Artifact): string {
	if (artifact.optionKeys) {
		for (const key of artifact.optionKeys) {
			const value = getOption(parsed, key);
			if (value) {
				return resolve(value);
			}
		}
	}
	return resolve(artifact.defaultPath);
}

export default async function snapshotArtifacts(rawArgs: string[]) {
	const parsed = parseArgs(rawArgs);
	const timestamp = new Date().toISOString().replace(/[:T]/g, '-').split('.')[0];
	const outputDir = resolve(getOption(parsed, 'output', 'out') ?? join('tmp', 'threshold-artifacts', timestamp));

	mkdirSync(outputDir, { recursive: true });
	logger.section('📦 Threshold Artifact Snapshot');
	logger.info(`Output: ${outputDir}`);

	const copied: string[] = [];
	const missing: string[] = [];

	for (const artifact of ARTIFACTS) {
		const sourcePath = resolveArtifactPath(parsed, artifact);
		const destination = join(outputDir, artifact.filename);

		if (!existsSync(sourcePath)) {
			const message = `${artifact.label} missing at ${sourcePath}`;
			if (artifact.required) {
				logger.error(`❌ ${message}`);
			} else {
				logger.warn(`⚠️  ${message} (skipping optional artifact)`);
			}
			missing.push(artifact.label);
			continue;
		}

		copyFileSync(sourcePath, destination);
		logger.info(`✅ Copied ${artifact.label} → ${destination}`);
		copied.push(artifact.label);
	}

	logger.section('📊 Summary');
	logger.info(`Copied: ${copied.length ? copied.join(', ') : 'none'}`);
	if (missing.length) {
		logger.warn(`Missing: ${missing.join(', ')}`);
	}

	logger.success('Snapshot complete');
}
