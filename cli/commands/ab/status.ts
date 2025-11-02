/**
 * A/B Test Status Command
 *
 * Shows the currently active A/B test experiment
 */

import { parseArgs } from 'util';
import { execSync } from 'child_process';
import type { ABTestConfig } from '../../../src/ab-testing/types';
import { isExperimentActive } from '../../../src/ab-testing/assignment';

export async function showExperimentStatus(args: string[]) {
	// Parse arguments
	const { values } = parseArgs({
		args,
		options: {
			remote: { type: 'boolean', default: false },
			help: { type: 'boolean', short: 'h' },
		},
		allowPositionals: true,
	});

	if (values.help) {
		console.log(`
Usage: npm run cli ab:status [options]

Show the currently active A/B test experiment

Options:
  --remote       Check remote KV (production)
  -h, --help     Show this help message

Examples:
  # Check local experiment
  npm run cli ab:status

  # Check production experiment
  npm run cli ab:status --remote
		`);
		return;
	}

	console.log('\n🔍 Checking A/B Test Status');
	console.log('═'.repeat(50));

	try {
		const kvBinding = 'CONFIG';
		const kvKey = 'ab_test_config';
		const remoteFlag = values.remote ? '--remote' : '';

		// Get from KV using wrangler
		const command = `npx wrangler kv key get "${kvKey}" --binding "${kvBinding}" ${remoteFlag}`;

		let configJson: string;
		try {
			configJson = execSync(command, { encoding: 'utf-8' });
		} catch (error) {
			console.log('📭 No active experiment found');
			console.log('\nTo create an experiment:');
			console.log('  npm run cli ab:create --experiment-id "test_id" --description "Test description"');
			return;
		}

		if (!configJson || configJson.trim() === '') {
			console.log('📭 No active experiment found');
			return;
		}

		const config: ABTestConfig = JSON.parse(configJson);
		const active = isExperimentActive(config);

		// Display experiment info
		console.log(`\nExperiment ID:      ${config.experimentId}`);
		console.log(`Description:        ${config.description}`);
		console.log(`Status:             ${active ? '🟢 ACTIVE' : '🔴 INACTIVE'}`);
		console.log(`\nTraffic Split:`);
		console.log(`  Control:          ${config.variants.control.weight}%`);
		console.log(`  Treatment:        ${config.variants.treatment.weight}%`);
		console.log(`\nTimeline:`);
		console.log(`  Start Date:       ${config.startDate}`);
		console.log(`  End Date:         ${config.endDate}`);

		// Calculate time remaining
		const now = new Date();
		const endDate = new Date(config.endDate);
		const timeRemaining = endDate.getTime() - now.getTime();
		const daysRemaining = Math.ceil(timeRemaining / (24 * 60 * 60 * 1000));

		if (active) {
			if (daysRemaining > 0) {
				console.log(`  Time Remaining:   ${daysRemaining} days`);
			} else {
				console.log(`  Time Remaining:   Ending soon`);
			}
		}

		// Show config overrides if any
		if (config.variants.treatment.config) {
			console.log(`\nTreatment Config Overrides:`);
			console.log(JSON.stringify(config.variants.treatment.config, null, 2));
		}

		// Show metadata if available
		if (config.metadata) {
			console.log(`\nMetadata:`);
			if (config.metadata.hypothesis) {
				console.log(`  Hypothesis:       ${config.metadata.hypothesis}`);
			}
			if (config.metadata.expectedImpact) {
				console.log(`  Expected Impact:  ${config.metadata.expectedImpact}`);
			}
			if (config.metadata.successMetrics) {
				console.log(`  Success Metrics:  ${config.metadata.successMetrics.join(', ')}`);
			}
		}

		console.log('\n═'.repeat(50));

		if (active) {
			console.log('\n📊 Next steps:');
			console.log('  - Analyze results:  npm run cli ab:analyze --experiment-id ' + config.experimentId);
			console.log('  - Stop experiment:  npm run cli ab:stop');
		} else {
			console.log('\n⚠️  Experiment is inactive (past end date or disabled)');
			console.log('To remove: npm run cli ab:stop');
		}
	} catch (error) {
		console.error('\n❌ Failed to check experiment status:');
		console.error(error);
		process.exit(1);
	}
}

// Export for CLI integration
export default showExperimentStatus;
