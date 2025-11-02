/**
 * A/B Test Analysis Command
 *
 * Analyzes experiment results from Analytics Engine
 */

import { parseArgs } from 'util';
import { execSync } from 'child_process';

interface AnalyzeOptions {
	experimentId: string;
	hours: number;
	format: 'table' | 'json';
	accountId?: string;
}

export async function analyzeExperiment(args: string[]) {
	// Parse arguments
	const { values } = parseArgs({
		args,
		options: {
			'experiment-id': { type: 'string' },
			hours: { type: 'string' },
			format: { type: 'string' },
			'account-id': { type: 'string' },
			help: { type: 'boolean', short: 'h' },
		},
		allowPositionals: true,
	});

	if (values.help) {
		console.log(`
Usage: npm run cli ab:analyze [options]

Analyze A/B test experiment results from Analytics Engine

Options:
  --experiment-id <id>    Experiment ID to analyze (required)
  --hours <n>             Hours of data to analyze (default: 168 = 7 days)
  --format <type>         Output format: table|json (default: table)
  --account-id <id>       Cloudflare account ID (from env: CLOUDFLARE_ACCOUNT_ID)
  -h, --help              Show this help message

Examples:
  # Analyze last 7 days
  npm run cli ab:analyze --experiment-id "test_new_weights"

  # Analyze last 24 hours
  npm run cli ab:analyze --experiment-id "bot_mgmt_test" --hours 24

  # Get JSON output for further processing
  npm run cli ab:analyze --experiment-id "ensemble_markov" --format json
		`);
		return;
	}

	// Validate required options
	if (!values['experiment-id']) {
		console.error('❌ Error: --experiment-id is required');
		process.exit(1);
	}

	const options: AnalyzeOptions = {
		experimentId: values['experiment-id'] as string,
		hours: values.hours ? parseInt(values.hours as string, 10) : 168, // 7 days default
		format: (values.format as 'table' | 'json') || 'table',
		accountId: values['account-id'] as string | undefined,
	};

	// Get account ID from env if not provided
	if (!options.accountId) {
		try {
			options.accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
		} catch {
			// Will fail later if account ID is needed
		}
	}

	console.log('\n📊 Analyzing A/B Test Results');
	console.log('═'.repeat(80));
	console.log(`Experiment ID:  ${options.experimentId}`);
	console.log(`Time Range:     Last ${options.hours} hours`);
	console.log('═'.repeat(80));

	try {
		// Build SQL query to compare variants
		const sql = `
			SELECT
				blob17 as variant,
				blob20 as experiment_id,
				COUNT(*) * any(_sample_interval) as total_requests,
				-- Decisions
				SUM(CASE WHEN blob1 = 'block' THEN _sample_interval ELSE 0 END) as blocks,
				SUM(CASE WHEN blob1 = 'warn' THEN _sample_interval ELSE 0 END) as warns,
				SUM(CASE WHEN blob1 = 'allow' THEN _sample_interval ELSE 0 END) as allows,
				-- Risk scores
				AVG(double1) as avg_risk_score,
				quantile(0.50)(double1) as median_risk_score,
				quantile(0.95)(double1) as p95_risk_score,
				-- Bot Management metrics (if applicable)
				AVG(double3) as avg_bot_score,
				quantile(0.50)(double3) as median_bot_score,
				-- Performance
				AVG(double5) as avg_latency_ms,
				quantile(0.95)(double5) as p95_latency_ms
			FROM FRAUD_DETECTION_ANALYTICS
			WHERE blob20 = '${options.experimentId}'
				AND timestamp >= NOW() - INTERVAL '${options.hours}' HOUR
			GROUP BY variant, experiment_id
			ORDER BY variant
		`.trim();

		// Execute query using wrangler
		console.log('\n🔍 Querying Analytics Engine...\n');

		const command = `npx wrangler analytics sql --query="${sql.replace(/"/g, '\\"')}"`;
		const output = execSync(command, { encoding: 'utf-8' });

		// Parse output (wrangler returns JSON array)
		let results: any[];
		try {
			results = JSON.parse(output);
		} catch {
			console.error('❌ Failed to parse analytics results');
			console.error('Raw output:', output);
			process.exit(1);
		}

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
		if (error.message?.includes('CLOUDFLARE_ACCOUNT_ID')) {
			console.error('Missing CLOUDFLARE_ACCOUNT_ID environment variable');
			console.error('Set it in .dev.vars or pass with --account-id');
		} else {
			console.error(error.message || error);
		}
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
		console.log(`    Avg:              ${row.avg_risk_score.toFixed(3)}`);
		console.log(`    Median:           ${row.median_risk_score.toFixed(3)}`);
		console.log(`    P95:              ${row.p95_risk_score.toFixed(3)}`);
		console.log(`\n  Performance:`);
		console.log(`    Avg Latency:      ${row.avg_latency_ms.toFixed(1)}ms`);
		console.log(`    P95 Latency:      ${row.p95_latency_ms.toFixed(1)}ms`);

		if (row.avg_bot_score > 0) {
			console.log(`\n  Bot Management:`);
			console.log(`    Avg Bot Score:    ${row.avg_bot_score.toFixed(1)}/100`);
			console.log(`    Median Bot Score: ${row.median_bot_score.toFixed(1)}/100`);
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
