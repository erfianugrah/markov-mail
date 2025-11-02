/**
 * Configuration Loader
 *
 * Loads configuration from multiple sources with the following priority:
 * 1. Worker Secrets (highest priority - sensitive data)
 * 2. KV Configuration (runtime-editable via admin API)
 * 3. Default Configuration (lowest priority - hardcoded)
 *
 * Configuration is cached in memory for the duration of the Worker's lifetime.
 */

import { DEFAULT_CONFIG, validateConfig, type FraudDetectionConfig } from './defaults';
import { logger } from '../logger';

const CONFIG_KEY = 'config.json';
const CACHE_DURATION_MS = 60000; // Cache for 1 minute

// In-memory cache
let cachedConfig: FraudDetectionConfig | null = null;
let cacheTimestamp: number = 0;

/**
 * Deep merge two objects
 */
function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
	const output = { ...target };

	for (const key in source) {
		const sourceValue = source[key];
		if (sourceValue !== null && typeof sourceValue === 'object' && !Array.isArray(sourceValue) && key in target) {
			output[key] = deepMerge(target[key] as any, sourceValue as any);
		} else if (sourceValue !== undefined) {
			output[key] = sourceValue as any;
		}
	}

	return output;
}

/**
 * Load configuration from KV
 */
async function loadFromKV(kv: KVNamespace): Promise<Partial<FraudDetectionConfig> | null> {
	try {
		const configJson = await kv.get<Partial<FraudDetectionConfig>>(CONFIG_KEY, {
			type: 'json',
		});

		if (!configJson) {
			logger.info({
				event: 'config_not_found',
				source: 'kv',
			}, 'No configuration found in KV, using defaults');
			return null;
		}

		// Validate the loaded configuration
		const validation = validateConfig(configJson);
		if (!validation.valid) {
			logger.error({
				event: 'config_invalid',
				source: 'kv',
				errors: validation.errors,
			}, 'Invalid configuration in KV');
			return null;
		}

		logger.info({
			event: 'config_loaded',
			source: 'kv',
		}, 'Loaded configuration from KV');
		return configJson;
	} catch (error) {
		logger.error({
			event: 'config_load_failed',
			source: 'kv',
			error: error instanceof Error ? {
				message: error.message,
				stack: error.stack,
				name: error.name,
			} : String(error),
		}, 'Error loading configuration from KV');
		return null;
	}
}

/**
 * Load configuration with caching
 */
export async function loadConfig(kv: KVNamespace, secrets?: Record<string, string | undefined>): Promise<FraudDetectionConfig> {
	// Check cache
	const now = Date.now();
	if (cachedConfig && now - cacheTimestamp < CACHE_DURATION_MS) {
		return cachedConfig;
	}

	// Start with defaults
	let config: FraudDetectionConfig = { ...DEFAULT_CONFIG };

	// Load from KV and merge
	const kvConfig = await loadFromKV(kv);
	if (kvConfig) {
		config = deepMerge(config, kvConfig);
	}

	// Override with secrets (if provided)
	if (secrets) {
		// Admin API secret
		if (secrets.ADMIN_API_KEY) {
			config.admin.enabled = true;
		}

		// Origin URL secret (if forwarding is enabled)
		if (secrets.ORIGIN_URL) {
			config.headers.originUrl = secrets.ORIGIN_URL;
		}
	}

	// Cache the merged configuration
	cachedConfig = config;
	cacheTimestamp = now;

	return config;
}

/**
 * Save configuration to KV
 */
export async function saveConfig(
	kv: KVNamespace,
	config: Partial<FraudDetectionConfig>
): Promise<{ success: boolean; errors?: string[] }> {
	// Validate configuration
	const validation = validateConfig(config);
	if (!validation.valid) {
		return {
			success: false,
			errors: validation.errors,
		};
	}

	try {
		// Save to KV
		await kv.put(CONFIG_KEY, JSON.stringify(config, null, 2));

		// Invalidate cache
		cachedConfig = null;
		cacheTimestamp = 0;

		logger.info({
			event: 'config_saved',
			destination: 'kv',
		}, 'Saved configuration to KV');
		return { success: true };
	} catch (error) {
		logger.error({
			event: 'config_save_failed',
			destination: 'kv',
			error: error instanceof Error ? {
				message: error.message,
				stack: error.stack,
				name: error.name,
			} : String(error),
		}, 'Error saving configuration to KV');
		return {
			success: false,
			errors: [error instanceof Error ? error.message : 'Unknown error'],
		};
	}
}

/**
 * Get the current configuration (load if not cached)
 */
export async function getConfig(kv: KVNamespace, secrets?: Record<string, string | undefined>): Promise<FraudDetectionConfig> {
	return loadConfig(kv, secrets);
}

/**
 * Clear the configuration cache (useful for testing or forced reload)
 */
export function clearConfigCache(): void {
	cachedConfig = null;
	cacheTimestamp = 0;
	logger.info({
		event: 'config_cache_cleared',
	}, 'Configuration cache cleared');
}

/**
 * Get the current cached configuration (without loading from KV)
 * Returns null if no configuration is cached
 */
export function getCachedConfig(): FraudDetectionConfig | null {
	const now = Date.now();
	if (cachedConfig && now - cacheTimestamp < CACHE_DURATION_MS) {
		return cachedConfig;
	}
	return null;
}

/**
 * Initialize configuration (call once at worker startup)
 * This pre-loads and caches the configuration
 */
export async function initConfig(kv: KVNamespace, secrets?: Record<string, string | undefined>): Promise<FraudDetectionConfig> {
	logger.info({
		event: 'config_init',
	}, 'Initializing configuration system');
	return loadConfig(kv, secrets);
}
