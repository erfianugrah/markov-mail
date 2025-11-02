/**
 * Automated Training Worker
 *
 * Cron-triggered worker that automatically trains new models from extracted data
 */

import { logger } from '../logger';
import { runTrainingPipeline } from '../training/model-training';
import type { TrainingConfig, TrainedModels } from '../training/model-training';
import {
	compareWithProduction,
	generateTestDataset,
	DEFAULT_VALIDATION_CONFIG,
	type ValidationConfig,
} from '../training/model-validation';
import {
	createABTestForModels,
	monitorAndPromoteIfReady,
	checkExperimentExpiry,
	rollbackCanary,
	DEFAULT_AUTO_AB_CONFIG,
	type AutoABConfig,
} from '../training/auto-ab-testing';

export interface Env {
	CONFIG: KVNamespace;
	MARKOV_MODEL: KVNamespace;
}

/**
 * Default training configuration
 */
const DEFAULT_TRAINING_CONFIG: TrainingConfig = {
	orders: [1, 2, 3], // Train all n-gram orders
	adaptationRate: 0.3, // Skip samples within 0.3 std dev
	minSamplesPerClass: 100, // Require at least 100 samples per class
};

/**
 * Scheduled handler for cron-triggered training
 */
export async function scheduled(
	event: ScheduledEvent,
	env: Env,
	ctx: ExecutionContext
): Promise<void> {
	logger.info({
		event: 'training_pipeline_started',
		trigger: 'scheduled',
		scheduled_time: new Date(event.scheduledTime).toISOString(),
		cron: event.cron,
	}, 'Automated Training & Deployment Pipeline Started');

	try {
		// Step 0: Check existing A/B test status
		const expiryCheck = await checkExperimentExpiry(env.CONFIG);
		if (expiryCheck.expired) {
			logger.info({
				event: 'experiment_expired',
				action: expiryCheck.action,
				reason: expiryCheck.reason,
			}, `Existing experiment expired: ${expiryCheck.action}`);
			if (expiryCheck.action === 'rollback') {
				await rollbackCanary(env.CONFIG, expiryCheck.reason);
			}
		}

		// Check for auto-promotion opportunity
		const autoABConfig = await loadAutoABConfig(env.CONFIG);
		const promotionCheck = await monitorAndPromoteIfReady(env.CONFIG, autoABConfig);
		if (promotionCheck.promoted) {
			logger.info({
				event: 'model_auto_promoted',
				reason: promotionCheck.reason,
			}, promotionCheck.reason);
			return; // Skip training if we just promoted
		}

		// Load training config from KV (or use defaults)
		const configKey = 'training_config';
		const storedConfig = await env.CONFIG.get<TrainingConfig>(configKey, 'json');
		const trainingConfig = storedConfig || DEFAULT_TRAINING_CONFIG;

		logger.info({
			event: 'training_config_loaded',
			orders: trainingConfig.orders,
			adaptation_rate: trainingConfig.adaptationRate,
			min_samples_per_class: trainingConfig.minSamplesPerClass,
		}, 'Training Configuration loaded');

		// Run training pipeline (last 7 days of data)
		const trainedModels = await runTrainingPipeline(env.CONFIG, trainingConfig, 7);

		logger.info({
			event: 'training_completed',
			model_version: trainedModels.version,
			orders: trainedModels.metadata.orders,
			total_samples: trainedModels.metadata.trainingSamples.total,
			legit_samples: trainedModels.metadata.trainingSamples.legit,
			fraud_samples: trainedModels.metadata.trainingSamples.fraud,
			duration_ms: trainedModels.metadata.trainingDuration,
		}, 'Training Complete');

		// Generate test dataset (20% holdout)
		logger.info({
			event: 'test_dataset_generation_started',
			days: 7,
			split_ratio: 0.2,
		}, 'Generating test dataset...');
		const testDataset = await generateTestDataset(env.CONFIG, 7, 0.2);

		// Load production models for comparison
		logger.info({
			event: 'model_validation_started',
		}, 'Validating models...');
		const productionModels = await loadProductionModels(env.CONFIG);

		// Validate with comparison
		const validationConfig = await loadValidationConfig(env.CONFIG);
		const validationResult = await compareWithProduction(
			trainedModels,
			productionModels,
			testDataset,
			validationConfig
		);

		const logLevel = validationResult.passed ? 'info' : 'warn';
		logger[logLevel]({
			event: validationResult.passed ? 'validation_passed' : 'validation_failed',
			model_version: trainedModels.version,
			recommendation: validationResult.recommendation,
			accuracy: validationResult.metrics.accuracy,
			precision: validationResult.metrics.precision,
			recall: validationResult.metrics.recall,
			f1_score: validationResult.metrics.f1Score,
			false_positive_rate: validationResult.metrics.falsePositiveRate,
			issues: validationResult.issues,
			comparison: validationResult.comparisonWithProduction,
		}, `Validation ${validationResult.passed ? 'PASSED' : 'FAILED'}: ${validationResult.recommendation}`);

		// Save models based on validation
		if (validationResult.recommendation === 'deploy') {
			logger.info({
				event: 'canary_deployment_started',
				model_version: trainedModels.version,
			}, 'Auto-deploying to canary...');
			await deployToCanary(env.CONFIG, trainedModels, validationResult);

			// Create A/B test for canary
			const abTestConfig = await createABTestForModels(
				env.CONFIG,
				trainedModels,
				validationResult,
				autoABConfig
			);

			if (abTestConfig) {
				logger.info({
					event: 'ab_test_created',
					experiment_id: abTestConfig.experimentId,
					auto_promote: autoABConfig.autoPromote,
				}, 'A/B test created successfully');
			}
		} else if (validationResult.recommendation === 'manual_review') {
			logger.warn({
				event: 'model_requires_review',
				model_version: trainedModels.version,
			}, 'Requires manual review before deployment');
			await saveForReview(env.CONFIG, trainedModels, validationResult);
		} else {
			logger.warn({
				event: 'model_rejected',
				model_version: trainedModels.version,
				reasons: validationResult.issues,
			}, 'Models rejected - not deploying');
		}

		// Update latest training metadata
		await env.CONFIG.put(
			'latest_training',
			JSON.stringify({
				...trainedModels.metadata,
				validation: validationResult.metrics,
				recommendation: validationResult.recommendation,
			})
		);
		logger.info({
			event: 'metadata_updated',
			key: 'latest_training',
		}, 'Updated latest training metadata');

		// Store training history
		const historyKey = `training_history_${trainedModels.version}`;
		await env.CONFIG.put(
			historyKey,
			JSON.stringify({
				...trainedModels.metadata,
				version: trainedModels.version,
				createdAt: trainedModels.createdAt,
			})
		);
		logger.info({
			event: 'history_saved',
			key: historyKey,
			model_version: trainedModels.version,
		}, 'Saved training history');

		logger.info({
			event: 'training_pipeline_completed',
			model_version: trainedModels.version,
			recommendation: validationResult.recommendation,
		}, 'Automated training completed successfully');
	} catch (error) {
		logger.error({
			event: 'training_pipeline_failed',
			error: error instanceof Error ? {
				message: error.message,
				stack: error.stack,
				name: error.name,
			} : String(error),
		}, 'Training Worker Failed');

		// Store error in KV for monitoring
		await env.CONFIG.put(
			'last_training_error',
			JSON.stringify({
				timestamp: new Date().toISOString(),
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			})
		);

		throw error; // Re-throw so Cloudflare marks the execution as failed
	}
}

/**
 * HTTP handler for manual triggering via API
 */
export async function fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const url = new URL(request.url);

	// Only allow POST requests to /train
	if (url.pathname !== '/train' || request.method !== 'POST') {
		return new Response('Not Found', { status: 404 });
	}

	// Simple auth check (optional - configure in wrangler.toml secrets)
	const authHeader = request.headers.get('Authorization');
	const expectedAuth = env.TRAINING_AUTH_TOKEN || 'default-secret';

	if (authHeader !== `Bearer ${expectedAuth}`) {
		return new Response('Unauthorized', { status: 401 });
	}

	logger.info({
		event: 'manual_training_triggered',
		trigger: 'api',
	}, 'Manual Training Triggered via API');

	try {
		// Parse optional request body for custom config
		let trainingConfig = DEFAULT_TRAINING_CONFIG;

		if (request.headers.get('Content-Type') === 'application/json') {
			const body = await request.json();
			trainingConfig = {
				orders: body.orders || DEFAULT_TRAINING_CONFIG.orders,
				adaptationRate: body.adaptationRate || DEFAULT_TRAINING_CONFIG.adaptationRate,
				minSamplesPerClass:
					body.minSamplesPerClass || DEFAULT_TRAINING_CONFIG.minSamplesPerClass,
			};
		}

		const days = 7; // Default to last 7 days

		// Run training pipeline
		const trainedModels = await runTrainingPipeline(env.CONFIG, trainingConfig, days);

		// Update metadata
		await env.CONFIG.put('latest_training', JSON.stringify(trainedModels.metadata));

		return new Response(
			JSON.stringify({
				success: true,
				version: trainedModels.version,
				metadata: trainedModels.metadata,
			}),
			{
				headers: { 'Content-Type': 'application/json' },
			}
		);
	} catch (error) {
		logger.error({
			event: 'manual_training_failed',
			error: error instanceof Error ? {
				message: error.message,
				stack: error.stack,
			} : String(error),
		}, 'Manual training failed');

		return new Response(
			JSON.stringify({
				success: false,
				error: error instanceof Error ? error.message : String(error),
			}),
			{
				status: 500,
				headers: { 'Content-Type': 'application/json' },
			}
		);
	}
}

/**
 * Load production models for comparison
 */
async function loadProductionModels(kv: KVNamespace): Promise<TrainedModels | null> {
	try {
		// Try to load current production models
		const productionVersion = await kv.get('production_model_version');
		if (!productionVersion) {
			return null;
		}

		// Load models for this version
		const models: any = {};

		for (const order of [1, 2, 3]) {
			const legitKey = `MM_legit_${order}gram_${productionVersion}`;
			const fraudKey = `MM_fraud_${order}gram_${productionVersion}`;

			const legitData = await kv.get(legitKey, 'json');
			const fraudData = await kv.get(fraudKey, 'json');

			if (!legitData || !fraudData) {
				logger.warn({
					event: 'production_model_missing',
					order,
					production_version: productionVersion,
				}, `Missing ${order}-gram models for production version`);
				continue;
			}

			const { NGramMarkovChain } = await import('../detectors/ngram-markov');
			models[order] = {
				legit: NGramMarkovChain.fromJSON(legitData),
				fraud: NGramMarkovChain.fromJSON(fraudData),
			};
		}

		if (Object.keys(models).length === 0) {
			return null;
		}

		return {
			version: productionVersion,
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
		logger.error({
			event: 'production_models_load_failed',
			error: error instanceof Error ? {
				message: error.message,
				stack: error.stack,
			} : String(error),
		}, 'Failed to load production models');
		return null;
	}
}

/**
 * Load validation configuration from KV
 */
async function loadValidationConfig(kv: KVNamespace): Promise<ValidationConfig> {
	try {
		const config = await kv.get<ValidationConfig>('validation_config', 'json');
		return config || DEFAULT_VALIDATION_CONFIG;
	} catch (error) {
		return DEFAULT_VALIDATION_CONFIG;
	}
}

/**
 * Deploy models to canary (10% traffic)
 */
async function deployToCanary(
	kv: KVNamespace,
	trainedModels: TrainedModels,
	validationResult: any
): Promise<void> {
	// Save models with canary keys
	const { version, models } = trainedModels;

	for (const [order, orderModels] of Object.entries(models)) {
		const legitKey = `MM_legit_${order}gram_canary`;
		const fraudKey = `MM_fraud_${order}gram_canary`;

		await kv.put(legitKey, JSON.stringify(orderModels.legit.toJSON()));
		await kv.put(fraudKey, JSON.stringify(orderModels.fraud.toJSON()));
	}

	// Save canary metadata
	await kv.put(
		'canary_model_metadata',
		JSON.stringify({
			version,
			deployedAt: new Date().toISOString(),
			trafficPercent: 10,
			validation: validationResult.metrics,
			status: 'active',
		})
	);

	logger.info({
		event: 'canary_deployment_completed',
		model_version: version,
		traffic_percent: 10,
	}, 'Models deployed to canary');
}

/**
 * Save models for manual review
 */
async function saveForReview(
	kv: KVNamespace,
	trainedModels: TrainedModels,
	validationResult: any
): Promise<void> {
	// Save with review keys
	const { version, models } = trainedModels;

	for (const [order, orderModels] of Object.entries(models)) {
		const legitKey = `MM_legit_${order}gram_review_${version}`;
		const fraudKey = `MM_fraud_${order}gram_review_${version}`;

		await kv.put(legitKey, JSON.stringify(orderModels.legit.toJSON()));
		await kv.put(fraudKey, JSON.stringify(orderModels.fraud.toJSON()));
	}

	// Save review metadata
	await kv.put(
		`model_review_${version}`,
		JSON.stringify({
			version,
			createdAt: new Date().toISOString(),
			validation: validationResult.metrics,
			issues: validationResult.issues,
			status: 'pending_review',
		})
	);

	logger.info({
		event: 'models_saved_for_review',
		model_version: version,
	}, 'Models saved for manual review');
}

/**
 * Load auto A/B testing configuration from KV
 */
async function loadAutoABConfig(kv: KVNamespace): Promise<AutoABConfig> {
	try {
		const config = await kv.get<AutoABConfig>('auto_ab_config', 'json');
		return config || DEFAULT_AUTO_AB_CONFIG;
	} catch (error) {
		return DEFAULT_AUTO_AB_CONFIG;
	}
}
