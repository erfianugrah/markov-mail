/**
 * Manual Training Command
 *
 * Manually trigger model training from extracted datasets
 */

import { parseArgs } from 'util';
import { runTrainingPipeline, type TrainingConfig } from '../../../src/training/model-training';

// Mock KV for local development
class MockKV {
	private store = new Map<string, string>();

	async get<T = unknown>(key: string, type?: 'text' | 'json'): Promise<T | null> {
		const value = this.store.get(key);
		if (!value) return null;

		if (type === 'json') {
			return JSON.parse(value) as T;
		}
		return value as T;
	}

	async put(key: string, value: string): Promise<void> {
		this.store.set(key, value);
	}

	async list(options?: { prefix?: string }): Promise<{ keys: Array<{ name: string }> }> {
		const keys = Array.from(this.store.keys())
			.filter((k) => !options?.prefix || k.startsWith(options.prefix))
			.map((name) => ({ name }));
		return { keys };
	}

	async delete(key: string): Promise<void> {
		this.store.delete(key);
	}
}

export async function trainModels(args: string[]) {
	// Parse arguments
	const { values } = parseArgs({
		args,
		options: {
			days: { type: 'string', default: '7' },
			orders: { type: 'string', default: '1,2,3' },
			'adaptation-rate': { type: 'string', default: '0.3' },
			'min-samples': { type: 'string', default: '100' },
			remote: { type: 'boolean', default: false },
			help: { type: 'boolean', short: 'h' },
		},
		allowPositionals: true,
	});

	if (values.help) {
		console.log(`
╔════════════════════════════════════════════════════════╗
║           Train Models from Extracted Data             ║
╚════════════════════════════════════════════════════════╝

Trains Markov Chain models from extracted training datasets.
Automatically loads datasets from KV and trains models for specified orders.

USAGE
  npm run cli training:train [options]

OPTIONS
  --days <n>              Days of training data to use (default: 7)
  --orders <list>         N-gram orders to train (default: "1,2,3")
  --adaptation-rate <n>   Adaptive training rate (default: 0.3)
  --min-samples <n>       Minimum samples per class (default: 100)
  --remote                Use production KV
  --help, -h              Show this help message

EXAMPLES
  # Train all models with defaults (last 7 days)
  npm run cli training:train

  # Train only 2-gram and 3-gram models
  npm run cli training:train --orders "2,3"

  # Use last 14 days of data with stricter requirements
  npm run cli training:train --days 14 --min-samples 200

  # Train against production data
  npm run cli training:train --remote

WORKFLOW
  1. Extract data:    npm run cli training:extract --days 7
  2. Train models:    npm run cli training:train --days 7
  3. Validate models: npm run cli training:validate --version <version>
  4. Deploy via A/B:  npm run cli ab:create --experiment-id <id>
`);
		return;
	}

	const options = {
		days: parseInt(values.days as string, 10),
		orders: (values.orders as string).split(',').map((o) => parseInt(o.trim(), 10)),
		adaptationRate: parseFloat(values['adaptation-rate'] as string),
		minSamples: parseInt(values['min-samples'] as string, 10),
		remote: values.remote,
	};

	console.log('\n🤖 Training Markov Models from Extracted Data');
	console.log('═'.repeat(80));
	console.log(`Days of data:       ${options.days}`);
	console.log(`N-gram orders:      [${options.orders.join(', ')}]`);
	console.log(`Adaptation rate:    ${options.adaptationRate}`);
	console.log(`Min samples/class:  ${options.minSamples}`);
	console.log(`Remote:             ${options.remote ? 'Yes (production)' : 'No (local)'}`);
	console.log('═'.repeat(80));

	try {
		const startTime = Date.now();

		// Create training config
		const trainingConfig: TrainingConfig = {
			orders: options.orders,
			adaptationRate: options.adaptationRate,
			minSamplesPerClass: options.minSamples,
		};

		// Note: In production this would use real KV binding
		// For CLI we'll use mock KV and load from local files or wrangler
		const kv = new MockKV() as unknown as KVNamespace;

		// If remote, use wrangler to sync data
		if (options.remote) {
			console.log('\n⚠️  Remote training not yet implemented in CLI');
			console.log('    Use the Worker scheduled trigger or API endpoint instead.');
			console.log('    Or run: npm run cli training:extract --remote && [manual training]');
			return;
		}

		console.log('\n📊 Step 1: Loading training datasets...');
		console.log(
			'   (Note: This requires training data extracted via "npm run cli training:extract")'
		);

		// Run training pipeline
		const trainedModels = await runTrainingPipeline(kv, trainingConfig, options.days);

		const duration = Date.now() - startTime;

		// Summary
		console.log('\n✅ Model Training Complete!');
		console.log('═'.repeat(80));
		console.log(`Version:             ${trainedModels.version}`);
		console.log(`Created:             ${trainedModels.createdAt}`);
		console.log(`Models trained:      ${trainedModels.metadata.orders.join(', ')}-gram`);
		console.log(`Legitimate samples:  ${trainedModels.metadata.trainingSamples.legit.toLocaleString()}`);
		console.log(`Fraudulent samples:  ${trainedModels.metadata.trainingSamples.fraud.toLocaleString()}`);
		console.log(`Total samples:       ${trainedModels.metadata.trainingSamples.total.toLocaleString()}`);
		console.log(`Training duration:   ${(trainedModels.metadata.trainingDuration / 1000).toFixed(1)}s`);
		console.log(`Total time:          ${(duration / 1000).toFixed(1)}s`);
		console.log(`Datasets used:       ${trainedModels.metadata.datasetDates.join(', ')}`);
		console.log('═'.repeat(80));

		console.log('\n📝 Next steps:');
		console.log('  1. Validate models: npm run cli training:validate');
		console.log(`  2. Review metrics for version: ${trainedModels.version}`);
		console.log('  3. Deploy via A/B test: npm run cli ab:create');
		console.log('  4. Monitor performance: npm run cli analytics:stats');
	} catch (error) {
		console.error('\n❌ Training failed:');
		console.error(error);
		process.exit(1);
	}
}

// Export for CLI integration
export default trainModels;
