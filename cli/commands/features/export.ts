/**
 * Feature Export Command
 *
 * Reads a labeled email dataset and emits a CSV containing the engineered
 * feature vector that the decision tree expects. Use this output as the input
 * to the offline training pipeline.
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { parseArgs, getOption, hasFlag } from '../../utils/args.ts';
import { logger } from '../../utils/logger.ts';
import { normalizeEmail, getPlusAddressingRiskScore } from '../../../src/detectors/plus-addressing';
import { detectSequentialPattern } from '../../../src/detectors/sequential';
import { analyzeTLDRisk } from '../../../src/detectors/tld-risk';
import { buildFeatureVector } from '../../../src/utils/feature-vector';
import { extractLocalPartFeatureSignals } from '../../../src/detectors/linguistic-features';
import { validateEmail } from '../../../src/validators/email';
import { validateDomain, getDomainReputationScore } from '../../../src/validators/domain';

interface DatasetRow {
	email: string;
	label: string | number;
	[key: string]: any;
}

function printHelp() {
	console.log(`
╔════════════════════════════════════════════════════════╗
║            Feature Export (Decision Tree)              ║
╚════════════════════════════════════════════════════════╝

Generate the feature matrix used to train JSON-backed decision trees.

USAGE
  npm run cli features:export -- [options]

OPTIONS
  --input <path>          Source CSV with columns: email,label (default: data/main.csv)
  --output <path>         Destination CSV for features  (default: data/features/export.csv)
  --label-column <name>   Label column name             (default: label)
  --include-email         Keep original email column in output
  --limit <n>             Only process the first n rows (for sampling)
  --help, -h              Show this help message

Input labels may be 'fraud'/'legit', 0/1, or any string convertible to numbers.
`);
}

function normalizeLabel(value: string | number): number {
	if (typeof value === 'number') {
		return value >= 0.5 ? 1 : 0;
	}

	const trimmed = value.trim().toLowerCase();
	if (trimmed === 'fraud' || trimmed === '1' || trimmed === 'true') return 1;
	if (trimmed === 'legit' || trimmed === '0' || trimmed === 'false') return 0;

	const numeric = Number(trimmed);
	if (!Number.isNaN(numeric)) {
		return numeric >= 0.5 ? 1 : 0;
	}

	return 0;
}

function computeFeatures(email: string) {
	const emailValidation = validateEmail(email);
	if (!emailValidation.valid) {
		// We still compute features because downstream training can decide how to treat them.
	}

	const normalized = normalizeEmail(email);
	const providerNormalized = normalized.providerNormalized ?? email.toLowerCase();
	const [localPartRaw, domainRaw] = providerNormalized.split('@');
	const localPart = localPartRaw || '';
	const domain = domainRaw || '';

	const sequential = detectSequentialPattern(providerNormalized);
	const plusRisk = getPlusAddressingRiskScore(email);
	const localFeatures = extractLocalPartFeatureSignals(localPart);
	const tldAnalysis = domain ? analyzeTLDRisk(domain) : undefined;
	const tldRiskScore = tldAnalysis?.riskScore ?? 0;
	const domainValidation = domain ? validateDomain(domain) : null;

	const domainReputation = domain ? getDomainReputationScore(domain) : 0;
	const featureVector = buildFeatureVector({
		sequentialConfidence: sequential.confidence,
		plusRisk,
		localPartLength: localFeatures.statistical.length,
		digitRatio: localFeatures.statistical.digitRatio,
		providerIsFree: domainValidation?.isFreeProvider,
		providerIsDisposable: domainValidation?.isDisposable,
		tldRisk: tldRiskScore,
		domainReputationScore: domainReputation,
		entropyScore: emailValidation.signals.entropyScore,
		linguistic: {
			pronounceability: localFeatures.linguistic.pronounceability,
			vowelRatio: localFeatures.linguistic.vowelRatio,
			maxConsonantCluster: localFeatures.linguistic.maxConsonantCluster,
			repeatedCharRatio: localFeatures.linguistic.repeatedCharRatio,
			syllableEstimate: localFeatures.linguistic.syllableEstimate,
			impossibleClusterCount: localFeatures.linguistic.impossibleClusterCount,
		},
		structure: {
			hasWordBoundaries: localFeatures.structure.hasWordBoundaries,
			segmentCount: localFeatures.structure.segmentCount,
			avgSegmentLength: localFeatures.structure.avgSegmentLength,
			segmentsWithoutVowelsRatio: localFeatures.structure.segmentsWithoutVowelsRatio,
		},
		statistical: {
			uniqueCharRatio: localFeatures.statistical.uniqueCharRatio,
			vowelGapRatio: localFeatures.statistical.vowelGapRatio,
			maxDigitRun: localFeatures.statistical.maxDigitRun,
		},
	});

	return featureVector;
}

export default async function exportFeatures(args: string[]) {
	const parsed = parseArgs(args);
	if (hasFlag(parsed, 'help', 'h')) {
		printHelp();
		return;
	}

	const inputPath = resolve(getOption(parsed, 'input') || 'data/main.csv');
	const outputPath = resolve(getOption(parsed, 'output') || 'data/features/export.csv');
	const labelColumn = getOption(parsed, 'label-column') || 'label';
	const limit = getOption(parsed, 'limit') ? Number(getOption(parsed, 'limit')) : undefined;
	const includeEmail = hasFlag(parsed, 'include-email');

	logger.section('✨ Exporting feature matrix');
	logger.info(`Input:  ${inputPath}`);
	logger.info(`Output: ${outputPath}`);

	const raw = readFileSync(inputPath, 'utf8');
	const rows = parse(raw, {
		columns: true,
		skip_empty_lines: true,
	}) as DatasetRow[];

	if (rows.length === 0) {
		logger.warn('No rows found in dataset.');
		return;
	}

	const processed: Record<string, any>[] = [];
	const featureKeys = new Set<string>();
	let count = 0;

	for (const row of rows) {
		if (limit !== undefined && count >= limit) break;

		const email = row.email?.trim();
		if (!email) {
			logger.warn('Skipping row without email column');
			continue;
		}

		try {
			const features = computeFeatures(email);
			Object.keys(features).forEach((key) => featureKeys.add(key));

			const record: Record<string, any> = { ...features };
			if (includeEmail) {
				record.email = email;
			}

			const labelValue = row[labelColumn];
			if (labelValue === undefined) {
				throw new Error(`Missing label column "${labelColumn}"`);
			}
			record.label = normalizeLabel(labelValue);

			processed.push(record);
			count++;
			if (count % 1000 === 0) {
				logger.info(`Processed ${count.toLocaleString()} rows...`);
			}
		} catch (error) {
			logger.warn(`Skipping ${email}: ${(error as Error).message}`);
		}
	}

	if (processed.length === 0) {
		logger.warn('No rows were processed successfully.');
		return;
	}

	const headers = [
		...(includeEmail ? ['email'] : []),
		...Array.from(featureKeys.values()).sort(),
		'label',
	];

	const csv = stringify(processed, {
		header: true,
		columns: headers,
	});

	writeFileSync(outputPath, csv, 'utf8');

	logger.success(`Exported ${processed.length.toLocaleString()} rows to ${outputPath}`);
}
