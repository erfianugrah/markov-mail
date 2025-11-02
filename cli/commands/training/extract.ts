/**
 * Training Data Extraction Command
 *
 * Extracts validation results from Analytics Engine and applies
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
			output: { type: 'string', default: 'kv' }, // 'kv' or 'json'
			remote: { type: 'boolean', default: false },
			help: { type: 'boolean', short: 'h' },
		},
		allowPositionals: true,
	});

	if (values.help) {
		console.log(`
╔════════════════════════════════════════════════════════╗
║        Extract Training Data from Analytics            ║
╚════════════════════════════════════════════════════════╝

Extracts validation results from Analytics Engine and applies
heuristic labeling to create training datasets for model retraining.

USAGE
  npm run cli training:extract [options]

OPTIONS
  --days <n>              Days of data to extract (default: 1)
  --min-confidence <n>    Minimum confidence threshold (default: 0.8)
  --min-samples <n>       Minimum samples per class (default: 100)
  --output <type>         Output format: kv|json (default: kv)
  --remote                Use production Analytics Engine
  --help, -h              Show this help message

EXAMPLES
  # Extract last 24 hours with defaults
  npm run cli training:extract

  # Extract last 7 days with 90% confidence threshold
  npm run cli training:extract --days 7 --min-confidence 0.9

  # Extract from production and save to KV
  npm run cli training:extract --days 1 --remote

  # Extract and save to JSON file
  npm run cli training:extract --output json
`);
		return;
	}

	const options = {
		days: parseInt(values.days as string, 10),
		minConfidence: parseFloat(values['min-confidence'] as string),
		minSamples: parseInt(values['min-samples'] as string, 10),
		output: values.output as string,
		remote: values.remote,
	};

	console.log('\\n🔍 Extracting Training Data from Analytics Engine');
	console.log('═'.repeat(80));
	console.log(`Days:            ${options.days}`);
	console.log(`Min Confidence:  ${options.minConfidence}`);
	console.log(`Min Samples:     ${options.minSamples} per class`);
	console.log(`Remote:          ${options.remote ? 'Yes (production)' : 'No (local)'}`);
	console.log('═'.repeat(80));

	try {
		const startTime = Date.now();

		// Step 1: Query Analytics Engine
		console.log('\\n📊 Step 1: Querying Analytics Engine...');
		const records = await queryAnalytics(options.days, options.remote);

		console.log(`✓ Retrieved ${records.length.toLocaleString()} validation records`);

		if (records.length === 0) {
			console.log('\\n⚠️  No data found. Check if Analytics Engine has data.');
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

		// Step 5: Save dataset
		console.log('\\n💾 Step 5: Saving dataset...');
		if (options.output === 'kv') {
			await saveToKV(dataset, options.remote);
		} else {
			await saveToJSON(dataset);
		}

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
 * Query Analytics Engine for validation records
 */
async function queryAnalytics(days: number, remote: boolean): Promise<ValidationRecord[]> {
	const sql = `
		SELECT
			blob2 as email,
			blob1 as decision,
			double1 as risk_score,
			double2 as confidence,
			blob3 as pattern_family,
			blob4 as entropy_category,
			blob18 as markov_detected,
			double6 as markov_confidence,
			double3 as bot_score,
			timestamp
		FROM FRAUD_DETECTION_ANALYTICS
		WHERE timestamp >= NOW() - INTERVAL '${days * 24}' HOUR
			AND decision IN ('block', 'allow', 'warn')
			AND blob2 IS NOT NULL
		ORDER BY timestamp DESC
		LIMIT 100000
	`.trim();

	console.log('  Executing query...');

	const command = `npx wrangler analytics sql --query="${sql.replace(/"/g, '\\"')}"`;
	const output = execSync(command, { encoding: 'utf-8' });

	// Parse JSON output
	const results = JSON.parse(output);

	// Convert to ValidationRecord format
	const records: ValidationRecord[] = results.map((row: any) => ({
		email: row.email,
		decision: row.decision,
		riskScore: row.risk_score || 0,
		confidence: row.confidence || 0,
		patternFamily: row.pattern_family,
		entropyCategory: row.entropy_category,
		markovDetected: row.markov_detected === 'true',
		markovConfidence: row.markov_confidence || 0,
		botScore: row.bot_score || 0,
		timestamp: row.timestamp,
	}));

	return records;
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
 * Save dataset to KV
 */
async function saveToKV(dataset: TrainingDataset, remote: boolean) {
	const key = `training_data_${dataset.date}`;
	const value = JSON.stringify(dataset, null, 2);

	// Save to temp file
	const tempFile = `/tmp/training_data_${dataset.date}.json`;
	await Bun.write(tempFile, value);

	// Upload to KV
	const remoteFlag = remote ? '--remote' : '';
	const command = `npx wrangler kv key put "${key}" --path="${tempFile}" --binding=CONFIG ${remoteFlag}`;

	execSync(command, { stdio: 'inherit' });

	console.log(`✓ Saved to KV: ${key}`);
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
