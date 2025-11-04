/**
 * Model Training Utilities for Continuous Learning
 *
 * Handles automated training of Markov models from labeled datasets
 */

import { NGramMarkovChain } from '../detectors/ngram-markov';
import type { TrainingDataset, TrainingSample } from './types';
import { logger } from '../logger';

export interface TrainingConfig {
	orders: number[]; // N-gram orders to train (1, 2, 3)
	adaptationRate: number; // Adaptive training rate
	minSamplesPerClass: number; // Minimum samples required
}

export interface TrainedModels {
	version: string;
	createdAt: string;
	models: {
		[order: number]: {
			legit: NGramMarkovChain;
			fraud: NGramMarkovChain;
		};
	};
	metadata: {
		trainingSamples: {
			legit: number;
			fraud: number;
			total: number;
		};
		trainingDuration: number; // milliseconds
		datasetDates: string[];
		orders: number[];
	};
}

/**
 * Load training datasets from KV for the last N days
 */
export async function loadTrainingDatasets(
	kv: KVNamespace,
	days: number
): Promise<{ legit: string[]; fraud: string[]; dates: string[] }> {
	const allLegit: string[] = [];
	const allFraud: string[] = [];
	const dates: string[] = [];

	for (let i = 0; i < days; i++) {
		const date = new Date();
		date.setDate(date.getDate() - i);
		const dateStr = date.toISOString().split('T')[0];
		const key = `training_data_${dateStr}`;

		try {
			const data = await kv.get<TrainingDataset>(key, 'json');
			if (data) {
				// Extract local parts from samples
				const legitLocalParts = data.samples.legit.map((s) => s.localPart);
				const fraudLocalParts = data.samples.fraud.map((s) => s.localPart);

				allLegit.push(...legitLocalParts);
				allFraud.push(...fraudLocalParts);
				dates.push(dateStr);

				logger.info({
					event: 'training_dataset_loaded',
					key,
					legit_count: legitLocalParts.length,
					fraud_count: fraudLocalParts.length,
				}, 'Loaded training dataset');
			}
		} catch (error) {
			logger.warn({
				event: 'training_dataset_load_failed',
				key,
				error: error instanceof Error ? {
					message: error.message,
					stack: error.stack,
					name: error.name,
				} : String(error),
			}, 'Failed to load training dataset');
		}
	}

	return { legit: allLegit, fraud: allFraud, dates };
}

/**
 * Train models for specified n-gram orders
 * If existingModels are provided, training continues incrementally on those models
 */
export function trainModels(
	legitSamples: string[],
	fraudSamples: string[],
	config: TrainingConfig,
	existingModels?: {
		[order: number]: {
			legit: NGramMarkovChain;
			fraud: NGramMarkovChain;
		};
	}
): {
	[order: number]: {
		legit: NGramMarkovChain;
		fraud: NGramMarkovChain;
	};
} {
	const models: {
		[order: number]: {
			legit: NGramMarkovChain;
			fraud: NGramMarkovChain;
		};
	} = {};

	for (const order of config.orders) {
		logger.info({
			event: 'model_training_started',
			order,
		}, 'Training n-gram models');

		// Load existing model or create new one
		const legitModel = existingModels?.[order]?.legit || new NGramMarkovChain(order);
		const previousLegitCount = legitModel.getStats().trainingExamples;

		let trained = 0;
		for (const sample of legitSamples) {
			if (legitModel.train(sample, config.adaptationRate)) {
				trained++;
			}
		}
		logger.info({
			event: 'legit_model_trained',
			order,
			samples_used: trained,
			total_samples: legitSamples.length,
			previous_training_count: previousLegitCount,
			new_training_count: legitModel.getStats().trainingExamples,
		}, existingModels ? 'Legitimate model updated incrementally' : 'Legitimate model trained');

		// Load existing model or create new one
		const fraudModel = existingModels?.[order]?.fraud || new NGramMarkovChain(order);
		const previousFraudCount = fraudModel.getStats().trainingExamples;

		trained = 0;
		for (const sample of fraudSamples) {
			if (fraudModel.train(sample, config.adaptationRate)) {
				trained++;
			}
		}
		logger.info({
			event: 'fraud_model_trained',
			order,
			samples_used: trained,
			total_samples: fraudSamples.length,
			previous_training_count: previousFraudCount,
			new_training_count: fraudModel.getStats().trainingExamples,
		}, existingModels ? 'Fraud model updated incrementally' : 'Fraud model trained');

		models[order] = {
			legit: legitModel,
			fraud: fraudModel,
		};
	}

	return models;
}

/**
 * Generate version identifier
 */
export function generateVersion(): string {
	const now = new Date();
	const year = now.getUTCFullYear();
	const month = String(now.getUTCMonth() + 1).padStart(2, '0');
	const day = String(now.getUTCDate()).padStart(2, '0');
	const hour = String(now.getUTCHours()).padStart(2, '0');
	const minute = String(now.getUTCMinutes()).padStart(2, '0');
	const second = String(now.getUTCSeconds()).padStart(2, '0');

	return `${year}${month}${day}_${hour}${minute}${second}`;
}

/**
 * Save trained models to KV with versioning and backup
 */
export async function saveTrainedModels(
	kv: KVNamespace,
	trainedModels: TrainedModels,
	updateProduction: boolean = true
): Promise<void> {
	const { version, models } = trainedModels;

	// Step 1: Save versioned models (history)
	for (const [order, { legit, fraud }] of Object.entries(models)) {
		const legitKey = `MM_legit_${order}gram_${version}`;
		const fraudKey = `MM_fraud_${order}gram_${version}`;

		await kv.put(legitKey, JSON.stringify(legit.toJSON()));
		await kv.put(fraudKey, JSON.stringify(fraud.toJSON()));

		logger.info({
			event: 'versioned_models_saved',
			order,
			legit_key: legitKey,
			fraud_key: fraudKey,
		}, `Saved versioned ${order}-gram models`);
	}

	// Step 2: Save metadata for this version
	const metadataKey = `model_metadata_${version}`;
	await kv.put(metadataKey, JSON.stringify(trainedModels.metadata));
	logger.info({
		event: 'model_metadata_saved',
		metadata_key: metadataKey,
	}, 'Saved model metadata');

	// Step 3: Update production keys if requested
	if (updateProduction) {
		for (const [order, { legit, fraud }] of Object.entries(models)) {
			const productionLegitKey = `MM_legit_${order}gram`;
			const productionFraudKey = `MM_fraud_${order}gram`;

			// Backup current production models before replacing
			const currentLegit = await kv.get(productionLegitKey, 'json');
			const currentFraud = await kv.get(productionFraudKey, 'json');

			if (currentLegit && currentFraud) {
				const backupLegitKey = `MM_legit_${order}gram_backup`;
				const backupFraudKey = `MM_fraud_${order}gram_backup`;

				await kv.put(backupLegitKey, JSON.stringify(currentLegit));
				await kv.put(backupFraudKey, JSON.stringify(currentFraud));

				logger.info({
					event: 'production_models_backed_up',
					order,
					backup_legit_key: backupLegitKey,
					backup_fraud_key: backupFraudKey,
				}, `Backed up current production ${order}-gram models`);
			}

			// Update production keys
			await kv.put(productionLegitKey, JSON.stringify(legit.toJSON()));
			await kv.put(productionFraudKey, JSON.stringify(fraud.toJSON()));

			logger.info({
				event: 'production_models_updated',
				order,
				legit_key: productionLegitKey,
				fraud_key: productionFraudKey,
			}, `Updated production ${order}-gram models`);
		}

		// Update production version pointer
		await kv.put('production_model_version', version);
		logger.info({
			event: 'production_version_updated',
			version,
		}, 'Updated production model version');
	}
}

/**
 * Load production models from KV for incremental training
 */
export async function loadProductionModels(
	kv: KVNamespace,
	orders: number[]
): Promise<{
	[order: number]: {
		legit: NGramMarkovChain;
		fraud: NGramMarkovChain;
	};
} | null> {
	try {
		const models: {
			[order: number]: {
				legit: NGramMarkovChain;
				fraud: NGramMarkovChain;
			};
		} = {};

		for (const order of orders) {
			const legitKey = `MM_legit_${order}gram`;
			const fraudKey = `MM_fraud_${order}gram`;

			const legitData = await kv.get(legitKey, 'json');
			const fraudData = await kv.get(fraudKey, 'json');

			if (!legitData || !fraudData) {
				logger.info({
					event: 'production_model_not_found',
					order,
					legit_key: legitKey,
					fraud_key: fraudKey,
				}, `No production ${order}-gram models found - will train from scratch`);
				continue;
			}

			models[order] = {
				legit: NGramMarkovChain.fromJSON(legitData),
				fraud: NGramMarkovChain.fromJSON(fraudData),
			};

			logger.info({
				event: 'production_model_loaded',
				order,
				legit_training_count: models[order].legit.getStats().trainingExamples,
				fraud_training_count: models[order].fraud.getStats().trainingExamples,
			}, `Loaded production ${order}-gram models for incremental training`);
		}

		return Object.keys(models).length > 0 ? models : null;
	} catch (error) {
		logger.warn({
			event: 'production_models_load_failed',
			error: error instanceof Error ? error.message : String(error),
		}, 'Failed to load production models - will train from scratch');
		return null;
	}
}

/**
 * Complete training pipeline
 */
export async function runTrainingPipeline(
	kv: KVNamespace,
	config: TrainingConfig,
	days: number = 7,
	incremental: boolean = true
): Promise<TrainedModels> {
	logger.info({
		event: 'training_pipeline_started',
		orders: config.orders,
		days,
		min_samples_per_class: config.minSamplesPerClass,
		incremental,
	}, 'Starting automated training pipeline');

	const startTime = Date.now();

	// Step 1: Load training data
	logger.info({
		event: 'training_data_loading',
	}, 'Loading training datasets');
	const { legit, fraud, dates } = await loadTrainingDatasets(kv, days);

	if (legit.length < config.minSamplesPerClass) {
		throw new Error(
			`Insufficient legit samples: ${legit.length} < ${config.minSamplesPerClass}`
		);
	}

	if (fraud.length < config.minSamplesPerClass) {
		throw new Error(
			`Insufficient fraud samples: ${fraud.length} < ${config.minSamplesPerClass}`
		);
	}

	logger.info({
		event: 'training_data_loaded',
		legit_count: legit.length,
		fraud_count: fraud.length,
		total_count: legit.length + fraud.length,
		datasets: dates,
	}, 'Training datasets loaded');

	// Step 2: Load existing production models if incremental training is enabled
	let existingModels = null;
	if (incremental) {
		logger.info({
			event: 'loading_production_models',
		}, 'Loading existing production models for incremental training');
		existingModels = await loadProductionModels(kv, config.orders);
	}

	// Step 3: Train models (incrementally or from scratch)
	logger.info({
		event: 'model_training',
		mode: existingModels ? 'incremental' : 'from_scratch',
	}, existingModels ? 'Training models incrementally' : 'Training models from scratch');
	const models = trainModels(legit, fraud, config, existingModels || undefined);

	const trainingDuration = Date.now() - startTime;

	// Step 4: Package results
	const version = generateVersion();
	const trainedModels: TrainedModels = {
		version,
		createdAt: new Date().toISOString(),
		models,
		metadata: {
			trainingSamples: {
				legit: legit.length,
				fraud: fraud.length,
				total: legit.length + fraud.length,
			},
			trainingDuration,
			datasetDates: dates,
			orders: config.orders,
		},
	};

	// Step 5: Save models
	logger.info({
		event: 'models_saving',
	}, 'Saving trained models');
	await saveTrainedModels(kv, trainedModels);

	logger.info({
		event: 'training_pipeline_complete',
		version,
		duration_ms: trainingDuration,
		duration_seconds: (trainingDuration / 1000).toFixed(1),
		mode: existingModels ? 'incremental' : 'from_scratch',
	}, 'Training complete');

	return trainedModels;
}
