/**
 * A/B Test Stop Command
 *
 * Stops and removes the active A/B test experiment
 */

import { parseArgs } from 'util';
import { execSync } from 'child_process';

export async function stopExperiment(args: string[]) {
	// Parse arguments
	const { values } = parseArgs({
		args,
		options: {
			remote: { type: 'boolean', default: false },
			yes: { type: 'boolean', short: 'y', default: false },
			help: { type: 'boolean', short: 'h' },
		},
		allowPositionals: true,
	});

	if (values.help) {
		console.log(`
Usage: npm run cli ab:stop [options]

Stop and remove the active A/B test experiment

Options:
  --remote       Stop remote experiment (production)
  -y, --yes      Skip confirmation prompt
  -h, --help     Show this help message

Examples:
  # Stop local experiment (with confirmation)
  npm run cli ab:stop

  # Stop production experiment without confirmation
  npm run cli ab:stop --remote --yes
		`);
		return;
	}

	console.log('\n🛑 Stopping A/B Test Experiment');
	console.log('═'.repeat(50));

	try {
		const kvBinding = 'CONFIG';
		const kvKey = 'ab_test_config';
		const remoteFlag = values.remote ? '--remote' : '';

		// Get current experiment info first
		let configJson: string;
		try {
			const getCommand = `npx wrangler kv key get "${kvKey}" --binding "${kvBinding}" ${remoteFlag}`;
			configJson = execSync(getCommand, { encoding: 'utf-8' });
		} catch (error) {
			console.log('📭 No active experiment found');
			return;
		}

		if (!configJson || configJson.trim() === '') {
			console.log('📭 No active experiment found');
			return;
		}

		const config = JSON.parse(configJson);

		// Show experiment info
		console.log(`\nExperiment to stop:`);
		console.log(`  ID:          ${config.experimentId}`);
		console.log(`  Description: ${config.description}`);
		console.log(`  Started:     ${config.startDate}`);
		console.log(`  Ends:        ${config.endDate}`);

		// Confirm unless --yes flag
		if (!values.yes) {
			console.log('\n⚠️  This will stop the experiment and remove it from KV.');
			console.log('All traffic will return to default configuration.');
			console.log('\nType "yes" to confirm:');

			// Read from stdin (simplified - in real CLI you'd use readline)
			const Bun = require('bun');
			const stdin = Bun.stdin.stream();
			const reader = stdin.getReader();

			let confirmation = '';
			const { value } = await reader.read();
			if (value) {
				confirmation = new TextDecoder().decode(value).trim().toLowerCase();
			}

			if (confirmation !== 'yes') {
				console.log('\n❌ Operation cancelled');
				return;
			}
		}

		// Delete from KV
		const deleteCommand = `npx wrangler kv key delete "${kvKey}" --binding "${kvBinding}" ${remoteFlag}`;
		execSync(deleteCommand, { stdio: 'inherit' });

		console.log('\n✅ Experiment stopped successfully!');
		console.log('\n📊 Next steps:');
		console.log('  - Review final results: npm run cli ab:analyze --experiment-id ' + config.experimentId);
		console.log('  - All traffic now uses default configuration');
	} catch (error) {
		console.error('\n❌ Failed to stop experiment:');
		console.error(error);
		process.exit(1);
	}
}

// Export for CLI integration
export default stopExperiment;
