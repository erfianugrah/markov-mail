/**
 * Random Forest Model Loader and Evaluator
 *
 * Loads JSON-exported Random Forest models from KV and evaluates them using
 * the forest inference engine. Designed for edge deployment with caching.
 */

import { logger } from '../logger';
import {
	predictForestScore,
	validateForestModel,
	type ForestModel,
	type ForestCalibrationMeta,
} from '../detectors/forest-engine';

type PrimitiveValue = number | string | boolean | null | undefined;

export interface RandomForestEvaluation {
	score: number;
	reason: string;
	modelVersion: string;
}

const KV_RANDOM_FOREST_KEY = 'random_forest.json';
const FOREST_CACHE_TTL_MS = 60_000; // Refresh every minute to allow hot swaps

let cachedForest: ForestModel | null = null;
let cachedForestVersion = 'unavailable';
let lastLoadedAt = 0;

/**
 * Loads the Random Forest model from KV.
 * Uses caching to avoid repeated KV reads.
 *
 * @param env - Cloudflare Worker environment with CONFIG KV binding
 * @param options - Optional force reload flag
 * @returns True if model loaded successfully
 */
export async function loadRandomForestModel(env: Env, options: { force?: boolean } = {}): Promise<boolean> {
	const now = Date.now();
	const cacheFresh = lastLoadedAt > 0 && now - lastLoadedAt < FOREST_CACHE_TTL_MS;

	if (!options.force && cacheFresh) {
		return cachedForest !== null;
	}

	lastLoadedAt = now;

	if (!env.CONFIG) {
		cachedForest = null;
		cachedForestVersion = 'unavailable';
		return false;
	}

	try {
		// Load model from KV
		const forestJson = await env.CONFIG.get<ForestModel | null>(KV_RANDOM_FOREST_KEY, 'json');

		if (!forestJson) {
			cachedForest = null;
			cachedForestVersion = 'unavailable';
			logger.warn({
				event: 'random_forest_not_found',
				key: KV_RANDOM_FOREST_KEY,
			}, 'Random Forest model not found in KV');
			return false;
		}

		// Validate model structure
		if (!validateForestModel(forestJson)) {
			cachedForest = null;
			cachedForestVersion = 'unavailable';
			logger.error({
				event: 'random_forest_invalid',
				key: KV_RANDOM_FOREST_KEY,
			}, 'Invalid Random Forest model structure');
			return false;
		}

		cachedForest = forestJson;
		cachedForestVersion = forestJson.meta.version || 'unknown';

		logger.info({
			event: 'random_forest_loaded',
			version: cachedForestVersion,
			treeCount: forestJson.meta.tree_count,
			features: forestJson.meta.features.length,
		}, 'Random Forest model loaded successfully');

		return true;
	} catch (error) {
		cachedForest = null;
		cachedForestVersion = 'unavailable';
		logger.error({
			event: 'random_forest_load_failed',
			message: error instanceof Error ? error.message : String(error),
		}, 'Failed to load Random Forest from KV');
		return false;
	}
}

/**
 * Get the currently cached Random Forest model
 */
export function getRandomForestModel(): ForestModel | null {
	return cachedForest;
}

/**
 * Get the version string of the currently loaded model
 */
export function getRandomForestVersion(): string {
	return cachedForestVersion;
}

/**
 * Clear the cached model (useful for testing or forcing reload)
 */
export function clearRandomForestCache(): void {
	cachedForest = null;
	cachedForestVersion = 'unavailable';
	lastLoadedAt = 0;
}

/**
 * Evaluate a feature vector using the Random Forest model
 *
 * @param features - Feature vector as key-value pairs
 * @returns Evaluation result with score, reason, and version
 */
export function evaluateRandomForest(
	features: Record<string, PrimitiveValue>
): RandomForestEvaluation | null {
	if (!cachedForest) {
		return null;
	}

	// Convert features to numeric format (forest engine expects numbers)
	const numericFeatures: Record<string, number> = {};
	for (const [key, value] of Object.entries(features)) {
		if (typeof value === 'number') {
			numericFeatures[key] = value;
		} else if (typeof value === 'boolean') {
			numericFeatures[key] = value ? 1 : 0;
		} else if (typeof value === 'string') {
			// Try to parse string as number
			const parsed = parseFloat(value);
			numericFeatures[key] = isNaN(parsed) ? 0 : parsed;
		} else {
			// Null/undefined default to 0
			numericFeatures[key] = 0;
		}
	}

	try {
		const rawScore = predictForestScore(cachedForest, numericFeatures);
		const calibratedScore = applyCalibration(rawScore, cachedForest.meta?.calibration);

		return {
			score: clampScore(calibratedScore),
			reason: `forest_v${cachedForestVersion}`,
			modelVersion: cachedForestVersion,
		};
	} catch (error) {
		logger.error({
			event: 'random_forest_evaluation_failed',
			message: error instanceof Error ? error.message : String(error),
		}, 'Random Forest evaluation failed');
		return null;
	}
}

/**
 * Clamp score to valid probability range [0, 1]
 */
function clampScore(score: number): number {
	if (!Number.isFinite(score)) return 0;
	if (score < 0) return 0;
	if (score > 1) return 1;
	return score;
}

function applyCalibration(score: number, calibration?: ForestCalibrationMeta): number {
	if (!calibration) {
		return score;
	}

	const { intercept, coef } = calibration;
	if (!Number.isFinite(intercept) || !Number.isFinite(coef)) {
		return score;
	}

	const linear = intercept + coef * score;
	const logistic = 1 / (1 + Math.exp(-linear));
	return logistic;
}
