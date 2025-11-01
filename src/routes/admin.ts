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
 * Query Analytics Engine with labeled results
 * Query params:
 *   - query: SQL query to run (optional, defaults to summary)
 *   - hours: Number of hours to look back (default: 24)
 *
 * Requires environment variables:
 *   - CLOUDFLARE_ACCOUNT_ID: Your Cloudflare account ID
 *   - CLOUDFLARE_API_TOKEN: API token with Account Analytics Read permission
 */
admin.get('/analytics', async (c) => {
	try {
		// Check for required configuration
		const accountId = c.env.CLOUDFLARE_ACCOUNT_ID;
		const apiToken = c.env.CLOUDFLARE_API_TOKEN;

		if (!accountId || !apiToken) {
			return c.json(
				{
					error: 'Analytics Engine not configured',
					message: 'CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN secrets must be set',
					setup: 'Run: wrangler secret put CLOUDFLARE_ACCOUNT_ID and wrangler secret put CLOUDFLARE_API_TOKEN',
				},
				503
			);
		}

		const hours = parseInt(c.req.query('hours') || '24', 10);
		const customQuery = c.req.query('query');

		// Get dataset name from Analytics Engine binding
		const dataset = 'ANALYTICS'; // Default dataset name

		// Default query: Summary of decisions over time
		const defaultQuery = `
			SELECT
				blob1 as decision,
				blob2 as block_reason,
				blob4 as risk_bucket,
				SUM(_sample_interval) as count,
				SUM(_sample_interval * double1) / SUM(_sample_interval) as avg_risk_score,
				SUM(_sample_interval * double2) / SUM(_sample_interval) as avg_entropy_score,
				SUM(_sample_interval * double3) / SUM(_sample_interval) as avg_bot_score,
				SUM(_sample_interval * double5) / SUM(_sample_interval) as avg_latency_ms,
				toStartOfHour(timestamp) as hour
			FROM ${dataset}
			WHERE timestamp >= NOW() - INTERVAL '${hours}' HOUR
			GROUP BY decision, block_reason, risk_bucket, hour
			ORDER BY hour DESC, count DESC
		`;

		const query = customQuery || defaultQuery;

		// Execute query via Cloudflare SQL API
		const apiUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`;

		const response = await fetch(apiUrl, {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${apiToken}`,
				'Content-Type': 'text/plain',
			},
			body: query,
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Cloudflare API error: ${response.status} - ${errorText}`);
		}

		const data = await response.json() as { data?: unknown };

		return c.json({
			success: true,
			query,
			hours,
			data: data.data || data,
			columnMapping: {
				blob1: 'decision (allow/warn/block)',
				blob2: 'block_reason',
				blob3: 'country',
				blob4: 'risk_bucket',
				blob5: 'domain',
				blob6: 'tld',
				blob7: 'pattern_type',
				blob8: 'pattern_family',
				blob9: 'is_disposable',
				blob10: 'is_free_provider',
				blob11: 'has_plus_addressing',
				blob12: 'has_keyboard_walk',
				blob13: 'is_gibberish',
				blob14: 'email_local_part',
				blob15: 'client_ip',                        // Phase 8: NEW
				blob16: 'user_agent',                       // Phase 8: NEW
				blob17: 'model_version',                    // Phase 8: NEW (A/B testing)
				blob18: 'exclude_from_training',            // Phase 8: NEW (security)
				blob19: 'markov_detected',                  // Phase 7: MOVED from blob15
				double1: 'risk_score',
				double2: 'entropy_score',
				double3: 'bot_score',
				double4: 'asn',
				double5: 'latency_ms',
				double6: 'tld_risk_score',
				double7: 'domain_reputation_score',
				double8: 'pattern_confidence',
				double9: 'markov_confidence',               // Phase 7
				double10: 'markov_cross_entropy_legit',     // Phase 7
				double11: 'markov_cross_entropy_fraud',     // Phase 7
				double12: 'ip_reputation_score',            // Phase 8: NEW
				index1: 'fingerprint_hash',
			},
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
 * Get a list of pre-built useful queries
 */
admin.get('/analytics/queries', (c) => {
	const queries = {
		summary: {
			name: 'Decision Summary',
			description: 'Overview of allow/warn/block decisions',
			sql: `
SELECT
  blob1 as decision,
  SUM(_sample_interval) as count,
  SUM(_sample_interval * double1) / SUM(_sample_interval) as avg_risk_score,
  SUM(_sample_interval * double5) / SUM(_sample_interval) as avg_latency_ms
FROM ANALYTICS
WHERE timestamp >= NOW() - INTERVAL '24' HOUR
GROUP BY decision
ORDER BY count DESC
			`.trim(),
		},
		blockReasons: {
			name: 'Top Block Reasons',
			description: 'Most common reasons for blocking emails',
			sql: `
SELECT
  blob2 as block_reason,
  SUM(_sample_interval) as count,
  SUM(_sample_interval * double1) / SUM(_sample_interval) as avg_risk_score
FROM ANALYTICS
WHERE timestamp >= NOW() - INTERVAL '24' HOUR
  AND blob1 = 'block'
  AND blob2 != 'none'
GROUP BY block_reason
ORDER BY count DESC
LIMIT 10
			`.trim(),
		},
		riskDistribution: {
			name: 'Risk Score Distribution',
			description: 'Distribution of emails by risk bucket',
			sql: `
SELECT
  blob4 as risk_bucket,
  SUM(_sample_interval) as count,
  SUM(_sample_interval * double1) / SUM(_sample_interval) as avg_risk_score
FROM ANALYTICS
WHERE timestamp >= NOW() - INTERVAL '24' HOUR
GROUP BY risk_bucket
ORDER BY risk_bucket
			`.trim(),
		},
		countryBreakdown: {
			name: 'Country Breakdown',
			description: 'Validations by country',
			sql: `
SELECT
  blob3 as country,
  blob1 as decision,
  SUM(_sample_interval) as count,
  SUM(_sample_interval * double1) / SUM(_sample_interval) as avg_risk_score
FROM ANALYTICS
WHERE timestamp >= NOW() - INTERVAL '24' HOUR
GROUP BY country, decision
ORDER BY count DESC
LIMIT 20
			`.trim(),
		},
		highRisk: {
			name: 'High Risk Emails',
			description: 'Emails with risk score > 0.6',
			sql: `
SELECT
  blob1 as decision,
  blob2 as block_reason,
  blob3 as country,
  double1 as risk_score,
  double2 as entropy_score,
  timestamp
FROM ANALYTICS
WHERE timestamp >= NOW() - INTERVAL '24' HOUR
  AND double1 > 0.6
ORDER BY timestamp DESC
LIMIT 100
			`.trim(),
		},
		performance: {
			name: 'Performance Metrics',
			description: 'Latency statistics by decision',
			sql: `
SELECT
  blob1 as decision,
  SUM(_sample_interval) as count,
  SUM(_sample_interval * double5) / SUM(_sample_interval) as avg_latency_ms,
  quantileExactWeighted(0.5)(double5, _sample_interval) as p50_latency_ms,
  quantileExactWeighted(0.95)(double5, _sample_interval) as p95_latency_ms,
  quantileExactWeighted(0.99)(double5, _sample_interval) as p99_latency_ms
FROM ANALYTICS
WHERE timestamp >= NOW() - INTERVAL '24' HOUR
GROUP BY decision
			`.trim(),
		},
		timeline: {
			name: 'Hourly Timeline',
			description: 'Validations over time by decision',
			sql: `
SELECT
  toStartOfHour(timestamp) as hour,
  blob1 as decision,
  SUM(_sample_interval) as count,
  SUM(_sample_interval * double1) / SUM(_sample_interval) as avg_risk_score
FROM ANALYTICS
WHERE timestamp >= NOW() - INTERVAL '24' HOUR
GROUP BY hour, decision
ORDER BY hour DESC
			`.trim(),
		},
		fingerprints: {
			name: 'Top Fingerprints',
			description: 'Most active fingerprints (potential automation)',
			sql: `
SELECT
  index1 as fingerprint,
  SUM(_sample_interval) as validation_count,
  SUM(_sample_interval * double1) / SUM(_sample_interval) as avg_risk_score,
  blob3 as country
FROM ANALYTICS
WHERE timestamp >= NOW() - INTERVAL '24' HOUR
GROUP BY index1, blob3
HAVING SUM(_sample_interval) > 10
ORDER BY validation_count DESC
LIMIT 20
			`.trim(),
		},
	};

	return c.json({
		queries,
		usage: 'Use the SQL from any query with GET /admin/analytics?query=<url_encoded_sql>',
	});
});

/**
 * POST /admin/markov/train
 * Manually trigger Markov Chain model retraining
 *
 * This endpoint initiates the online learning training pipeline:
 * 1. Fetches high-confidence data from Analytics Engine (last 7 days)
 * 2. Runs anomaly detection to check for data poisoning attacks
 * 3. Trains new models on fraud vs legitimate samples
 * 4. Validates new models against production
 * 5. Saves candidate model to KV with SHA-256 checksum
 *
 * Returns the training result including success status, metrics, and any errors.
 */
admin.post('/markov/train', async (c) => {
	try {
		console.log('📋 Manual training triggered via admin API');

		// Check for required configuration
		const accountId = c.env.CLOUDFLARE_ACCOUNT_ID;
		const apiToken = c.env.CLOUDFLARE_API_TOKEN;

		if (!accountId || !apiToken) {
			return c.json(
				{
					error: 'Analytics Engine not configured',
					message: 'CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN secrets must be set',
					setup: 'Run: wrangler secret put CLOUDFLARE_ACCOUNT_ID and wrangler secret put CLOUDFLARE_API_TOKEN',
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
		console.error('Training error:', error);
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

export default admin;
