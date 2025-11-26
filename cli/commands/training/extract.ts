/**
 * Training Data Extraction Command
 *
 * Extracts validation results from the D1 validations table and applies
 * heuristic labeling to create training datasets.
 */

import { parseArgs } from 'util';
import { execSync } from 'child_process';
import type { ValidationRecord, TrainingDataset, TrainingSample } from '../../../src/training/types';
import { batchLabel, validateDatasetQuality } from '../../../src/training/heuristic-labeling';

export async function extractTrainingData(args: string[]) {
	// Parse arguments
	const { values } = parseArgs({
		args,
		options: {
			days: { type: 'string', default: '1' },
			'min-confidence': { type: 'string', default: '0.8' },
			'min-samples': { type: 'string', default: '100' },
			remote: { type: 'boolean', default: false },
			help: { type: 'boolean', short: 'h' },
		},
		allowPositionals: true,
	});

	if (values.help) {
		console.log(`
╔════════════════════════════════════════════════════════╗
║        Extract Training Data from D1                   ║
╚════════════════════════════════════════════════════════╝

[OPTIONAL] Manual extraction for offline analysis and testing.
Automated training fetches directly from D1.

Extracts validation results from D1 and applies
heuristic labeling to create training datasets saved as JSON files.

USAGE
  npm run cli training:extract [options]

OPTIONS
  --days <n>              Days of data to extract (default: 1)
  --min-confidence <n>    Minimum confidence threshold (default: 0.8)
  --min-samples <n>       Minimum samples per class (default: 100)
  --remote                Use remote D1 database (production)
  --help, -h              Show this help message

EXAMPLES
  # Extract last 24 hours with defaults
  npm run cli training:extract

  # Extract last 7 days with 90% confidence threshold
  npm run cli training:extract --days 7 --min-confidence 0.9

  # Extract from production
  npm run cli training:extract --days 1 --remote
`);
		return;
	}

	const options = {
		days: parseInt(values.days as string, 10),
		minConfidence: parseFloat(values['min-confidence'] as string),
		minSamples: parseInt(values['min-samples'] as string, 10),
		remote: values.remote,
	};

	console.log('\\n🔍 Extracting Training Data from D1');
	console.log('═'.repeat(80));
	console.log(`Days:            ${options.days}`);
	console.log(`Min Confidence:  ${options.minConfidence}`);
	console.log(`Min Samples:     ${options.minSamples} per class`);
	console.log(`Remote:          ${options.remote ? 'Yes (production)' : 'No (local)'}`);
	console.log('═'.repeat(80));

	try {
		const startTime = Date.now();

		// Step 1: Query D1
		console.log('\\n📊 Step 1: Querying D1 validations table...');
		const records = await queryD1(options.days, options.remote);

		console.log(`✓ Retrieved ${records.length.toLocaleString()} validation records`);

		if (records.length === 0) {
			console.log('\\n⚠️  No data found. Make sure the D1 database has validation traffic.');
			return;
		}

		// Step 2: Apply heuristic labeling
		console.log('\\n🏷️  Step 2: Applying heuristic labeling...');
		const labeled = batchLabel(records, options.minConfidence);

		console.log(`✓ Labeled: ${labeled.stats.legit} legit + ${labeled.stats.fraud} fraud`);
		console.log(`  Ambiguous: ${labeled.stats.ambiguous} (${((labeled.stats.ambiguous / labeled.stats.total) * 100).toFixed(1)}%)`);

		// Step 3: Validate dataset quality
		console.log('\\n✅ Step 3: Validating dataset quality...');
		const quality = validateDatasetQuality(
			labeled.legit,
			labeled.fraud,
			options.minSamples
		);

		if (!quality.valid) {
			console.log('\\n⚠️  Quality issues detected:');
			quality.issues.forEach(issue => console.log(`  - ${issue}`));
			console.log('\\n💡 Consider:');
			console.log('  - Increasing --days to collect more data');
			console.log('  - Lowering --min-confidence to include more samples');
			console.log('  - Lowering --min-samples threshold');
			return;
		}

		console.log('✓ Dataset quality validated');

		// Step 4: Convert to training samples
		console.log('\\n📦 Step 4: Creating training dataset...');
		const trainingSamples = convertToTrainingSamples(labeled.legit, labeled.fraud);

		// Calculate stats
		const avgLegitConfidence =
			trainingSamples.legit.reduce((sum, s) => sum + s.confidence, 0) /
			trainingSamples.legit.length;

		const avgFraudConfidence =
			trainingSamples.fraud.reduce((sum, s) => sum + s.confidence, 0) /
			trainingSamples.fraud.length;

		const extractionDuration = Date.now() - startTime;

		const dataset: TrainingDataset = {
			date: new Date().toISOString().split('T')[0],
			version: '1.0',
			source: 'production_analytics',
			samples: trainingSamples,
			stats: {
				totalLegit: trainingSamples.legit.length,
				totalFraud: trainingSamples.fraud.length,
				avgLegitConfidence,
				avgFraudConfidence,
				ambiguousCount: labeled.stats.ambiguous,
				extractionDuration,
			},
			config: {
				minConfidence: options.minConfidence,
				daysExtracted: options.days,
				filters: ['high_confidence_only'],
			},
		};

		// Step 5: Save dataset as JSON
		console.log('\\n💾 Step 5: Saving dataset to JSON file...');
		await saveToJSON(dataset);

		// Summary
		console.log('\\n✅ Training Data Extraction Complete!');
		console.log('═'.repeat(80));
		console.log(`Date:                ${dataset.date}`);
		console.log(`Legitimate samples:  ${dataset.stats.totalLegit.toLocaleString()}`);
		console.log(`Fraudulent samples:  ${dataset.stats.totalFraud.toLocaleString()}`);
		console.log(`Total samples:       ${(dataset.stats.totalLegit + dataset.stats.totalFraud).toLocaleString()}`);
		console.log(`Avg legit confidence: ${(avgLegitConfidence * 100).toFixed(1)}%`);
		console.log(`Avg fraud confidence: ${(avgFraudConfidence * 100).toFixed(1)}%`);
		console.log(`Extraction time:     ${(extractionDuration / 1000).toFixed(1)}s`);
		console.log('═'.repeat(80));

		console.log('\\n📝 Next steps:');
		console.log('  1. Review extracted data quality');
		console.log('  2. Train models: npm run cli training:train');
		console.log('  3. Validate new models: npm run cli training:validate');
	} catch (error) {
		console.error('\\n❌ Failed to extract training data:');
		console.error(error);
		process.exit(1);
	}
}

/**
 * Query D1 for validation records
 */
async function queryD1(days: number, remote: boolean): Promise<ValidationRecord[]> {
	const hours = days * 24;
	const sql = `
		SELECT
			email_local_part || '@' || domain AS email,
			decision,
			risk_score,
			COALESCE(markov_confidence, risk_score) AS confidence,
			pattern_family,
			CASE
				WHEN entropy_score IS NULL THEN 'unknown'
				WHEN entropy_score < 0.2 THEN 'very_low'
				WHEN entropy_score < 0.4 THEN 'low'
				WHEN entropy_score < 0.6 THEN 'medium'
				WHEN entropy_score < 0.8 THEN 'high'
				ELSE 'very_high'
			END AS entropy_category,
			markov_detected,
			COALESCE(markov_confidence, 0) AS markov_confidence,
			COALESCE(bot_score, 0) AS bot_score,
			timestamp
		FROM validations
		WHERE timestamp >= datetime('now', '-${hours} hours')
			AND email_local_part IS NOT NULL
			AND domain IS NOT NULL
		ORDER BY timestamp DESC
		LIMIT 100000
	`.trim();

	console.log('  Executing query...');

	const escapedSql = sql.replace(/"/g, '\\"');
	const remoteFlag = remote ? '--remote' : '';
	const command = `npx wrangler d1 execute ANALYTICS ${remoteFlag} --json --command "${escapedSql}"`;
	const output = execSync(command, { encoding: 'utf-8' });

	let parsed: any;
	try {
		parsed = JSON.parse(output);
	} catch (error) {
		throw new Error(`Failed to parse D1 output: ${output}`);
	}

	const rows: any[] = parsed?.results || parsed?.result || parsed?.data || [];
	if (!Array.isArray(rows)) {
		throw new Error('Unexpected D1 response format');
	}

	return rows.map((row) => ({
		email: row.email,
		decision: row.decision,
		riskScore: Number(row.risk_score) || 0,
		confidence: Number(row.confidence) || 0,
		patternFamily: row.pattern_family,
		entropyCategory: row.entropy_category || 'unknown',
		markovDetected: Boolean(row.markov_detected),
		markovConfidence: Number(row.markov_confidence) || 0,
		botScore: Number(row.bot_score) || 0,
		timestamp: row.timestamp,
	}));
}

/**
 * Convert labeled records to training samples
 */
function convertToTrainingSamples(
	legitRecords: ValidationRecord[],
	fraudRecords: ValidationRecord[]
): { legit: TrainingSample[]; fraud: TrainingSample[] } {
	const legit: TrainingSample[] = legitRecords.map(record => {
		const [localPart] = record.email.split('@');
		return {
			email: record.email,
			localPart,
			label: 'legit' as const,
			confidence: 1 - record.riskScore, // Low risk = high legit confidence
			source: 'heuristic' as const,
			signals: {
				decision: record.decision,
				riskScore: record.riskScore,
				markovDetected: record.markovDetected,
				markovConfidence: record.markovConfidence,
				patternFamily: record.patternFamily,
			},
			timestamp: record.timestamp,
		};
	});

	const fraud: TrainingSample[] = fraudRecords.map(record => {
		const [localPart] = record.email.split('@');
		return {
			email: record.email,
			localPart,
			label: 'fraud' as const,
			confidence: record.riskScore, // High risk = high fraud confidence
			source: 'heuristic' as const,
			signals: {
				decision: record.decision,
				riskScore: record.riskScore,
				markovDetected: record.markovDetected,
				markovConfidence: record.markovConfidence,
				patternFamily: record.patternFamily,
			},
			timestamp: record.timestamp,
		};
	});

	return { legit, fraud };
}

/**
 * Save dataset to JSON file
 */
async function saveToJSON(dataset: TrainingDataset) {
	const filename = `training_data_${dataset.date}.json`;
	await Bun.write(filename, JSON.stringify(dataset, null, 2));
	console.log(`✓ Saved to file: ${filename}`);
}

// Export for CLI integration
export default extractTrainingData;
