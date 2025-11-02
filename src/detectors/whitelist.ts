/**
 * Pattern Whitelisting System
 *
 * Reduces false positives by allowing known-good patterns to bypass strict fraud detection.
 *
 * Use Cases:
 * - Corporate employee emails (employee1@company.com, emp_001@corp.com)
 * - Legitimate sequential patterns in business contexts
 * - Known vendors/partners
 * - Birth years in emails (john.1990@gmail.com)
 * - International names that might trigger gibberish detection
 *
 * Priority 2 improvement: Expected +2-3% accuracy (reduces false positives)
 */

import { logger } from '../logger';

export type WhitelistPatternType =
	| 'exact_email' // Exact email match
	| 'domain' // All emails from domain
	| 'local_part_regex' // Regex match on local part
	| 'pattern_family' // Pattern family signature match
	| 'email_regex'; // Full email regex match

export interface WhitelistEntry {
	id: string; // Unique identifier
	type: WhitelistPatternType;
	pattern: string; // Pattern value (email, domain, regex, etc.)
	description: string; // Human-readable description
	confidence: number; // 0.0-1.0, how much to reduce risk by
	enabled: boolean;
	createdAt: string; // ISO timestamp
	updatedAt: string; // ISO timestamp
	metadata?: {
		addedBy?: string;
		reason?: string;
		expiresAt?: string; // Optional expiration
		tags?: string[];
	};
}

export interface WhitelistConfig {
	version: string;
	entries: WhitelistEntry[];
	globalSettings: {
		enabled: boolean;
		maxReduction: number; // 0.0-1.0, maximum risk reduction allowed
		logMatches: boolean; // Log when whitelist matches
	};
}

export interface WhitelistResult {
	matched: boolean;
	matchedEntries: WhitelistEntry[];
	riskReduction: number; // Amount to reduce risk score by (0.0-1.0)
	reason: string;
}

/**
 * Default whitelist entries
 * These are common legitimate patterns that often trigger false positives
 */
const DEFAULT_WHITELIST_ENTRIES: WhitelistEntry[] = [
	// Common business patterns
	{
		id: 'business_employee_numeric',
		type: 'pattern_family',
		pattern: 'word.NUM@business',
		description: 'Corporate employee emails with numbers (e.g., employee1@company.com)',
		confidence: 0.7,
		enabled: true,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		metadata: {
			reason: 'Common pattern for corporate email systems',
			tags: ['business', 'corporate', 'sequential'],
		},
	},
	{
		id: 'business_employee_underscore',
		type: 'local_part_regex',
		pattern: '^(emp|employee|staff|user)_\\d{2,6}$',
		description: 'Corporate employee IDs with underscores (e.g., emp_12345)',
		confidence: 0.7,
		enabled: true,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		metadata: {
			reason: 'Standard employee numbering format',
			tags: ['business', 'corporate', 'employee_id'],
		},
	},

	// Birth year patterns
	{
		id: 'birth_year_pattern',
		type: 'local_part_regex',
		pattern: '^[a-z]+\\.(19[4-9]\\d|20[0-1]\\d)$',
		description: 'Names with birth years (e.g., john.1990, mary.2001)',
		confidence: 0.5,
		enabled: true,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		metadata: {
			reason: 'Common pattern for personal emails with birth years',
			tags: ['birth_year', 'personal'],
		},
	},
	{
		id: 'name_birth_year_dot',
		type: 'local_part_regex',
		pattern: '^[a-z]+\\.[a-z]+\\.(19[4-9]\\d|20[0-1]\\d)$',
		description: 'Firstname.lastname with birth year (e.g., john.doe.1990)',
		confidence: 0.6,
		enabled: true,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		metadata: {
			reason: 'Standard name.surname.birthyear format',
			tags: ['birth_year', 'personal', 'name'],
		},
	},

	// Common legitimate sequential patterns
	{
		id: 'dev_test_accounts',
		type: 'local_part_regex',
		pattern: '^(dev|test|qa|staging|demo)\\d{1,3}$',
		description: 'Development and testing accounts (e.g., dev1, test2)',
		confidence: 0.8,
		enabled: true,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		metadata: {
			reason: 'Legitimate testing/development accounts',
			tags: ['development', 'testing', 'internal'],
		},
	},

	// Trusted business domains (examples - should be customized per deployment)
	{
		id: 'known_business_domain_example',
		type: 'domain',
		pattern: 'acme.corp',
		description: 'Known business partner domain',
		confidence: 0.9,
		enabled: false, // Disabled by default - customize per deployment
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		metadata: {
			reason: 'Verified business partner',
			tags: ['partner', 'business', 'verified'],
		},
	},

	// International name patterns (reduces N-gram false positives)
	{
		id: 'double_letter_surnames',
		type: 'local_part_regex',
		pattern: '^[a-z]{2,15}\\.(ll|nn|tt|ss|pp|mm)[a-z]{2,10}$',
		description: 'Names with doubled consonants (common in Nordic/Baltic languages)',
		confidence: 0.4,
		enabled: true,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		metadata: {
			reason: 'Reduces false positives on non-English names',
			tags: ['international', 'name', 'n-gram'],
		},
	},

	// Plus-addressing for legitimate use
	{
		id: 'plus_addressing_keywords',
		type: 'local_part_regex',
		pattern: '^[a-z0-9._-]+\\+(newsletter|work|personal|shopping|receipts|alerts|notifications)$',
		description: 'Legitimate plus-addressing with semantic tags',
		confidence: 0.6,
		enabled: true,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		metadata: {
			reason: 'Common legitimate use of plus-addressing',
			tags: ['plus_addressing', 'legitimate'],
		},
	},
];

/**
 * Default whitelist configuration
 */
export const DEFAULT_WHITELIST_CONFIG: WhitelistConfig = {
	version: '1.0.0',
	entries: DEFAULT_WHITELIST_ENTRIES,
	globalSettings: {
		enabled: true,
		maxReduction: 0.4, // Maximum 40% risk reduction
		logMatches: true,
	},
};

/**
 * Check if an email matches whitelist patterns
 */
export function checkWhitelist(
	email: string,
	config: WhitelistConfig = DEFAULT_WHITELIST_CONFIG,
	patternFamily?: string
): WhitelistResult {
	// If whitelist is disabled, return no match
	if (!config.globalSettings.enabled) {
		return {
			matched: false,
			matchedEntries: [],
			riskReduction: 0,
			reason: 'Whitelist disabled',
		};
	}

	const [localPart, domain] = email.toLowerCase().split('@');
	const matchedEntries: WhitelistEntry[] = [];

	// Check each whitelist entry
	for (const entry of config.entries) {
		if (!entry.enabled) continue;

		let isMatch = false;

		switch (entry.type) {
			case 'exact_email':
				isMatch = email.toLowerCase() === entry.pattern.toLowerCase();
				break;

			case 'domain':
				isMatch = domain === entry.pattern.toLowerCase();
				break;

			case 'local_part_regex':
				try {
					const regex = new RegExp(entry.pattern, 'i');
					isMatch = regex.test(localPart);
				} catch (error) {
					logger.error({
						event: 'whitelist_regex_invalid',
						entry_id: entry.id,
						pattern_type: 'local_part_regex',
						error: error instanceof Error ? {
							message: error.message,
							stack: error.stack,
							name: error.name,
						} : String(error),
					}, 'Invalid regex in whitelist entry');
				}
				break;

			case 'email_regex':
				try {
					const regex = new RegExp(entry.pattern, 'i');
					isMatch = regex.test(email);
				} catch (error) {
					logger.error({
						event: 'whitelist_regex_invalid',
						entry_id: entry.id,
						pattern_type: 'email_regex',
						error: error instanceof Error ? {
							message: error.message,
							stack: error.stack,
							name: error.name,
						} : String(error),
					}, 'Invalid regex in whitelist entry');
				}
				break;

			case 'pattern_family':
				if (patternFamily) {
					// Normalize pattern family for comparison
					const normalizedFamily = patternFamily.toLowerCase();
					const normalizedPattern = entry.pattern.toLowerCase();

					// Allow wildcards in pattern
					if (normalizedPattern.includes('*')) {
						const regexPattern = normalizedPattern
							.replace(/\*/g, '.*')
							.replace(/\./g, '\\.');
						const regex = new RegExp(`^${regexPattern}$`, 'i');
						isMatch = regex.test(normalizedFamily);
					} else {
						isMatch = normalizedFamily.includes(normalizedPattern);
					}
				}
				break;
		}

		if (isMatch) {
			// Check if entry has expired
			if (entry.metadata?.expiresAt) {
				const expiresAt = new Date(entry.metadata.expiresAt);
				if (expiresAt < new Date()) {
					logger.info({
						event: 'whitelist_entry_expired',
						entry_id: entry.id,
						expires_at: entry.metadata.expiresAt,
					}, 'Whitelist entry has expired');
					continue;
				}
			}

			matchedEntries.push(entry);
		}
	}

	// Calculate total risk reduction
	if (matchedEntries.length === 0) {
		return {
			matched: false,
			matchedEntries: [],
			riskReduction: 0,
			reason: 'No whitelist matches',
		};
	}

	// Take maximum confidence from matched entries
	const maxConfidence = Math.max(...matchedEntries.map((e) => e.confidence));

	// Apply max reduction limit
	const riskReduction = Math.min(maxConfidence, config.globalSettings.maxReduction);

	// Build reason string
	const descriptions = matchedEntries.map((e) => e.description).join(', ');
	const reason = `Matched whitelist: ${descriptions}`;

	return {
		matched: true,
		matchedEntries,
		riskReduction,
		reason,
	};
}

/**
 * Load whitelist configuration from KV storage
 */
export async function loadWhitelistConfig(kv: KVNamespace): Promise<WhitelistConfig> {
	try {
		const stored = await kv.get<WhitelistConfig>('whitelist_config.json', 'json');

		if (stored && stored.version) {
			logger.info({
				event: 'whitelist_config_loaded',
				source: 'kv',
				version: stored.version,
			}, 'Loaded whitelist config from KV');
			return stored;
		}
	} catch (error) {
		logger.error({
			event: 'whitelist_config_load_failed',
			source: 'kv',
			error: error instanceof Error ? {
				message: error.message,
				stack: error.stack,
				name: error.name,
			} : String(error),
		}, 'Error loading whitelist config from KV');
	}

	logger.info({
		event: 'whitelist_config_default',
	}, 'Using default whitelist config');
	return DEFAULT_WHITELIST_CONFIG;
}

/**
 * Save whitelist configuration to KV storage
 */
export async function saveWhitelistConfig(
	kv: KVNamespace,
	config: WhitelistConfig
): Promise<void> {
	try {
		config.version = '1.0.0';
		await kv.put('whitelist_config.json', JSON.stringify(config, null, 2));
		logger.info({
			event: 'whitelist_config_saved',
			destination: 'kv',
			version: config.version,
		}, 'Saved whitelist config to KV');
	} catch (error) {
		logger.error({
			event: 'whitelist_config_save_failed',
			destination: 'kv',
			error: error instanceof Error ? {
				message: error.message,
				stack: error.stack,
				name: error.name,
			} : String(error),
		}, 'Error saving whitelist config to KV');
		throw error;
	}
}

/**
 * Add a new whitelist entry
 */
export function addWhitelistEntry(
	config: WhitelistConfig,
	entry: Omit<WhitelistEntry, 'id' | 'createdAt' | 'updatedAt'>
): WhitelistConfig {
	const newEntry: WhitelistEntry = {
		...entry,
		id: `custom_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	};

	return {
		...config,
		entries: [...config.entries, newEntry],
	};
}

/**
 * Remove a whitelist entry by ID
 */
export function removeWhitelistEntry(config: WhitelistConfig, entryId: string): WhitelistConfig {
	return {
		...config,
		entries: config.entries.filter((e) => e.id !== entryId),
	};
}

/**
 * Update a whitelist entry
 */
export function updateWhitelistEntry(
	config: WhitelistConfig,
	entryId: string,
	updates: Partial<Omit<WhitelistEntry, 'id' | 'createdAt'>>
): WhitelistConfig {
	return {
		...config,
		entries: config.entries.map((e) =>
			e.id === entryId
				? {
						...e,
						...updates,
						updatedAt: new Date().toISOString(),
				  }
				: e
		),
	};
}

/**
 * Get whitelist statistics
 */
export function getWhitelistStats(config: WhitelistConfig): {
	totalEntries: number;
	enabledEntries: number;
	byType: Record<WhitelistPatternType, number>;
} {
	const byType: Record<WhitelistPatternType, number> = {
		exact_email: 0,
		domain: 0,
		local_part_regex: 0,
		pattern_family: 0,
		email_regex: 0,
	};

	for (const entry of config.entries) {
		byType[entry.type]++;
	}

	return {
		totalEntries: config.entries.length,
		enabledEntries: config.entries.filter((e) => e.enabled).length,
		byType,
	};
}
