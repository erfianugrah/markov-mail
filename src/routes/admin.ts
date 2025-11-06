/**
 * Admin API Routes
 *
 * Protected endpoints for configuration management
 */

import { Hono } from 'hono';
import { requireApiKey } from '../middleware/auth';
import { getConfig, saveConfig, clearConfigCache, DEFAULT_CONFIG, validateConfig } from '../config';
import type { FraudDetectionConfig } from '../config';
import { retrainMarkovModels } from '../training/online-learning';
import { logger } from '../logger';
import { updateDisposableDomains, getDisposableDomainMetadata, clearDomainCache } from '../services/disposable-domain-updater';
import { updateTLDRiskProfiles, getTLDRiskMetadata, clearTLDCache, getTLDRiskProfile, updateSingleTLDProfile } from '../services/tld-risk-updater';
import { getAllTLDProfiles, getTLDStats } from '../detectors/tld-risk';
import { D1Queries, executeD1Query } from '../database/queries';

const admin = new Hono<{ Bindings: Env }>();

// Apply API key authentication to all admin routes
admin.use('/*', requireApiKey);

/**
 * GET /admin/config
 * Get current configuration (merged from defaults + KV + secrets)
 */
admin.get('/config', async (c) => {
	try {
		const config = await getConfig(c.env.CONFIG, {
			ADMIN_API_KEY: c.env.ADMIN_API_KEY,
			ORIGIN_URL: c.env.ORIGIN_URL,
		});

		return c.json({
			config,
			source: {
				defaults: DEFAULT_CONFIG,
				cached: true,
			},
		});
	} catch (error) {
		return c.json(
			{
				error: 'Failed to load configuration',
				message: error instanceof Error ? error.message : 'Unknown error',
			},
			500
		);
	}
});

/**
 * GET /admin/config/defaults
 * Get default configuration values
 */
admin.get('/config/defaults', (c) => {
	return c.json({
		defaults: DEFAULT_CONFIG,
	});
});

/**
 * PUT /admin/config
 * Update configuration in KV
 * Body: Partial<FraudDetectionConfig>
 */
admin.put('/config', async (c) => {
	try {
		const body = await c.req.json<Partial<FraudDetectionConfig>>();

		// Validate configuration
		const validation = validateConfig(body);
		if (!validation.valid) {
			return c.json(
				{
					error: 'Invalid configuration',
					errors: validation.errors,
				},
				400
			);
		}

		// Save to KV
		const result = await saveConfig(c.env.CONFIG, body);

		if (!result.success) {
			return c.json(
				{
					error: 'Failed to save configuration',
					errors: result.errors,
				},
				500
			);
		}

		return c.json({
			success: true,
			message: 'Configuration updated successfully',
			config: body,
		});
	} catch (error) {
		return c.json(
			{
				error: 'Invalid request body',
				message: error instanceof Error ? error.message : 'Unknown error',
			},
			400
		);
	}
});

/**
 * PATCH /admin/config
 * Partially update configuration (merge with existing)
 * Body: Partial<FraudDetectionConfig>
 */
admin.patch('/config', async (c) => {
	try {
		const updates = await c.req.json<Partial<FraudDetectionConfig>>();

		// Load current config from KV
		const currentConfig = await getConfig(c.env.CONFIG, {
			ADMIN_API_KEY: c.env.ADMIN_API_KEY,
			ORIGIN_URL: c.env.ORIGIN_URL,
		});

		// Merge updates with current config
		const mergedConfig = { ...currentConfig, ...updates };

		// Validate merged configuration
		const validation = validateConfig(mergedConfig);
		if (!validation.valid) {
			return c.json(
				{
					error: 'Invalid configuration after merge',
					errors: validation.errors,
				},
				400
			);
		}

		// Save to KV
		const result = await saveConfig(c.env.CONFIG, mergedConfig);

		if (!result.success) {
			return c.json(
				{
					error: 'Failed to save configuration',
					errors: result.errors,
				},
				500
			);
		}

		return c.json({
			success: true,
			message: 'Configuration updated successfully',
			config: mergedConfig,
		});
	} catch (error) {
		return c.json(
			{
				error: 'Invalid request body',
				message: error instanceof Error ? error.message : 'Unknown error',
			},
			400
		);
	}
});

/**
 * POST /admin/config/reset
 * Reset configuration to defaults (clears KV)
 */
admin.post('/config/reset', async (c) => {
	try {
		// Clear KV configuration
		await c.env.CONFIG.delete('config.json');

		// Clear cache
		clearConfigCache();

		return c.json({
			success: true,
			message: 'Configuration reset to defaults',
			defaults: DEFAULT_CONFIG,
		});
	} catch (error) {
		return c.json(
			{
				error: 'Failed to reset configuration',
				message: error instanceof Error ? error.message : 'Unknown error',
			},
			500
		);
	}
});

/**
 * POST /admin/config/validate
 * Validate a configuration object without saving
 * Body: Partial<FraudDetectionConfig>
 */
admin.post('/config/validate', async (c) => {
	try {
		const body = await c.req.json<Partial<FraudDetectionConfig>>();

		const validation = validateConfig(body);

		if (validation.valid) {
			return c.json({
				valid: true,
				message: 'Configuration is valid',
			});
		} else {
			return c.json(
				{
					valid: false,
					errors: validation.errors,
				},
				400
			);
		}
	} catch (error) {
		return c.json(
			{
				error: 'Invalid request body',
				message: error instanceof Error ? error.message : 'Unknown error',
			},
			400
		);
	}
});

/**
 * DELETE /admin/config/cache
 * Clear the configuration cache (force reload on next request)
 */
admin.delete('/config/cache', (c) => {
	clearConfigCache();

	return c.json({
		success: true,
		message: 'Configuration cache cleared',
	});
});

/**
 * GET /admin/health
 * Health check endpoint
 */
admin.get('/health', (c) => {
	return c.json({
		status: 'healthy',
		timestamp: new Date().toISOString(),
		admin: {
			enabled: !!c.env.ADMIN_API_KEY,
		},
	});
});

/**
 * GET /admin/analytics
 * Query D1 database with analytics data
 * Query params:
 *   - type: Pre-built query type (summary, blockReasons, etc.)
 *   - hours: Number of hours to look back (default: 24)
 *
 * SECURITY: Custom SQL queries are NOT allowed to prevent SQL injection
 * Migration Note: Now uses D1 instead of Analytics Engine
 */
admin.get('/analytics', async (c) => {
	try {
		// Check for D1 binding
		if (!c.env.DB) {
			return c.json(
				{
					error: 'D1 database not configured',
					message: 'DB binding is missing. Check wrangler.jsonc configuration.',
				},
				503
			);
		}

		const hours = parseInt(c.req.query('hours') || '24', 10);
		const queryType = c.req.query('type') || 'summary';

		// SECURITY: Only allow pre-built queries to prevent SQL injection
		const allowedQueries: Record<string, (hours: number) => string> = {
			summary: D1Queries.summary,
			blockReasons: D1Queries.blockReasons,
			riskDistribution: D1Queries.riskDistribution,
			topCountries: D1Queries.topCountries,
			highRisk: D1Queries.highRiskEmails,
			performance: D1Queries.performanceMetrics,
			timeline: D1Queries.hourlyTimeline,
			fingerprints: D1Queries.topFingerprints,
			disposableDomains: D1Queries.disposableDomains,
			patternFamilies: D1Queries.patternFamilies,
			markovStats: D1Queries.markovStats,
		};

		if (!allowedQueries[queryType]) {
			return c.json(
				{
					error: 'Invalid query type',
					message: `Query type '${queryType}' is not allowed. Use /admin/analytics/queries to see available types.`,
					available: Object.keys(allowedQueries),
				},
				400
			);
		}

		const query = allowedQueries[queryType](hours);

		// Execute query on D1
		const data = await executeD1Query(c.env.DB, query);

		return c.json({
			success: true,
			queryType,
			query,
			hours,
			data,
			note: 'Migrated to D1 - uses pre-built queries only to prevent SQL injection',
		});
	} catch (error) {
		return c.json(
			{
				error: 'Analytics query failed',
				message: error instanceof Error ? error.message : 'Unknown error',
			},
			500
		);
	}
});

/**
 * GET /admin/analytics/info
 * Get Analytics Engine dataset information and data management options
 */
admin.get('/analytics/info', (c) => {
	return c.json({
		dataset: 'ANALYTICS',
		dataRetention: {
			description: 'Analytics Engine stores data for 6 months by default',
			automaticDeletion: 'Data older than 6 months is automatically deleted',
			manualDeletion: 'Analytics Engine data is immutable - no manual deletion API available',
		},
		dataManagement: {
			filterByTime: 'Use WHERE timestamp >= NOW() - INTERVAL \'X\' HOUR in queries to exclude old data',
			excludeTestData: 'Use WHERE blob14 NOT LIKE \'test%\' to exclude test emails',
			exportData: 'Use SQL queries to export specific data subsets',
		},
		bestPractices: [
			'Use time-based filtering to focus on relevant data',
			'Add identifying markers to test data for easy filtering',
			'Export important data before 6-month retention expires',
			'Use aggregate queries to reduce data volume in results',
		],
	});
});

/**
 * POST /admin/analytics/truncate
 * Simulate data truncation by returning a query that excludes old data
 * Note: Analytics Engine data cannot be actually deleted
 */
admin.post('/analytics/truncate', async (c) => {
	try {
		const body = await c.req.json<{ olderThanHours?: number }>();
		const hours = body.olderThanHours || 24;

		// Return a query template that excludes old data
		const filterQuery = `WHERE timestamp >= NOW() - INTERVAL '${hours}' HOUR`;

		return c.json({
			success: true,
			message: 'Generated filter query to exclude old data',
			note: 'Analytics Engine data cannot be deleted. Use this filter in your queries.',
			filterQuery,
			example: `SELECT * FROM ANALYTICS ${filterQuery} ORDER BY timestamp DESC LIMIT 100`,
			hoursToKeep: hours,
		});
	} catch (error) {
		return c.json(
			{
				error: 'Invalid request',
				message: error instanceof Error ? error.message : 'Unknown error',
			},
			400
		);
	}
});

/**
 * DELETE /admin/analytics/test-data
 * Return query to exclude test data patterns
 */
admin.delete('/analytics/test-data', (c) => {
	const testPatterns = [
		"blob14 NOT LIKE 'user%'",
		"blob14 NOT LIKE 'test%'",
		"blob5 NOT IN ('example.com', 'test.com')",
		"blob7 != 'none' OR double1 >= 0.6", // Keep only pattern detections or high risk
	];

	return c.json({
		success: true,
		message: 'Generated filters to exclude common test data patterns',
		note: 'Analytics Engine data cannot be deleted. Apply these filters in queries.',
		filters: testPatterns,
		combinedFilter: testPatterns.join(' AND '),
		example: `SELECT * FROM ANALYTICS WHERE ${testPatterns.join(' AND ')} ORDER BY timestamp DESC LIMIT 100`,
	});
});

/**
 * GET /admin/analytics/queries
 * Get a list of pre-built useful D1 queries
 * Migration Note: Now returns D1-compatible SQLite queries
 */
admin.get('/analytics/queries', (c) => {
	const hours = 24; // Default for examples

	const queries = {
		summary: {
			name: 'Decision Summary',
			description: 'Overview of allow/warn/block decisions',
			sql: D1Queries.summary(hours).trim(),
		},
		blockReasons: {
			name: 'Top Block Reasons',
			description: 'Most common reasons for blocking emails',
			sql: D1Queries.blockReasons(hours).trim(),
		},
		riskDistribution: {
			name: 'Risk Score Distribution',
			description: 'Distribution of emails by risk bucket',
			sql: D1Queries.riskDistribution(hours).trim(),
		},
		topCountries: {
			name: 'Top Countries',
			description: 'Validations by country',
			sql: D1Queries.topCountries(hours).trim(),
		},
		highRisk: {
			name: 'High Risk Emails',
			description: 'Emails with risk score > 0.6',
			sql: D1Queries.highRiskEmails(hours).trim(),
		},
		performance: {
			name: 'Performance Metrics',
			description: 'Latency statistics by decision',
			sql: D1Queries.performanceMetrics(hours).trim(),
		},
		timeline: {
			name: 'Hourly Timeline',
			description: 'Validations over time by decision',
			sql: D1Queries.hourlyTimeline(hours).trim(),
		},
		fingerprints: {
			name: 'Top Fingerprints',
			description: 'Most active fingerprints (potential automation)',
			sql: D1Queries.topFingerprints(hours).trim(),
		},
		disposableDomains: {
			name: 'Disposable Domains',
			description: 'Most frequently used disposable domains',
			sql: D1Queries.disposableDomains(hours).trim(),
		},
		patternFamilies: {
			name: 'Pattern Families',
			description: 'Analysis of detected pattern families',
			sql: D1Queries.patternFamilies(hours).trim(),
		},
		markovStats: {
			name: 'Markov Detection Stats',
			description: 'Markov chain fraud detection statistics',
			sql: D1Queries.markovStats(hours).trim(),
		},
	};

	return c.json({
		queries,
		usage: 'Use the SQL from any query with GET /admin/analytics?query=<url_encoded_sql>',
		note: 'Migrated to D1 - SQLite syntax with proper column names',
	});
});

/**
 * POST /admin/markov/train
 * Manually trigger Markov Chain model retraining
 *
 * This endpoint initiates the online learning training pipeline:
 * 1. Fetches high-confidence data from D1 database (last 7 days)
 * 2. Runs anomaly detection to check for data poisoning attacks
 * 3. Trains new models on fraud vs legitimate samples
 * 4. Validates new models against production
 * 5. Saves candidate model to KV with SHA-256 checksum
 *
 * Migration Note: Now uses D1 instead of Analytics Engine
 * Returns the training result including success status, metrics, and any errors.
 */
admin.post('/markov/train', async (c) => {
	try {
		logger.info({
			event: 'manual_training_triggered',
			source: 'admin_api',
		}, 'Manual training triggered via admin API');

		// Check for D1 binding
		if (!c.env.DB) {
			return c.json(
				{
					error: 'D1 database not configured',
					message: 'DB binding is missing. Check wrangler.jsonc configuration.',
				},
				503
			);
		}

		// Trigger training pipeline
		const result = await retrainMarkovModels(c.env);

		if (result.success) {
			return c.json({
				success: true,
				message: 'Training completed successfully',
				result,
			});
		} else {
			return c.json(
				{
					success: false,
					message: 'Training failed',
					error: result.error,
					result,
				},
				500
			);
		}
	} catch (error) {
		logger.error({
			event: 'training_error',
			error: error instanceof Error ? {
				message: error.message,
				stack: error.stack,
				name: error.name,
			} : String(error),
		}, 'Training failed');
		return c.json(
			{
				error: 'Training failed',
				message: error instanceof Error ? error.message : 'Unknown error',
			},
			500
		);
	}
});

/**
 * GET /admin/markov/status
 * Get current status of Markov Chain models and recent training runs
 *
 * Returns:
 * - Production model metadata (version, accuracy, traffic %, checksum)
 * - Candidate model metadata (version, accuracy, status)
 * - Last 5 training runs (timestamps, success/failure, metrics)
 */
admin.get('/markov/status', async (c) => {
	try {
		// Get training history from CONFIG KV
		const history = await c.env.CONFIG.get('markov_training_history', 'json') as Array<unknown> | null;

		// Get candidate model metadata from MARKOV_MODEL KV
		const candidateData = c.env.MARKOV_MODEL ? await c.env.MARKOV_MODEL.getWithMetadata('markov_model_candidate') : null;

		// Get production model metadata
		// Note: Currently loading from CONFIG, but will migrate to MARKOV_MODEL in Phase 2
		const productionData = await c.env.CONFIG.getWithMetadata('markov_legit_model');

		// Get training lock status
		const lockStatus = await c.env.CONFIG.get('markov_training_lock');

		return c.json({
			production: {
				modelVersion: productionData?.metadata || null,
				status: 'active',
				traffic_percent: 100,
				note: 'Production models currently stored in CONFIG KV (will migrate to MARKOV_MODEL in Phase 2)',
			},
			candidate: candidateData?.metadata ? {
				...candidateData.metadata,
				status: 'candidate',
				traffic_percent: 0,
			} : null,
			trainingStatus: {
				locked: !!lockStatus,
				lockInfo: lockStatus ? 'Training in progress' : 'No training running',
			},
			recentTraining: history ? history.slice(0, 5) : [],
			kvNamespaces: {
				CONFIG: 'Stores config, production models (legacy), training history',
				MARKOV_MODEL: 'Stores candidate models with metadata',
			},
		});
	} catch (error) {
		return c.json(
			{
				error: 'Failed to get training status',
				message: error instanceof Error ? error.message : 'Unknown error',
			},
			500
		);
	}
});

/**
 * GET /admin/markov/history
 * Get detailed training history (last 20 runs)
 *
 * Each entry includes:
 * - Timestamp
 * - Success/failure status
 * - Training duration
 * - Sample counts (fraud/legit)
 * - Model version ID
 * - Validation metrics (accuracy, precision, recall)
 * - Anomaly detection results
 * - Error messages (if failed)
 */
admin.get('/markov/history', async (c) => {
	try {
		// Get full training history from CONFIG KV
		const history = await c.env.CONFIG.get('markov_training_history', 'json') as Array<unknown> | null;

		if (!history || history.length === 0) {
			return c.json({
				success: true,
				message: 'No training history found',
				history: [],
				note: 'Trigger training via POST /admin/markov/train or wait for cron (every 6 hours)',
			});
		}

		return c.json({
			success: true,
			count: history.length,
			history: history.slice(0, 20), // Last 20 runs
			cronSchedule: '0 */6 * * * (every 6 hours at :00)',
		});
	} catch (error) {
		return c.json(
			{
				error: 'Failed to get training history',
				message: error instanceof Error ? error.message : 'Unknown error',
			},
			500
		);
	}
});

/**
 * GET /admin/disposable-domains/metadata
 * Get metadata about the disposable domains list
 *
 * Returns:
 * - Total count of domains
 * - Last updated timestamp
 * - Version
 * - Data sources
 */
admin.get('/disposable-domains/metadata', async (c) => {
	try {
		if (!c.env.DISPOSABLE_DOMAINS_LIST) {
			return c.json(
				{
					error: 'DISPOSABLE_DOMAINS_LIST KV namespace not configured',
					message: 'Add DISPOSABLE_DOMAINS_LIST binding to wrangler.jsonc',
				},
				503
			);
		}

		const metadata = await getDisposableDomainMetadata(c.env.DISPOSABLE_DOMAINS_LIST);

		if (!metadata) {
			return c.json(
				{
					success: false,
					message: 'No disposable domain data found',
					note: 'Trigger update via POST /admin/disposable-domains/update',
				},
				404
			);
		}

		return c.json({
			success: true,
			metadata,
		});
	} catch (error) {
		return c.json(
			{
				error: 'Failed to get disposable domain metadata',
				message: error instanceof Error ? error.message : 'Unknown error',
			},
			500
		);
	}
});

/**
 * POST /admin/disposable-domains/update
 * Manually trigger disposable domain list update from external sources
 *
 * This endpoint:
 * 1. Fetches latest domains from GitHub (disposable-email-domains)
 * 2. Merges with existing hardcoded domains
 * 3. Stores in KV with metadata
 * 4. Clears the domain cache
 *
 * Returns update result with domain count and timestamp
 */
admin.post('/disposable-domains/update', async (c) => {
	try {
		if (!c.env.DISPOSABLE_DOMAINS_LIST) {
			return c.json(
				{
					error: 'DISPOSABLE_DOMAINS_LIST KV namespace not configured',
					message: 'Add DISPOSABLE_DOMAINS_LIST binding to wrangler.jsonc',
				},
				503
			);
		}

		logger.info({
			event: 'manual_disposable_domains_update',
			source: 'admin_api',
		}, 'Manual disposable domain update triggered via admin API');

		const result = await updateDisposableDomains(c.env.DISPOSABLE_DOMAINS_LIST);

		// Clear the cache to force reload on next validation
		clearDomainCache();

		if (result.success) {
			return c.json({
				success: true,
				message: 'Disposable domains updated successfully',
				result,
			});
		} else {
			return c.json(
				{
					success: false,
					message: 'Failed to update disposable domains',
					error: result.error,
					result,
				},
				500
			);
		}
	} catch (error) {
		logger.error({
			event: 'disposable_domains_update_error',
			error: error instanceof Error ? {
				message: error.message,
				stack: error.stack,
			} : String(error),
		}, 'Disposable domain update failed');

		return c.json(
			{
				error: 'Update failed',
				message: error instanceof Error ? error.message : 'Unknown error',
			},
			500
		);
	}
});

/**
 * DELETE /admin/disposable-domains/cache
 * Clear the disposable domain cache (force reload on next request)
 */
admin.delete('/disposable-domains/cache', (c) => {
	clearDomainCache();

	return c.json({
		success: true,
		message: 'Disposable domain cache cleared',
		note: 'Next validation will reload domains from KV',
	});
});

/**
 * GET /admin/tld-profiles/metadata
 * Get metadata about TLD risk profiles
 *
 * Returns:
 * - Total count of profiles
 * - Last updated timestamp
 * - Version
 * - Statistics by category
 */
admin.get('/tld-profiles/metadata', async (c) => {
	try {
		if (!c.env.TLD_LIST) {
			return c.json(
				{
					error: 'TLD_LIST KV namespace not configured',
					message: 'Add TLD_LIST binding to wrangler.jsonc',
				},
				503
			);
		}

		const metadata = await getTLDRiskMetadata(c.env.TLD_LIST);
		const stats = getTLDStats();

		if (!metadata) {
			return c.json(
				{
					success: false,
					message: 'No TLD risk profiles found in KV',
					note: 'Sync hardcoded profiles via POST /admin/tld-profiles/sync',
					hardcodedStats: stats,
				},
				404
			);
		}

		return c.json({
			success: true,
			metadata,
			stats,
		});
	} catch (error) {
		return c.json(
			{
				error: 'Failed to get TLD profile metadata',
				message: error instanceof Error ? error.message : 'Unknown error',
			},
			500
		);
	}
});

/**
 * POST /admin/tld-profiles/sync
 * Sync hardcoded TLD risk profiles to KV
 *
 * This initializes or updates the KV store with the 142 hardcoded TLD profiles.
 * Use this to:
 * - Initialize TLD_LIST KV for the first time
 * - Reset profiles to defaults
 * - Update after code changes to risk profiles
 */
admin.post('/tld-profiles/sync', async (c) => {
	try {
		if (!c.env.TLD_LIST) {
			return c.json(
				{
					error: 'TLD_LIST KV namespace not configured',
					message: 'Add TLD_LIST binding to wrangler.jsonc',
				},
				503
			);
		}

		logger.info({
			event: 'tld_profiles_sync_triggered',
			source: 'admin_api',
		}, 'TLD profiles sync triggered via admin API');

		// Get hardcoded profiles
		const profiles = getAllTLDProfiles();

		// Update KV
		const result = await updateTLDRiskProfiles(c.env.TLD_LIST, profiles);

		if (result.success) {
			return c.json({
				success: true,
				message: 'TLD risk profiles synced successfully',
				result,
				stats: getTLDStats(),
			});
		} else {
			return c.json(
				{
					success: false,
					message: 'Failed to sync TLD profiles',
					error: result.error,
					result,
				},
				500
			);
		}
	} catch (error) {
		logger.error({
			event: 'tld_profiles_sync_error',
			error: error instanceof Error ? {
				message: error.message,
				stack: error.stack,
			} : String(error),
		}, 'TLD profiles sync failed');

		return c.json(
			{
				error: 'Sync failed',
				message: error instanceof Error ? error.message : 'Unknown error',
			},
			500
		);
	}
});

/**
 * GET /admin/tld-profiles/:tld
 * Get a single TLD risk profile
 */
admin.get('/tld-profiles/:tld', async (c) => {
	try {
		if (!c.env.TLD_LIST) {
			return c.json(
				{
					error: 'TLD_LIST KV namespace not configured',
				},
				503
			);
		}

		const tld = c.req.param('tld').toLowerCase();
		const profile = await getTLDRiskProfile(c.env.TLD_LIST, tld);

		if (!profile) {
			return c.json(
				{
					error: 'TLD profile not found',
					tld,
				},
				404
			);
		}

		return c.json({
			success: true,
			profile,
		});
	} catch (error) {
		return c.json(
			{
				error: 'Failed to get TLD profile',
				message: error instanceof Error ? error.message : 'Unknown error',
			},
			500
		);
	}
});

/**
 * PUT /admin/tld-profiles/:tld
 * Update a single TLD risk profile
 *
 * Body: Partial TLD risk profile (any field except 'tld')
 * Example:
 * {
 *   "riskMultiplier": 1.5,
 *   "category": "suspicious"
 * }
 */
admin.put('/tld-profiles/:tld', async (c) => {
	try {
		if (!c.env.TLD_LIST) {
			return c.json(
				{
					error: 'TLD_LIST KV namespace not configured',
				},
				503
			);
		}

		const tld = c.req.param('tld').toLowerCase();
		const updates = await c.req.json();

		logger.info({
			event: 'tld_profile_update_triggered',
			tld,
			updates,
		}, `Updating TLD profile: ${tld}`);

		const result = await updateSingleTLDProfile(c.env.TLD_LIST, tld, updates);

		if (result.success) {
			return c.json({
				success: true,
				message: `TLD profile updated: ${tld}`,
				result,
			});
		} else {
			return c.json(
				{
					success: false,
					message: 'Failed to update TLD profile',
					error: result.error,
				},
				500
			);
		}
	} catch (error) {
		logger.error({
			event: 'tld_profile_update_error',
			error: error instanceof Error ? {
				message: error.message,
				stack: error.stack,
			} : String(error),
		}, 'TLD profile update failed');

		return c.json(
			{
				error: 'Update failed',
				message: error instanceof Error ? error.message : 'Unknown error',
			},
			500
		);
	}
});

/**
 * DELETE /admin/tld-profiles/cache
 * Clear the TLD profile cache (force reload on next request)
 */
admin.delete('/tld-profiles/cache', (c) => {
	clearTLDCache();

	return c.json({
		success: true,
		message: 'TLD profile cache cleared',
		note: 'Next validation will reload profiles from KV',
	});
});

export default admin;
