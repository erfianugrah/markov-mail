/**
 * A/B Test Analysis Command
 *
 * Analyzes experiment results via /admin/analytics (D1)
 */

import { parseArgs } from 'util';
import { logger } from '../../utils/logger.ts';

interface AnalyzeOptions {
	experimentId: string;
	hours: number;
	format: 'table' | 'json';
	url: string;
	apiKey: string;
}

function normalizeBaseUrl(url: string): string {
	return url.endsWith('/') ? url.slice(0, -1) : url;
}

function resolveApiConfig(values: any): { url: string; apiKey: string } {
	const url =
		(values.url as string | undefined) ||
		process.env.FRAUD_API_URL ||
		'http://localhost:8787';

	const apiKey =
		(values['api-key'] as string | undefined) ||
		process.env.FRAUD_API_KEY;

	if (!apiKey) {
		logger.error('Missing API key. Set FRAUD_API_KEY or pass --api-key.');
		process.exit(1);
	}

	return { url: normalizeBaseUrl(url), apiKey };
}

export async function analyzeExperiment(args: string[]) {
	// Parse arguments
	const { values } = parseArgs({
		args,
		options: {
			'experiment-id': { type: 'string' },
			hours: { type: 'string' },
			format: { type: 'string' },
			url: { type: 'string' },
			'api-key': { type: 'string' },
			help: { type: 'boolean', short: 'h' },
		},
		allowPositionals: true,
	});

	if (values.help) {
		console.log(`
Usage: npm run cli ab:analyze [options]

Analyze A/B test experiment results via /admin/analytics

Options:
  --experiment-id <id>    Experiment ID to analyze (required)
  --hours <n>             Hours of data to analyze (default: 168 = 7 days)
  --format <type>         Output format: table|json (default: table)
  --url <base>            Base URL (default: FRAUD_API_URL or http://localhost:8787)
  --api-key <key>         Admin API key (default: FRAUD_API_KEY)
  -h, --help              Show this help message

Examples:
  # Analyze last 7 days
  npm run cli ab:analyze --experiment-id "test_new_weights"

  # Analyze last 24 hours
  npm run cli ab:analyze --experiment-id "bot_mgmt_test" --hours 24

  # Get JSON output for further processing
  npm run cli ab:analyze --experiment-id "decision_tree_candidate" --format json
		`);
		return;
	}

	// Validate required options
	if (!values['experiment-id']) {
		console.error('❌ Error: --experiment-id is required');
		process.exit(1);
	}

	const apiConfig = resolveApiConfig(values);
	const options: AnalyzeOptions = {
		experimentId: values['experiment-id'] as string,
		hours: values.hours ? parseInt(values.hours as string, 10) : 168,
		format: (values.format as 'table' | 'json') || 'table',
		url: apiConfig.url,
		apiKey: apiConfig.apiKey,
	};

	console.log('\n📊 Analyzing A/B Test Results');
	console.log('═'.repeat(80));
	console.log(`Experiment ID:  ${options.experimentId}`);
	console.log(`Time Range:     Last ${options.hours} hours`);
	console.log('═'.repeat(80));

	try {
		// Build SQL query to compare variants
		const escapedExperiment = options.experimentId.replace(/'/g, "''");
		const sql = `
			SELECT
				variant,
				experiment_id,
				COUNT(*) AS total_requests,
				SUM(CASE WHEN decision = 'block' THEN 1 ELSE 0 END) AS blocks,
				SUM(CASE WHEN decision = 'warn' THEN 1 ELSE 0 END) AS warns,
				SUM(CASE WHEN decision = 'allow' THEN 1 ELSE 0 END) AS allows,
				AVG(risk_score) AS avg_risk_score,
				AVG(latency) AS avg_latency_ms,
				AVG(bot_score) AS avg_bot_score
			FROM validations
			WHERE experiment_id = '${escapedExperiment}'
			  AND timestamp >= datetime('now', '-${options.hours} hours')
			GROUP BY variant, experiment_id
			ORDER BY variant;
		`.trim();

		console.log('\n🔍 Querying /admin/analytics...\n');

		const response = await fetch(`${options.url}/admin/analytics`, {
			method: 'POST',
			headers: {
				'X-API-Key': options.apiKey,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ query: sql, hours: options.hours }),
		});

		if (!response.ok) {
			const text = await response.text();
			throw new Error(`Query failed (${response.status}): ${text}`);
		}

		const payload = await response.json() as { data?: Record<string, any>[] };
		const results = payload.data || [];

		if (results.length === 0) {
			console.log('📭 No data found for this experiment yet');
			console.log('\nPossible reasons:');
			console.log('  - Experiment just started (wait a few minutes)');
			console.log('  - No traffic has hit the worker');
			console.log('  - Experiment ID does not match');
			return;
		}

		// Display results
		if (options.format === 'json') {
			console.log(JSON.stringify(results, null, 2));
		} else {
			displayTableResults(results, options.experimentId);
		}

		// Calculate statistical significance
		if (results.length === 2) {
			console.log('\n📈 Statistical Analysis');
			console.log('─'.repeat(80));
			calculateSignificance(results);
		}
	} catch (error: any) {
		console.error('\n❌ Failed to analyze experiment:');
		console.error(error.message || error);
		process.exit(1);
	}
}

function displayTableResults(results: any[], experimentId: string) {
	console.log('\n📋 Variant Comparison');
	console.log('─'.repeat(80));

	for (const row of results) {
		const variant = row.variant || 'unknown';
		const blockRate = (row.blocks / row.total_requests) * 100;
		const warnRate = (row.warns / row.total_requests) * 100;
		const allowRate = (row.allows / row.total_requests) * 100;

		console.log(`\n🔹 Variant: ${variant.toUpperCase()}`);
		console.log(`  Total Requests:     ${row.total_requests.toLocaleString()}`);
		console.log(`\n  Decisions:`);
		console.log(`    Block:            ${row.blocks.toLocaleString()} (${blockRate.toFixed(2)}%)`);
		console.log(`    Warn:             ${row.warns.toLocaleString()} (${warnRate.toFixed(2)}%)`);
		console.log(`    Allow:            ${row.allows.toLocaleString()} (${allowRate.toFixed(2)}%)`);
		console.log(`\n  Risk Scores:`);
		console.log(`    Avg:              ${Number(row.avg_risk_score || 0).toFixed(3)}`);
		console.log(`\n  Performance:`);
		console.log(`    Avg Latency:      ${Number(row.avg_latency_ms || 0).toFixed(1)}ms`);

		if (row.avg_bot_score) {
			console.log(`\n  Bot Management:`);
			console.log(`    Avg Bot Score:    ${Number(row.avg_bot_score).toFixed(1)}/100`);
		}
	}
}

function calculateSignificance(results: any[]) {
	const control = results.find((r) => r.variant === 'control');
	const treatment = results.find((r) => r.variant === 'treatment');

	if (!control || !treatment) {
		console.log('⚠️  Need both control and treatment data for statistical analysis');
		return;
	}

	// Calculate block rate difference
	const controlBlockRate = control.blocks / control.total_requests;
	const treatmentBlockRate = treatment.blocks / treatment.total_requests;
	const blockRateDiff = ((treatmentBlockRate - controlBlockRate) / controlBlockRate) * 100;

	// Calculate risk score difference
	const riskScoreDiff =
		((treatment.avg_risk_score - control.avg_risk_score) / control.avg_risk_score) * 100;

	// Chi-square test for block rate (simplified)
	const totalRequests = control.total_requests + treatment.total_requests;
	const totalBlocks = control.blocks + treatment.blocks;
	const expectedControlBlocks = (control.total_requests / totalRequests) * totalBlocks;
	const expectedTreatmentBlocks = (treatment.total_requests / totalRequests) * totalBlocks;

	const chiSquare =
		Math.pow(control.blocks - expectedControlBlocks, 2) / expectedControlBlocks +
		Math.pow(treatment.blocks - expectedTreatmentBlocks, 2) / expectedTreatmentBlocks;

	// p-value approximation (1 degree of freedom)
	// For chi-square = 3.84, p = 0.05 (95% confidence)
	// For chi-square = 6.63, p = 0.01 (99% confidence)
	let significance = 'Not significant';
	if (chiSquare > 6.63) {
		significance = '✅ Highly significant (p < 0.01)';
	} else if (chiSquare > 3.84) {
		significance = '✅ Significant (p < 0.05)';
	}

	console.log(`\n  Block Rate Change:      ${blockRateDiff > 0 ? '+' : ''}${blockRateDiff.toFixed(2)}%`);
	console.log(`  Risk Score Change:      ${riskScoreDiff > 0 ? '+' : ''}${riskScoreDiff.toFixed(2)}%`);
	console.log(`  Chi-Square Statistic:   ${chiSquare.toFixed(2)}`);
	console.log(`  Statistical Significance: ${significance}`);

	// Recommendation
	console.log('\n💡 Recommendation:');
	if (chiSquare > 3.84) {
		if (blockRateDiff < 0 && treatmentBlockRate < controlBlockRate) {
			console.log('  ✅ Treatment shows significant improvement (fewer blocks)');
			console.log('  → Consider promoting treatment to 100% traffic');
		} else if (blockRateDiff > 0 && treatmentBlockRate > controlBlockRate) {
			console.log('  ⚠️  Treatment shows significant degradation (more blocks)');
			console.log('  → Consider stopping experiment and reverting');
		} else {
			console.log('  📊 Results are statistically significant');
			console.log('  → Review metrics to determine next steps');
		}
	} else {
		console.log('  ⏳ Not enough data for statistical significance');
		console.log('  → Continue experiment and collect more data');
		const minSampleSize = Math.max(1000, control.total_requests * 2);
		console.log(`  → Target: ${minSampleSize.toLocaleString()}+ requests per variant`);
	}
}

// Export for CLI integration
export default analyzeExperiment;
