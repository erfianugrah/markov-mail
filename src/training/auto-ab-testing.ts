/**
 * Automatic A/B Test Creation
 *
 * Automatically creates A/B tests for validated models
 */

import type { TrainedModels } from './model-training';
import type { ValidationResult } from './model-validation';
import type { ABTestConfig } from '../ab-testing/types';
import { logger } from '../logger';

export interface AutoABConfig {
	enabled: boolean;
	canaryTrafficPercent: number; // Initial traffic % (default: 10)
	canaryDurationHours: number; // How long to run canary (default: 24)
	promotionThresholds: {
		minSampleSize: number; // Min samples before considering promotion
		maxPValueForSignificance: number; // Statistical significance threshold
		minImprovementPercent: number; // Min improvement to promote
	};
	autoPromote: boolean; // Auto-promote if thresholds met
}

export const DEFAULT_AUTO_AB_CONFIG: AutoABConfig = {
	enabled: true,
	canaryTrafficPercent: 10,
	canaryDurationHours: 24,
	promotionThresholds: {
		minSampleSize: 1000,
		maxPValueForSignificance: 0.05,
		minImprovementPercent: 1,
	},
	autoPromote: false, // Require manual promotion by default
};

/**
 * Create A/B test experiment for validated models
 */
export async function createABTestForModels(
	kv: KVNamespace,
	trainedModels: TrainedModels,
	validationResult: ValidationResult,
	config: AutoABConfig = DEFAULT_AUTO_AB_CONFIG
): Promise<ABTestConfig | null> {
	if (!config.enabled) {
		logger.info({
			event: 'ab_test_disabled',
		}, 'Auto A/B testing disabled');
		return null;
	}

	if (validationResult.recommendation !== 'deploy') {
		logger.info({
			event: 'ab_test_skipped',
			recommendation: validationResult.recommendation,
		}, 'Skipping A/B test creation');
		return null;
	}

	logger.info({
		event: 'ab_test_creation_started',
	}, 'Creating A/B Test Experiment');

	const experimentId = `model_${trainedModels.version}`;
	const endDate = new Date();
	endDate.setHours(endDate.getHours() + config.canaryDurationHours);

	const abTestConfig: ABTestConfig = {
		experimentId,
		description: `Auto-generated A/B test for model ${trainedModels.version}`,
		variants: {
			control: {
				weight: 100 - config.canaryTrafficPercent,
				description: 'Current production models',
				config: {
					// Use current production models (default behavior)
				},
			},
			treatment: {
				weight: config.canaryTrafficPercent,
				description: `New ensemble models (${trainedModels.version})`,
				config: {
					// Treatment will use canary models
					markovEnsembleEnabled: true,
				},
			},
		},
		startDate: new Date().toISOString(),
		endDate: endDate.toISOString(),
		enabled: true,
		metadata: {
			modelVersion: trainedModels.version,
			validationMetrics: validationResult.metrics,
			createdAt: new Date().toISOString(),
			createdBy: 'auto_ab_system',
			autoPromote: config.autoPromote,
			promotionThresholds: config.promotionThresholds,
		},
	};

	// Save A/B test configuration
	await kv.put('ab_test_config', JSON.stringify(abTestConfig));

	logger.info({
		event: 'ab_test_created',
		experiment_id: experimentId,
		control_percent: 100 - config.canaryTrafficPercent,
		treatment_percent: config.canaryTrafficPercent,
		duration_hours: config.canaryDurationHours,
		end_date: endDate.toISOString(),
	}, 'A/B test experiment created');

	// Save experiment metadata for monitoring
	await saveExperimentMetadata(kv, abTestConfig, trainedModels, validationResult);

	return abTestConfig;
}

/**
 * Save experiment metadata for tracking
 */
async function saveExperimentMetadata(
	kv: KVNamespace,
	abTestConfig: ABTestConfig,
	trainedModels: TrainedModels,
	validationResult: ValidationResult
): Promise<void> {
	const metadata = {
		experimentId: abTestConfig.experimentId,
		modelVersion: trainedModels.version,
		startDate: abTestConfig.startDate,
		endDate: abTestConfig.endDate,
		trafficSplit: {
			control: abTestConfig.variants.control.weight,
			treatment: abTestConfig.variants.treatment.weight,
		},
		validationMetrics: validationResult.metrics,
		status: 'active',
		createdAt: new Date().toISOString(),
	};

	await kv.put(`experiment_${abTestConfig.experimentId}`, JSON.stringify(metadata));
}

/**
 * Monitor active A/B test and auto-promote if thresholds met
 */
export async function monitorAndPromoteIfReady(
	kv: KVNamespace,
	config: AutoABConfig = DEFAULT_AUTO_AB_CONFIG
): Promise<{ promoted: boolean; reason: string }> {
	// Load active A/B test
	const abTestConfig = await kv.get<ABTestConfig>('ab_test_config', 'json');

	if (!abTestConfig || !abTestConfig.enabled) {
		return { promoted: false, reason: 'No active A/B test' };
	}

	// Check if auto-promotion is enabled
	if (!config.autoPromote) {
		return { promoted: false, reason: 'Auto-promotion disabled' };
	}

	logger.info({
		event: 'ab_test_monitoring_started',
		experiment_id: abTestConfig.experimentId,
	}, 'Monitoring A/B Test for Auto-Promotion');

	// Load experiment results from Analytics Engine
	// Note: This would query Analytics Engine for actual metrics
	// For now, we'll use a placeholder

	const results = await fetchExperimentResults(kv, abTestConfig.experimentId);

	if (!results) {
		return { promoted: false, reason: 'No results available yet' };
	}

	logger.info({
		event: 'ab_test_results_available',
		control_samples: results.control.sampleSize,
		treatment_samples: results.treatment.sampleSize,
	}, 'A/B test results available');

	// Check minimum sample size
	if (
		results.control.sampleSize < config.promotionThresholds.minSampleSize ||
		results.treatment.sampleSize < config.promotionThresholds.minSampleSize
	) {
		return {
			promoted: false,
			reason: `Insufficient samples (need ${config.promotionThresholds.minSampleSize})`,
		};
	}

	// Check statistical significance
	if (results.pValue > config.promotionThresholds.maxPValueForSignificance) {
		return {
			promoted: false,
			reason: `Not statistically significant (p=${results.pValue.toFixed(4)})`,
		};
	}

	// Check improvement
	const improvementPercent =
		((results.treatment.accuracy - results.control.accuracy) / results.control.accuracy) * 100;

	logger.info({
		event: 'ab_test_improvement_calculated',
		improvement_percent: improvementPercent,
	}, 'A/B test improvement calculated');

	if (improvementPercent < config.promotionThresholds.minImprovementPercent) {
		return {
			promoted: false,
			reason: `Improvement ${improvementPercent.toFixed(2)}% below threshold ${config.promotionThresholds.minImprovementPercent}%`,
		};
	}

	// All checks passed - promote!
	logger.info({
		event: 'ab_test_promotion_criteria_met',
	}, 'All promotion criteria met');
	await promoteToProduction(kv, abTestConfig);

	return { promoted: true, reason: 'Auto-promoted to production' };
}

/**
 * Fetch experiment results from Analytics Engine
 */
async function fetchExperimentResults(
	kv: KVNamespace,
	experimentId: string
): Promise<{
	control: { sampleSize: number; accuracy: number };
	treatment: { sampleSize: number; accuracy: number };
	pValue: number;
} | null> {
	// This is a placeholder - in production would query Analytics Engine
	// For now, return null to indicate no results yet
	return null;
}

/**
 * Promote canary models to production
 */
async function promoteToProduction(kv: KVNamespace, abTestConfig: ABTestConfig): Promise<void> {
	logger.info({
		event: 'production_promotion_started',
	}, 'Promoting to Production');

	const modelVersion = abTestConfig.metadata?.modelVersion;
	if (!modelVersion) {
		throw new Error('Model version not found in A/B test metadata');
	}

	// Copy canary models to production keys
	for (const order of [1, 2, 3]) {
		const canaryLegitKey = `MM_legit_${order}gram_canary`;
		const canaryFraudKey = `MM_fraud_${order}gram_canary`;

		const productionLegitKey = `MM_legit_${order}gram_production`;
		const productionFraudKey = `MM_fraud_${order}gram_production`;

		const legitModel = await kv.get(canaryLegitKey);
		const fraudModel = await kv.get(canaryFraudKey);

		if (legitModel && fraudModel) {
			await kv.put(productionLegitKey, legitModel);
			await kv.put(productionFraudKey, fraudModel);
			logger.info({
				event: 'models_promoted',
				order,
			}, 'Promoted models to production');
		}
	}

	// Update production version pointer
	await kv.put('production_model_version', modelVersion);

	// Disable A/B test
	abTestConfig.enabled = false;
	await kv.put('ab_test_config', JSON.stringify(abTestConfig));

	// Save promotion history
	await kv.put(
		`promotion_${modelVersion}`,
		JSON.stringify({
			modelVersion,
			promotedAt: new Date().toISOString(),
			experimentId: abTestConfig.experimentId,
			promotedBy: 'auto_promotion_system',
		})
	);

	logger.info({
		event: 'production_promotion_complete',
		model_version: modelVersion,
		experiment_id: abTestConfig.experimentId,
	}, 'Production promotion complete');
}

/**
 * Check if A/B test has expired and should be evaluated
 */
export async function checkExperimentExpiry(kv: KVNamespace): Promise<{
	expired: boolean;
	action: 'promote' | 'rollback' | 'extend' | 'none';
	reason: string;
}> {
	const abTestConfig = await kv.get<ABTestConfig>('ab_test_config', 'json');

	if (!abTestConfig || !abTestConfig.enabled) {
		return { expired: false, action: 'none', reason: 'No active experiment' };
	}

	const endDate = new Date(abTestConfig.endDate);
	const now = new Date();

	if (now < endDate) {
		return { expired: false, action: 'none', reason: 'Experiment still running' };
	}

	logger.info({
		event: 'ab_test_expired',
		experiment_id: abTestConfig.experimentId,
		end_date: abTestConfig.endDate,
	}, 'A/B Test Expired - Evaluation Required');

	// Load experiment results
	const results = await fetchExperimentResults(kv, abTestConfig.experimentId);

	if (!results) {
		return {
			expired: true,
			action: 'rollback',
			reason: 'No results available - rolling back',
		};
	}

	// Determine action based on results
	const improvementPercent =
		((results.treatment.accuracy - results.control.accuracy) / results.control.accuracy) * 100;

	if (improvementPercent >= 1 && results.pValue < 0.05) {
		return {
			expired: true,
			action: 'promote',
			reason: `Significant improvement: ${improvementPercent.toFixed(2)}%`,
		};
	} else if (improvementPercent < -2) {
		return {
			expired: true,
			action: 'rollback',
			reason: `Performance regression: ${improvementPercent.toFixed(2)}%`,
		};
	} else {
		return {
			expired: true,
			action: 'extend',
			reason: 'Inconclusive results - consider extending',
		};
	}
}

/**
 * Rollback canary deployment
 */
export async function rollbackCanary(kv: KVNamespace, reason: string): Promise<void> {
	logger.info({
		event: 'canary_rollback_started',
		reason,
	}, 'Rolling Back Canary Deployment');

	// Disable A/B test
	const abTestConfig = await kv.get<ABTestConfig>('ab_test_config', 'json');
	if (abTestConfig) {
		abTestConfig.enabled = false;
		await kv.put('ab_test_config', JSON.stringify(abTestConfig));
	}

	// Delete canary models
	for (const order of [1, 2, 3]) {
		await kv.delete(`MM_legit_${order}gram_canary`);
		await kv.delete(`MM_fraud_${order}gram_canary`);
	}

	await kv.delete('canary_model_metadata');

	logger.info({
		event: 'canary_rollback_complete',
		reason,
	}, 'Rollback complete');
}
