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
import { computeIdentitySignals } from '../../../src/utils/identity-signals';
import { computeGeoSignals } from '../../../src/utils/geo-signals';
import { resolveMXRecords, type MXAnalysis } from '../../../src/services/mx-resolver';
import { getWellKnownMX, isWellKnownProvider } from '../../utils/known-mx-providers';
import { analyzeNGramNaturalness, getNGramRiskScore } from '../../../src/detectors/ngram-analysis';

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
  --name-column <name>    Column containing display name (default: name)
  --country-column <name> Column containing IP country   (default: ip_country)
  --language-column <name>Column containing Accept-Language (default: accept_language)
  --timezone-column <name>Column containing client timezone (default: timezone)
   --skip-mx               Skip DNS MX lookups (faster, but omits MX features)
   --include-email         Keep original email column in output
   --limit <n>             Only process the first n rows (for sampling)
   --shuffle               Shuffle rows before processing (important when --limit is used)
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

interface ColumnHints {
	nameColumn: string;
	countryColumn: string;
	languageColumn: string;
	timezoneColumn: string;
}

interface FeatureOptions {
	skipMX: boolean;
	mxCache: Map<string, Promise<MXAnalysis>>;
}

async function computeFeatures(email: string, row: DatasetRow, columns: ColumnHints, options: FeatureOptions) {
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
	const ngramAnalysis = analyzeNGramNaturalness(localPart);
	const ngramRiskScore = getNGramRiskScore(localPart);
	const tldAnalysis = domain ? analyzeTLDRisk(domain) : undefined;
	const tldRiskScore = tldAnalysis?.riskScore ?? 0;
	const domainValidation = domain ? validateDomain(domain) : null;

	const domainReputation = domain ? getDomainReputationScore(domain) : 0;
	const nameValue = columns.nameColumn && row[columns.nameColumn] ? String(row[columns.nameColumn]) : undefined;
	const countryValue = columns.countryColumn && row[columns.countryColumn] ? String(row[columns.countryColumn]) : undefined;
	const languageValue = columns.languageColumn && row[columns.languageColumn] ? String(row[columns.languageColumn]) : undefined;
	const timezoneValue = columns.timezoneColumn && row[columns.timezoneColumn] ? String(row[columns.timezoneColumn]) : undefined;
	const identitySignals = computeIdentitySignals(nameValue, localPart);
	const geoSignals = computeGeoSignals({
		ipCountry: countryValue,
		acceptLanguage: languageValue,
		clientTimezone: timezoneValue,
		edgeTimezone: timezoneValue,
	});
	let mxAnalysis: MXAnalysis | null = null;
	if (!options.skipMX && domain) {
		const cacheKey = domain.toLowerCase();
		if (!options.mxCache.has(cacheKey)) {
			options.mxCache.set(cacheKey, resolveMXRecords(cacheKey));
		}
		try {
			mxAnalysis = await options.mxCache.get(cacheKey)!;
		} catch {
			mxAnalysis = null;
		}
	}
	const featureVector = buildFeatureVector({
		sequentialConfidence: sequential.confidence,
		plusRisk,
		localPartLength: localFeatures.statistical.length,
		digitRatio: localFeatures.statistical.digitRatio,
		nameSimilarityScore: identitySignals.similarityScore,
		nameTokenOverlap: identitySignals.tokenOverlap,
		nameInEmail: identitySignals.nameInEmail,
		geoLanguageMismatch: geoSignals.languageMismatch,
		geoTimezoneMismatch: geoSignals.timezoneMismatch,
		geoAnomalyScore: geoSignals.anomalyScore,
		mxHasRecords: mxAnalysis?.hasRecords,
		mxRecordCount: mxAnalysis?.recordCount,
		mxProviderGoogle: mxAnalysis ? mxAnalysis.providerHits.google > 0 : false,
		mxProviderMicrosoft: mxAnalysis ? mxAnalysis.providerHits.microsoft > 0 : false,
		mxProviderIcloud: mxAnalysis ? mxAnalysis.providerHits.icloud > 0 : false,
		mxProviderYahoo: mxAnalysis ? mxAnalysis.providerHits.yahoo > 0 : false,
		mxProviderZoho: mxAnalysis ? mxAnalysis.providerHits.zoho > 0 : false,
		mxProviderProton: mxAnalysis ? mxAnalysis.providerHits.proton > 0 : false,
		mxProviderSelfHosted: mxAnalysis ? mxAnalysis.providerHits.self_hosted > 0 : false,
		mxProviderOther: mxAnalysis ? mxAnalysis.providerHits.other > 0 : false,
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
			bigramEntropy: localFeatures.statistical.bigramEntropy,
		},
		ngram: {
			bigramScore: ngramAnalysis.bigramScore,
			trigramScore: ngramAnalysis.trigramScore,
			overallScore: ngramAnalysis.overallScore,
			confidence: ngramAnalysis.confidence,
			riskScore: ngramRiskScore,
			isNatural: ngramAnalysis.isNatural,
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
	const nameColumn = getOption(parsed, 'name-column') || 'name';
	const countryColumn = getOption(parsed, 'country-column') || 'ip_country';
	const languageColumn = getOption(parsed, 'language-column') || 'accept_language';
	const timezoneColumn = getOption(parsed, 'timezone-column') || 'timezone';
	const limit = getOption(parsed, 'limit') ? Number(getOption(parsed, 'limit')) : undefined;
	const includeEmail = hasFlag(parsed, 'include-email');
	const skipMX = hasFlag(parsed, 'skip-mx');
	const shuffle = hasFlag(parsed, 'shuffle');
	const columnHints: ColumnHints = { nameColumn, countryColumn, languageColumn, timezoneColumn };
	const mxCache = new Map<string, Promise<MXAnalysis>>();

	logger.section('✨ Exporting feature matrix');
	logger.info(`Input:  ${inputPath}`);
	logger.info(`Output: ${outputPath}`);

	const raw = readFileSync(inputPath, 'utf8');
	let rows = parse(raw, {
		columns: true,
		skip_empty_lines: true,
	}) as DatasetRow[];

	// H4: Shuffle rows before processing so --limit produces a representative sample
	if (shuffle) {
		logger.info(`Shuffling ${rows.length.toLocaleString()} rows (Fisher-Yates)...`);
		for (let i = rows.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[rows[i], rows[j]] = [rows[j], rows[i]];
		}
	}

	if (rows.length === 0) {
		logger.warn('No rows found in dataset.');
		return;
	}

	// Optimization: Pre-fetch all MX records if not skipping
	if (!skipMX) {
		logger.info('Pre-fetching MX records for unique domains...');
		const uniqueDomains = new Set<string>();
		for (const row of rows) {
			const email = row.email?.trim();
			if (email && email.includes('@')) {
				const domain = email.split('@')[1]?.toLowerCase();
				if (domain) uniqueDomains.add(domain);
			}
		}
		logger.info(`Found ${uniqueDomains.size.toLocaleString()} unique domains`);

		// Pre-populate cache with optimized parallel MX lookups
		const domains = Array.from(uniqueDomains);
		const concurrencyLimit = 500; // Increased from 100 for 5x speedup
		let wellKnownHits = 0;
		let dnsQueries = 0;
		let completed = 0;

		// Create a simple concurrency limiter
		const runWithConcurrency = async (tasks: (() => Promise<any>)[], limit: number) => {
			const results: any[] = [];
			const executing: Promise<any>[] = [];

			for (const task of tasks) {
				const promise = task().then(result => {
					executing.splice(executing.indexOf(promise), 1);
					return result;
				});
				results.push(promise);
				executing.push(promise);

				if (executing.length >= limit) {
					await Promise.race(executing);
				}
			}

			return Promise.allSettled(results);
		};

		// Create tasks for all domains
		const tasks = domains.map(domain => async () => {
			if (!mxCache.has(domain)) {
				// Check well-known providers first (instant lookup)
				const wellKnown = getWellKnownMX(domain);
				if (wellKnown) {
					mxCache.set(domain, Promise.resolve(wellKnown));
					wellKnownHits++;
				} else {
					// Fallback to DNS lookup
					mxCache.set(domain, resolveMXRecords(domain));
					dnsQueries++;
				}
			}

			// Progress logging
			completed++;
			if (completed % 1000 === 0 || completed === domains.length) {
				logger.info(`Fetched MX for ${completed.toLocaleString()}/${domains.length.toLocaleString()} domains (${wellKnownHits} cached, ${dnsQueries} DNS)...`);
			}

			return mxCache.get(domain)!;
		});

		await runWithConcurrency(tasks, concurrencyLimit);

		logger.info(`✓ MX pre-fetch complete: ${wellKnownHits} from cache (${((wellKnownHits/domains.length)*100).toFixed(1)}%), ${dnsQueries} DNS queries`);
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
			const features = await computeFeatures(email, row, columnHints, { skipMX, mxCache });
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

	// Log expected vs actual row counts for sanity checking (C2 prevention)
	const inputRowCount = rows.length;
	const outputRowCount = processed.length;
	const skippedCount = inputRowCount - outputRowCount;
	if (limit !== undefined) {
		logger.info(`Input: ${inputRowCount.toLocaleString()} rows, limit: ${limit.toLocaleString()}, output: ${outputRowCount.toLocaleString()} rows`);
	} else if (skippedCount > 0) {
		logger.warn(`Skipped ${skippedCount.toLocaleString()} rows (${inputRowCount.toLocaleString()} input → ${outputRowCount.toLocaleString()} output)`);
	}
	logger.success(`Exported ${outputRowCount.toLocaleString()} rows to ${outputPath}`);
}
