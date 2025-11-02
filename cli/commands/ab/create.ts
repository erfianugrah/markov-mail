/**
 * A/B Test Creation Command
 *
 * Creates a new A/B test experiment in Workers KV
 */

import { parseArgs } from 'util';
import { execSync } from 'child_process';
import type { ABTestConfig } from '../../../src/ab-testing/types';
import { validateExperimentConfig } from '../../../src/ab-testing/assignment';

interface CreateOptions {
	experimentId: string;
	description: string;
	treatmentWeight: number; // 0-100 (percentage of traffic)
	duration: number; // days
	treatmentConfig?: string; // JSON string of config overrides
	remote: boolean;
}

export async function createExperiment(args: string[]) {
	// Parse arguments
	const { values } = parseArgs({
		args,
		options: {
			'experiment-id': { type: 'string' },
			description: { type: 'string' },
			'treatment-weight': { type: 'string' },
			duration: { type: 'string' },
			'treatment-config': { type: 'string' },
			remote: { type: 'boolean', default: false },
			help: { type: 'boolean', short: 'h' },
		},
		allowPositionals: true,
	});

	if (values.help) {
		console.log(`
Usage: npm run cli ab:create [options]

Create a new A/B test experiment

Options:
  --experiment-id <id>         Unique experiment identifier (required)
  --description <desc>         Experiment description (required)
  --treatment-weight <n>       Treatment traffic percentage (0-100, default: 10)
  --duration <days>            Experiment duration in days (default: 7)
  --treatment-config <json>    JSON config overrides for treatment variant
  --remote                     Save to remote KV (production)
  -h, --help                   Show this help message

Examples:
  # Create simple experiment (10% treatment, 7 days)
  npm run cli ab:create \\
    --experiment-id "test_new_weights" \\
    --description "Test optimized risk weights"

  # Create with custom config overrides
  npm run cli ab:create \\
    --experiment-id "bot_mgmt_test" \\
    --description "Test Bot Management at 1% weight" \\
    --treatment-weight 10 \\
    --duration 7 \\
    --treatment-config '{"riskWeights":{"botRisk":0.01,"patternDetection":0.29}}'

  # Deploy to production KV
  npm run cli ab:create \\
    --experiment-id "ensemble_markov" \\
    --description "Test ensemble Markov models" \\
    --remote
		`);
		return;
	}

	// Validate required options
	if (!values['experiment-id']) {
		console.error('❌ Error: --experiment-id is required');
		process.exit(1);
	}

	if (!values.description) {
		console.error('❌ Error: --description is required');
		process.exit(1);
	}

	const options: CreateOptions = {
		experimentId: values['experiment-id'] as string,
		description: values.description as string,
		treatmentWeight: values['treatment-weight'] ? parseInt(values['treatment-weight'] as string, 10) : 10,
		duration: values.duration ? parseInt(values.duration as string, 10) : 7,
		treatmentConfig: values['treatment-config'] as string | undefined,
		remote: values.remote as boolean,
	};

	// Validate treatment weight
	if (options.treatmentWeight < 0 || options.treatmentWeight > 100) {
		console.error('❌ Error: --treatment-weight must be between 0 and 100');
		process.exit(1);
	}

	// Parse treatment config if provided
	let treatmentConfigOverrides = {};
	if (options.treatmentConfig) {
		try {
			treatmentConfigOverrides = JSON.parse(options.treatmentConfig);
		} catch (error) {
			console.error('❌ Error: Invalid JSON in --treatment-config');
			console.error(error);
			process.exit(1);
		}
	}

	// Calculate dates
	const now = new Date();
	const endDate = new Date(now.getTime() + options.duration * 24 * 60 * 60 * 1000);

	// Build experiment config
	const config: ABTestConfig = {
		experimentId: options.experimentId,
		description: options.description,
		variants: {
			control: {
				weight: 100 - options.treatmentWeight,
			},
			treatment: {
				weight: options.treatmentWeight,
				config: treatmentConfigOverrides,
			},
		},
		startDate: now.toISOString(),
		endDate: endDate.toISOString(),
		enabled: true,
		metadata: {
			hypothesis: options.description,
			expectedImpact: 'TBD - monitor analytics',
			successMetrics: ['false_positive_rate', 'accuracy', 'latency'],
		},
	};

	// Validate experiment config
	const validation = validateExperimentConfig(config);
	if (!validation.valid) {
		console.error('❌ Experiment config validation failed:');
		validation.errors.forEach((error) => console.error(`  - ${error}`));
		process.exit(1);
	}

	// Save to KV
	console.log('\n🧪 Creating A/B Test Experiment');
	console.log('═'.repeat(50));
	console.log(`Experiment ID:      ${config.experimentId}`);
	console.log(`Description:        ${config.description}`);
	console.log(`Traffic Split:      ${config.variants.control.weight}% control / ${config.variants.treatment.weight}% treatment`);
	console.log(`Start Date:         ${config.startDate}`);
	console.log(`End Date:           ${config.endDate}`);
	console.log(`Duration:           ${options.duration} days`);
	if (Object.keys(treatmentConfigOverrides).length > 0) {
		console.log(`Treatment Config:   ${JSON.stringify(treatmentConfigOverrides, null, 2)}`);
	}
	console.log('═'.repeat(50));

	try {
		const configJson = JSON.stringify(config, null, 2);
		const kvBinding = 'CONFIG';
		const kvKey = 'ab_test_config';

		// Save to KV using wrangler
		const remoteFlag = options.remote ? '--remote' : '';
		const command = `echo '${configJson.replace(/'/g, "'\\''")}' | npx wrangler kv key put "${kvKey}" --binding "${kvBinding}" ${remoteFlag}`;

		console.log('\n📦 Saving to Workers KV...');
		execSync(command, { stdio: 'inherit' });

		console.log('\n✅ Experiment created successfully!');
		console.log('\n📊 Next steps:');
		console.log('  1. Monitor experiment: npm run cli ab:status');
		console.log('  2. Analyze results:    npm run cli ab:analyze --experiment-id ' + options.experimentId);
		console.log('  3. Stop experiment:    npm run cli ab:stop');
	} catch (error) {
		console.error('\n❌ Failed to create experiment:');
		console.error(error);
		process.exit(1);
	}
}

// Export for CLI integration
export default createExperiment;
