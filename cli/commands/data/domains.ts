#!/usr/bin/env bun
/**
 * Disposable Domains Management CLI
 *
 * Commands for managing the disposable email domains list
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
		sources: string[];
	};
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
async function apiRequest(endpoint: string, method = 'GET'): Promise<ApiResponse> {
	const { apiUrl, apiKey } = getApiConfig();
	const url = `${apiUrl}${endpoint}`;

	logger.info(`Making ${method} request to ${url}`);

	const response = await fetch(url, {
		method,
		headers: {
			'X-API-Key': apiKey,
			'Content-Type': 'application/json',
		},
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`API request failed: ${response.status} - ${text}`);
	}

	return await response.json();
}

/**
 * Update disposable domains from external sources
 */
async function updateDomains() {
	logger.info('🔄 Triggering disposable domain update...\n');

	try {
		const startTime = Date.now();
		const result = await apiRequest('/admin/disposable-domains/update', 'POST');

		const duration = Date.now() - startTime;

		if (result.success) {
			const domainResult = result.result as { domainsCount: number; timestamp: string };

			logger.success(`✅ Update completed successfully!`);
			logger.info('');
			logger.info(`📊 Results:`);
			logger.info(`   Domains fetched: ${domainResult.domainsCount.toLocaleString()}`);
			logger.info(`   Updated at:      ${new Date(domainResult.timestamp).toLocaleString()}`);
			logger.info(`   Duration:        ${duration}ms`);
			logger.info('');
			logger.info('💡 Domains are now cached and will be used in validation');
		} else {
			logger.error(`❌ Update failed: ${result.error || result.message}`);
			process.exit(1);
		}
	} catch (error) {
		logger.error('❌ Failed to update domains');
		logger.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}

/**
 * Show disposable domains metadata
 */
async function showMetadata() {
	logger.info('📊 Fetching disposable domains metadata...\n');

	try {
		const result = await apiRequest('/admin/disposable-domains/metadata', 'GET');

		if (result.success && result.metadata) {
			const { count, lastUpdated, version, sources } = result.metadata;

			logger.success('✅ Metadata retrieved successfully!\n');
			logger.info('📊 Disposable Domains List:');
			logger.info(`   Total domains:   ${count.toLocaleString()}`);
			logger.info(`   Last updated:    ${new Date(lastUpdated).toLocaleString()}`);
			logger.info(`   Version:         ${version}`);
			logger.info(`   Sources:         ${sources.join(', ')}`);
			logger.info('');

			// Calculate time since last update
			const lastUpdateTime = new Date(lastUpdated).getTime();
			const now = Date.now();
			const hoursAgo = Math.floor((now - lastUpdateTime) / (1000 * 60 * 60));
			const minutesAgo = Math.floor((now - lastUpdateTime) / (1000 * 60)) % 60;

			if (hoursAgo === 0) {
				logger.info(`⏰ Updated ${minutesAgo} minute${minutesAgo !== 1 ? 's' : ''} ago`);
			} else {
				logger.info(`⏰ Updated ${hoursAgo} hour${hoursAgo !== 1 ? 's' : ''} and ${minutesAgo} minute${minutesAgo !== 1 ? 's' : ''} ago`);
			}

			// Show next update time (cron runs every 6 hours)
			const nextUpdate = new Date(lastUpdateTime + 6 * 60 * 60 * 1000);
			logger.info(`📅 Next auto-update: ${nextUpdate.toLocaleString()}`);
		} else {
			logger.warn('⚠️  No disposable domain data found');
			logger.info('💡 Run "npm run cli domains:update" to fetch domains');
		}
	} catch (error) {
		logger.error('❌ Failed to fetch metadata');
		logger.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}

/**
 * Clear disposable domains cache
 */
async function clearCache() {
	logger.info('🗑️  Clearing disposable domains cache...\n');

	try {
		const result = await apiRequest('/admin/disposable-domains/cache', 'DELETE');

		if (result.success) {
			logger.success('✅ Cache cleared successfully!');
			logger.info('');
			logger.info(result.message || '');
			logger.info('💡 Next validation will reload domains from KV');
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
║            🗑️  Disposable Domains Management                  ║
╚═══════════════════════════════════════════════════════════════╝

COMMANDS
  update                Update domains from external sources
  metadata              Show metadata about the domains list
  cache:clear           Clear the domains cache

ENVIRONMENT VARIABLES
  ADMIN_API_KEY         API key for admin endpoints (required)
  API_URL               API base URL (default: https://your-worker.workers.dev)

OPTIONS
  --api-url <url>       Override API URL (default: $API_URL or https://your-worker.workers.dev)
  --help, -h            Show this help message

EXAMPLES
  # Update domains from GitHub
  npm run cli domains:update

  # View metadata
  npm run cli domains:metadata

  # Clear cache (forces reload on next validation)
  npm run cli domains:cache:clear

  # Use custom API URL
  npm run cli domains:update --api-url https://my-worker.workers.dev
`);
}

/**
 * Main command handler
 */
export default async function handler(args: string[], commandName: string) {
	const { values } = parseArgs({
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

	// Extract subcommand from command name (e.g., "domains:update" -> "update")
	const subcommand = commandName.split(':')[1];

	switch (subcommand) {
		case 'update':
			await updateDomains();
			break;

		case 'metadata':
			await showMetadata();
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
