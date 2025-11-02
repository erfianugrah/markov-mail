/**
 * A/B Test Configuration Loader
 *
 * Loads experiment configuration from Workers KV.
 * Supports runtime updates without redeployment.
 */

import { logger } from '../logger';
import type { ABTestConfig } from './types';
import { isExperimentActive } from './assignment';

const AB_TEST_KV_KEY = 'ab_test_config';

/**
 * Load active A/B test configuration from KV
 *
 * Returns null if no active experiment is configured
 */
export async function loadABTestConfig(kvNamespace: KVNamespace): Promise<ABTestConfig | null> {
	try {
		const configJson = await kvNamespace.get(AB_TEST_KV_KEY, 'text');

		if (!configJson) {
			return null;
		}

		const config = JSON.parse(configJson) as ABTestConfig;

		// Check if experiment is active
		if (!isExperimentActive(config)) {
			return null;
		}

		return config;
	} catch (error) {
		logger.error({
			event: 'ab_test_config_load_failed',
			error: error instanceof Error ? {
				message: error.message,
				stack: error.stack,
			} : String(error),
		}, 'Failed to load A/B test config from KV');
		return null;
	}
}

/**
 * Save A/B test configuration to KV
 *
 * Used by admin API to create/update experiments
 */
export async function saveABTestConfig(kvNamespace: KVNamespace, config: ABTestConfig): Promise<void> {
	try {
		const configJson = JSON.stringify(config, null, 2);
		await kvNamespace.put(AB_TEST_KV_KEY, configJson);
	} catch (error) {
		logger.error({
			event: 'ab_test_config_save_failed',
			error: error instanceof Error ? {
				message: error.message,
				stack: error.stack,
			} : String(error),
		}, 'Failed to save A/B test config to KV');
		throw new Error('Failed to save experiment configuration');
	}
}

/**
 * Delete A/B test configuration from KV
 *
 * Used to stop an experiment
 */
export async function deleteABTestConfig(kvNamespace: KVNamespace): Promise<void> {
	try {
		await kvNamespace.delete(AB_TEST_KV_KEY);
	} catch (error) {
		logger.error({
			event: 'ab_test_config_delete_failed',
			error: error instanceof Error ? {
				message: error.message,
				stack: error.stack,
			} : String(error),
		}, 'Failed to delete A/B test config from KV');
		throw new Error('Failed to delete experiment configuration');
	}
}

/**
 * Get experiment status (for monitoring)
 */
export async function getExperimentStatus(
	kvNamespace: KVNamespace
): Promise<{
	hasExperiment: boolean;
	isActive: boolean;
	config?: ABTestConfig;
}> {
	try {
		const configJson = await kvNamespace.get(AB_TEST_KV_KEY, 'text');

		if (!configJson) {
			return { hasExperiment: false, isActive: false };
		}

		const config = JSON.parse(configJson) as ABTestConfig;
		const isActive = isExperimentActive(config);

		return {
			hasExperiment: true,
			isActive,
			config: isActive ? config : undefined,
		};
	} catch (error) {
		logger.error({
			event: 'experiment_status_failed',
			error: error instanceof Error ? {
				message: error.message,
				stack: error.stack,
			} : String(error),
		}, 'Failed to get experiment status');
		return { hasExperiment: false, isActive: false };
	}
}
