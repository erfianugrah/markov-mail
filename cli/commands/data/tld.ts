#!/usr/bin/env bun
/**
 * TLD Risk Profiles Management CLI
 *
 * Commands for managing TLD (Top-Level Domain) risk profiles
 */

import { parseArgs } from 'util';
import { logger } from '../../utils/logger';

interface ApiResponse {
	success: boolean;
	message?: string;
	error?: string;
	result?: unknown;
	metadata?: {
		count: number;
		lastUpdated: string;
		version: string;
		source: string;
	};
	stats?: {
		total: number;
		trusted: number;
		standard: number;
		suspicious: number;
		highRisk: number;
	};
	hardcodedStats?: {
		total: number;
		trusted: number;
		standard: number;
		suspicious: number;
		highRisk: number;
	};
	profile?: unknown;
}

// Store API URL globally (set by main handler)
let globalApiUrl: string | undefined;

/**
 * Get API URL and key from environment or CLI flags
 */
function getApiConfig() {
	const apiUrl = globalApiUrl || process.env.API_URL || 'https://your-worker.workers.dev';
	const apiKey = process.env.ADMIN_API_KEY;

	if (!apiKey) {
		logger.error('ADMIN_API_KEY environment variable is required');
		logger.info('Set it with: export ADMIN_API_KEY=your-api-key');
		process.exit(1);
	}

	return { apiUrl, apiKey };
}

/**
 * Make API request
 */
async function apiRequest(endpoint: string, method = 'GET', body?: unknown): Promise<ApiResponse> {
	const { apiUrl, apiKey } = getApiConfig();
	const url = `${apiUrl}${endpoint}`;

	logger.info(`Making ${method} request to ${url}`);

	const response = await fetch(url, {
		method,
		headers: {
			'X-API-Key': apiKey,
			'Content-Type': 'application/json',
		},
		body: body ? JSON.stringify(body) : undefined,
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`API request failed: ${response.status} - ${text}`);
	}

	return await response.json();
}

/**
 * Sync hardcoded TLD profiles to KV
 */
async function syncProfiles() {
	logger.info('🔄 Syncing hardcoded TLD risk profiles to KV...\n');

	try {
		const startTime = Date.now();
		const result = await apiRequest('/admin/tld-profiles/sync', 'POST');

		const duration = Date.now() - startTime;

		if (result.success && result.stats) {
			logger.success(`✅ Sync completed successfully!`);
			logger.info('');
			logger.info(`📊 Statistics:`);
			logger.info(`   Total profiles:      ${result.stats.total}`);
			logger.info(`   Trusted (.edu, .gov):${result.stats.trusted}`);
			logger.info(`   Standard (.com, etc):${result.stats.standard}`);
			logger.info(`   Suspicious:          ${result.stats.suspicious}`);
			logger.info(`   High Risk:           ${result.stats.highRisk}`);
			logger.info(`   Duration:            ${duration}ms`);
			logger.info('');
			logger.info('💡 Profiles are now in KV and will be used in validation');
		} else {
			logger.error(`❌ Sync failed: ${result.error || result.message}`);
			process.exit(1);
		}
	} catch (error) {
		logger.error('❌ Failed to sync TLD profiles');
		logger.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}

/**
 * Show TLD risk profiles metadata
 */
async function showMetadata() {
	logger.info('📊 Fetching TLD risk profiles metadata...\n');

	try {
		const result = await apiRequest('/admin/tld-profiles/metadata', 'GET');

		if (result.success && result.metadata && result.stats) {
			const { metadata, stats } = result;

			logger.success('✅ Metadata retrieved successfully!\n');
			logger.info('📊 TLD Risk Profiles:');
			logger.info(`   Total profiles:      ${metadata.count}`);
			logger.info(`   Last updated:        ${new Date(metadata.lastUpdated).toLocaleString()}`);
			logger.info(`   Version:             ${metadata.version}`);
			logger.info(`   Source:              ${metadata.source}`);
			logger.info('');
			logger.info('📈 Breakdown by Category:');
			logger.info(`   Trusted:             ${stats.trusted} (.edu, .gov, .mil)`);
			logger.info(`   Standard:            ${stats.standard} (.com, .net, .org, etc)`);
			logger.info(`   Suspicious:          ${stats.suspicious} (.info, .biz, etc)`);
			logger.info(`   High Risk:           ${stats.highRisk} (.tk, .ml, .ga, etc)`);
			logger.info('');

			// Calculate time since last update
			const lastUpdateTime = new Date(metadata.lastUpdated).getTime();
			const now = Date.now();
			const hoursAgo = Math.floor((now - lastUpdateTime) / (1000 * 60 * 60));
			const daysAgo = Math.floor(hoursAgo / 24);

			if (daysAgo > 0) {
				logger.info(`⏰ Updated ${daysAgo} day${daysAgo !== 1 ? 's' : ''} ago`);
			} else if (hoursAgo > 0) {
				logger.info(`⏰ Updated ${hoursAgo} hour${hoursAgo !== 1 ? 's' : ''} ago`);
			} else {
				logger.info(`⏰ Updated recently`);
			}
		} else if (result.hardcodedStats) {
			logger.warn('⚠️  No TLD profiles found in KV');
			logger.info('');
			logger.info('📊 Hardcoded Profiles Available:');
			logger.info(`   Total:    ${result.hardcodedStats.total}`);
			logger.info(`   Trusted:  ${result.hardcodedStats.trusted}`);
			logger.info(`   Standard: ${result.hardcodedStats.standard}`);
			logger.info(`   Suspicious: ${result.hardcodedStats.suspicious}`);
			logger.info(`   High Risk: ${result.hardcodedStats.highRisk}`);
			logger.info('');
			logger.info('💡 Run "npm run cli tld:sync" to initialize KV');
		} else {
			logger.warn('⚠️  No TLD profile data found');
		}
	} catch (error) {
		logger.error('❌ Failed to fetch metadata');
		logger.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}

/**
 * Get a single TLD profile
 */
async function getProfile(tld: string) {
	logger.info(`🔍 Fetching TLD profile: ${tld}\n`);

	try {
		const result = await apiRequest(`/admin/tld-profiles/${tld}`, 'GET');

		if (result.success && result.profile) {
			const profile = result.profile as any;

			logger.success(`✅ Profile found: ${tld}\n`);
			logger.info('📊 Risk Profile:');
			logger.info(`   TLD:              ${profile.tld}`);
			logger.info(`   Category:         ${profile.category}`);
			logger.info(`   Risk Multiplier:  ${profile.riskMultiplier}`);
			logger.info(`   Disposable Ratio: ${(profile.disposableRatio * 100).toFixed(1)}%`);
			logger.info(`   Spam Ratio:       ${(profile.spamRatio * 100).toFixed(1)}%`);
			logger.info(`   Reg. Cost:        ${profile.registrationCost}`);
			logger.info(`   Description:      ${profile.description}`);
		} else {
			logger.error(`❌ TLD profile not found: ${tld}`);
			process.exit(1);
		}
	} catch (error) {
		logger.error(`❌ Failed to fetch TLD profile: ${tld}`);
		logger.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}

/**
 * Update a single TLD profile
 */
async function updateProfile(tld: string, updates: Record<string, unknown>) {
	logger.info(`🔧 Updating TLD profile: ${tld}\n`);
	logger.info(`Updates: ${JSON.stringify(updates, null, 2)}\n`);

	try {
		const result = await apiRequest(`/admin/tld-profiles/${tld}`, 'PUT', updates);

		if (result.success) {
			logger.success(`✅ TLD profile updated: ${tld}`);
			logger.info('');
			logger.info('💡 Cache cleared automatically. Changes will apply on next validation.');
		} else {
			logger.error(`❌ Failed to update TLD profile: ${result.error || result.message}`);
			process.exit(1);
		}
	} catch (error) {
		logger.error(`❌ Failed to update TLD profile: ${tld}`);
		logger.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}

/**
 * Clear TLD profile cache
 */
async function clearCache() {
	logger.info('🗑️  Clearing TLD profile cache...\n');

	try {
		const result = await apiRequest('/admin/tld-profiles/cache', 'DELETE');

		if (result.success) {
			logger.success('✅ Cache cleared successfully!');
			logger.info('');
			logger.info(result.message || '');
		} else {
			logger.error(`❌ Failed to clear cache: ${result.error || result.message}`);
			process.exit(1);
		}
	} catch (error) {
		logger.error('❌ Failed to clear cache');
		logger.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}

/**
 * Show help
 */
function showHelp() {
	console.log(`
╔═══════════════════════════════════════════════════════════════╗
║            🌐 TLD Risk Profiles Management                    ║
╚═══════════════════════════════════════════════════════════════╝

COMMANDS
  sync                  Sync hardcoded profiles to KV (142 TLDs)
  metadata              Show metadata and statistics
  get <tld>             Get a single TLD profile (e.g., "com", "tk")
  update <tld> <json>   Update a single TLD profile
  cache:clear           Clear the profiles cache

ENVIRONMENT VARIABLES
  ADMIN_API_KEY         API key for admin endpoints (required)
  API_URL               API base URL (default: https://your-worker.workers.dev)

OPTIONS
  --api-url <url>       Override API URL (default: $API_URL or https://your-worker.workers.dev)
  --help, -h            Show this help message

EXAMPLES
  # Initialize KV with hardcoded profiles
  npm run cli tld:sync

  # View metadata and statistics
  npm run cli tld:metadata

  # Get a specific TLD profile
  npm run cli tld:get tk

  # Update TLD risk multiplier
  npm run cli tld:update tk '{"riskMultiplier": 2.5}'

  # Update TLD category
  npm run cli tld:update info '{"category": "suspicious", "riskMultiplier": 1.5}'

  # Clear cache (forces reload on next validation)
  npm run cli tld:cache:clear

  # Use custom API URL
  npm run cli tld:sync --api-url https://my-worker.workers.dev

TLD CATEGORIES
  trusted      - .edu, .gov, .mil (restricted registration)
  standard     - .com, .net, .org (normal commercial)
  suspicious   - .info, .biz (higher abuse rates)
  high_risk    - .tk, .ml, .ga (free, high abuse)

RISK MULTIPLIER
  0.2-0.5      - Trusted (very low risk)
  0.8-1.2      - Standard (normal risk)
  1.3-2.0      - Suspicious (elevated risk)
  2.0-3.0      - High risk (significant abuse)
`);
}

/**
 * Main command handler
 */
export default async function handler(args: string[], commandName: string) {
	const { values, positionals } = parseArgs({
		args,
		options: {
			help: { type: 'boolean', short: 'h' },
			'api-url': { type: 'string' },
		},
		allowPositionals: true,
	});

	if (values.help) {
		showHelp();
		return;
	}

	// Set global API URL if provided
	if (values['api-url']) {
		globalApiUrl = values['api-url'] as string;
	}

	// Extract subcommand from command name (e.g., "tld:sync" -> "sync")
	const subcommand = commandName.split(':')[1];

	switch (subcommand) {
		case 'sync':
			await syncProfiles();
			break;

		case 'metadata':
			await showMetadata();
			break;

		case 'get':
			if (positionals.length < 1) {
				logger.error('❌ TLD argument required');
				logger.info('Usage: npm run cli tld:get <tld>');
				process.exit(1);
			}
			await getProfile(positionals[0]);
			break;

		case 'update':
			if (positionals.length < 2) {
				logger.error('❌ TLD and updates JSON required');
				logger.info('Usage: npm run cli tld:update <tld> \'{"riskMultiplier": 1.5}\'');
				process.exit(1);
			}
			try {
				const updates = JSON.parse(positionals[1]);
				await updateProfile(positionals[0], updates);
			} catch (e) {
				logger.error('❌ Invalid JSON for updates');
				logger.error(e instanceof Error ? e.message : String(e));
				process.exit(1);
			}
			break;

		case 'cache:clear':
			await clearCache();
			break;

		default:
			logger.error(`❌ Unknown subcommand: ${subcommand || '(none)'}`);
			logger.info('');
			showHelp();
			process.exit(1);
	}
}
