/**
 * Model Validation Command
 *
 * Validate trained models before deployment
 */

import { parseArgs } from 'util';
import {
	compareWithProduction,
	generateTestDataset,
	DEFAULT_VALIDATION_CONFIG,
	type ValidationConfig,
} from '../../../src/training/model-validation';
import type { TrainedModels } from '../../../src/training/model-training';

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

export async function validateCommand(args: string[]) {
	// Parse arguments
	const { values } = parseArgs({
		args,
		options: {
			version: { type: 'string' },
			'test-days': { type: 'string', default: '7' },
			'test-split': { type: 'string', default: '0.2' },
			'compare-production': { type: 'boolean', default: true },
			'min-accuracy': { type: 'string', default: '0.95' },
			'min-precision': { type: 'string', default: '0.90' },
			'min-recall': { type: 'string', default: '0.85' },
			remote: { type: 'boolean', default: false },
			help: { type: 'boolean', short: 'h' },
		},
		allowPositionals: true,
	});

	if (values.help) {
		console.log(`
╔════════════════════════════════════════════════════════╗
║              Validate Trained Models                   ║
╚════════════════════════════════════════════════════════╝

Validates trained models against test dataset with quality gates.

USAGE
  npm run cli training:validate [options]

OPTIONS
  --version <ver>          Model version to validate (required)
  --test-days <n>          Days of test data (default: 7)
  --test-split <n>         Test split ratio (default: 0.2)
  --compare-production     Compare with production models (default: true)
  --min-accuracy <n>       Minimum accuracy threshold (default: 0.95)
  --min-precision <n>      Minimum precision threshold (default: 0.90)
  --min-recall <n>         Minimum recall threshold (default: 0.85)
  --remote                 Use production KV
  --help, -h               Show this help message

EXAMPLES
  # Validate latest trained models
  npm run cli training:validate --version 20251102_020000

  # Validate with custom thresholds
  npm run cli training:validate \\
    --version 20251102_020000 \\
    --min-accuracy 0.97 \\
    --min-precision 0.92

  # Validate without production comparison
  npm run cli training:validate \\
    --version 20251102_020000 \\
    --compare-production false

VALIDATION METRICS
  - Accuracy: Overall correctness
  - Precision: Fraud detection accuracy (TP / (TP + FP))
  - Recall: Fraud detection coverage (TP / (TP + FN))
  - F1 Score: Harmonic mean of precision and recall
  - False Positive Rate: Legit emails blocked

RECOMMENDATIONS
  - deploy: Models meet all thresholds and improved
  - manual_review: Models pass most checks but need review
  - reject: Models failed critical thresholds
`);
		return;
	}

	if (!values.version) {
		console.error('❌ Error: --version is required');
		console.error('Run "npm run cli training:validate --help" for usage');
		process.exit(1);
	}

	const options = {
		version: values.version as string,
		testDays: parseInt(values['test-days'] as string, 10),
		testSplit: parseFloat(values['test-split'] as string),
		compareProduction: values['compare-production'] !== false,
		remote: values.remote,
		validationConfig: {
			...DEFAULT_VALIDATION_CONFIG,
			minAccuracy: parseFloat(values['min-accuracy'] as string),
			minPrecision: parseFloat(values['min-precision'] as string),
			minRecall: parseFloat(values['min-recall'] as string),
		} as ValidationConfig,
	};

	console.log('\n🔍 Model Validation');
	console.log('═'.repeat(80));
	console.log(`Model Version:      ${options.version}`);
	console.log(`Test Days:          ${options.testDays}`);
	console.log(`Test Split:         ${options.testSplit * 100}%`);
	console.log(`Compare Production: ${options.compareProduction ? 'Yes' : 'No'}`);
	console.log(`Min Accuracy:       ${(options.validationConfig.minAccuracy * 100).toFixed(1)}%`);
	console.log(`Min Precision:      ${(options.validationConfig.minPrecision * 100).toFixed(1)}%`);
	console.log(`Min Recall:         ${(options.validationConfig.minRecall * 100).toFixed(1)}%`);
	console.log('═'.repeat(80));

	try {
		const startTime = Date.now();

		// Note: In production this would use real KV binding
		// For CLI we'll use mock KV
		const kv = new MockKV() as unknown as KVNamespace;

		if (options.remote) {
			console.log('\n⚠️  Remote validation not yet implemented in CLI');
			console.log('    Use the Worker scheduled trigger or API endpoint instead.');
			return;
		}

		// Load trained models
		console.log('\n📦 Step 1: Loading trained models...');
		const trainedModels = await loadModelsFromVersion(kv, options.version);

		if (!trainedModels) {
			console.error(`\n❌ Models not found for version: ${options.version}`);
			console.error('   Make sure the models have been trained and saved to KV');
			process.exit(1);
		}

		console.log(`   ✓ Loaded ${trainedModels.metadata.orders.join(', ')}-gram models`);

		// Generate test dataset
		console.log('\n🧪 Step 2: Generating test dataset...');
		const testDataset = await generateTestDataset(kv, options.testDays, options.testSplit);
		console.log(`   ✓ Test samples: ${testDataset.metadata.totalSamples}`);

		// Load production models if comparison requested
		let productionModels: TrainedModels | null = null;
		if (options.compareProduction) {
			console.log('\n📊 Step 3: Loading production models...');
			productionModels = await loadProductionModels(kv);
			if (productionModels) {
				console.log(`   ✓ Loaded production version: ${productionModels.version}`);
			} else {
				console.log('   ℹ️  No production models found (first deployment?)');
			}
		}

		// Run validation
		console.log('\n✅ Step 4: Validating models...');
		const validationResult = await compareWithProduction(
			trainedModels,
			productionModels,
			testDataset,
			options.validationConfig
		);

		const duration = Date.now() - startTime;

		// Display results
		console.log('\n╔════════════════════════════════════════════════════════╗');
		console.log(`║  ${validationResult.passed ? '✅ VALIDATION PASSED' : '❌ VALIDATION FAILED'}                            ║`);
		console.log('╚════════════════════════════════════════════════════════╝');

		console.log('\n📈 Metrics:');
		console.log(`   Accuracy:             ${(validationResult.metrics.accuracy * 100).toFixed(2)}%`);
		console.log(`   Precision:            ${(validationResult.metrics.precision * 100).toFixed(2)}%`);
		console.log(`   Recall:               ${(validationResult.metrics.recall * 100).toFixed(2)}%`);
		console.log(`   F1 Score:             ${(validationResult.metrics.f1Score * 100).toFixed(2)}%`);
		console.log(`   False Positive Rate:  ${(validationResult.metrics.falsePositiveRate * 100).toFixed(2)}%`);

		console.log('\n📊 Confusion Matrix:');
		const cm = validationResult.metrics.confusionMatrix;
		console.log(`   True Positives:  ${cm.truePositives.toLocaleString()}`);
		console.log(`   True Negatives:  ${cm.trueNegatives.toLocaleString()}`);
		console.log(`   False Positives: ${cm.falsePositives.toLocaleString()}`);
		console.log(`   False Negatives: ${cm.falseNegatives.toLocaleString()}`);

		if (validationResult.comparisonWithProduction) {
			const comp = validationResult.comparisonWithProduction;
			console.log('\n🔄 Comparison with Production:');
			console.log(`   Accuracy:   ${comp.accuracyDelta >= 0 ? '+' : ''}${(comp.accuracyDelta * 100).toFixed(2)}%`);
			console.log(`   Precision:  ${comp.precisionDelta >= 0 ? '+' : ''}${(comp.precisionDelta * 100).toFixed(2)}%`);
			console.log(`   Recall:     ${comp.recallDelta >= 0 ? '+' : ''}${(comp.recallDelta * 100).toFixed(2)}%`);
			console.log(`   F1 Score:   ${comp.f1Delta >= 0 ? '+' : ''}${(comp.f1Delta * 100).toFixed(2)}%`);
			console.log(`   ${comp.improved ? '📈 IMPROVED' : '📉 REGRESSED'}`);
		}

		console.log(`\n💡 Recommendation: ${validationResult.recommendation.toUpperCase()}`);

		if (validationResult.issues.length > 0) {
			console.log('\n⚠️  Issues:');
			validationResult.issues.forEach((issue) => console.log(`   - ${issue}`));
		}

		console.log(`\n⏱️  Validation time: ${(duration / 1000).toFixed(1)}s`);

		// Next steps
		console.log('\n📝 Next steps:');
		if (validationResult.recommendation === 'deploy') {
			console.log('   ✅ Models ready for deployment!');
			console.log(`   1. Deploy to canary: npm run cli ab:create --experiment-id ${options.version}`);
			console.log('   2. Monitor canary performance');
			console.log('   3. Promote to production if successful');
		} else if (validationResult.recommendation === 'manual_review') {
			console.log('   ⚠️  Manual review recommended:');
			console.log('   1. Review validation issues above');
			console.log('   2. Analyze failure cases');
			console.log('   3. Decide whether to deploy or retrain');
		} else {
			console.log('   ❌ Models not ready for deployment:');
			console.log('   1. Review validation failures');
			console.log('   2. Retrain with more/better data');
			console.log('   3. Adjust training parameters');
		}

		process.exit(validationResult.passed ? 0 : 1);
	} catch (error) {
		console.error('\n❌ Validation failed:');
		console.error(error);
		process.exit(1);
	}
}

/**
 * Load models from a specific version
 */
async function loadModelsFromVersion(
	kv: KVNamespace,
	version: string
): Promise<TrainedModels | null> {
	try {
		const models: any = {};

		for (const order of [1, 2, 3]) {
			const legitKey = `MM_legit_${order}gram_${version}`;
			const fraudKey = `MM_fraud_${order}gram_${version}`;

			const legitData = await kv.get(legitKey, 'json');
			const fraudData = await kv.get(fraudKey, 'json');

			if (!legitData || !fraudData) {
				continue;
			}

			const { NGramMarkovChain } = await import('../../../src/detectors/ngram-markov');
			models[order] = {
				legit: NGramMarkovChain.fromJSON(legitData),
				fraud: NGramMarkovChain.fromJSON(fraudData),
			};
		}

		if (Object.keys(models).length === 0) {
			return null;
		}

		return {
			version,
			createdAt: new Date().toISOString(),
			models,
			metadata: {
				trainingSamples: { legit: 0, fraud: 0, total: 0 },
				trainingDuration: 0,
				datasetDates: [],
				orders: Object.keys(models).map(Number),
			},
		};
	} catch (error) {
		return null;
	}
}

/**
 * Load production models
 */
async function loadProductionModels(kv: KVNamespace): Promise<TrainedModels | null> {
	try {
		const productionVersion = await kv.get('production_model_version');
		if (!productionVersion) {
			return null;
		}

		return loadModelsFromVersion(kv, productionVersion);
	} catch (error) {
		return null;
	}
}

// Export for CLI integration
export default validateCommand;
