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
 */
export function trainModels(
	legitSamples: string[],
	fraudSamples: string[],
	config: TrainingConfig
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

		// Train legitimate model
		const legitModel = new NGramMarkovChain(order);
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
		}, 'Legitimate model trained');

		// Train fraud model
		const fraudModel = new NGramMarkovChain(order);
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
		}, 'Fraud model trained');

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
 * Save trained models to KV with versioning
 */
export async function saveTrainedModels(
	kv: KVNamespace,
	trainedModels: TrainedModels
): Promise<void> {
	const { version, models } = trainedModels;

	// Save each model with versioned key
	for (const [order, { legit, fraud }] of Object.entries(models)) {
		const legitKey = `MM_legit_${order}gram_${version}`;
		const fraudKey = `MM_fraud_${order}gram_${version}`;

		await kv.put(legitKey, JSON.stringify(legit.toJSON()));
		await kv.put(fraudKey, JSON.stringify(fraud.toJSON()));

		logger.info({
			event: 'models_saved',
			order,
			legit_key: legitKey,
			fraud_key: fraudKey,
		}, 'Saved models to KV');
	}

	// Save metadata
	const metadataKey = `model_metadata_${version}`;
	await kv.put(metadataKey, JSON.stringify(trainedModels.metadata));
	logger.info({
		event: 'model_metadata_saved',
		metadata_key: metadataKey,
	}, 'Saved model metadata');
}

/**
 * Complete training pipeline
 */
export async function runTrainingPipeline(
	kv: KVNamespace,
	config: TrainingConfig,
	days: number = 7
): Promise<TrainedModels> {
	logger.info({
		event: 'training_pipeline_started',
		orders: config.orders,
		days,
		min_samples_per_class: config.minSamplesPerClass,
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

	// Step 2: Train models
	logger.info({
		event: 'model_training',
	}, 'Training models');
	const models = trainModels(legit, fraud, config);

	const trainingDuration = Date.now() - startTime;

	// Step 3: Package results
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

	// Step 4: Save models
	logger.info({
		event: 'models_saving',
	}, 'Saving trained models');
	await saveTrainedModels(kv, trainedModels);

	logger.info({
		event: 'training_pipeline_complete',
		version,
		duration_ms: trainingDuration,
		duration_seconds: (trainingDuration / 1000).toFixed(1),
	}, 'Training complete');

	return trainedModels;
}
