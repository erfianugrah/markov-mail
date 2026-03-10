/**
 * TLD Risk Profile Updater Service
 *
 * Manages TLD (Top-Level Domain) risk profiles in KV storage.
 * Allows dynamic updates to risk scores without redeployment.
 *
 * Use cases:
 * - Adjust risk scores based on emerging abuse patterns
 * - A/B test different scoring strategies
 * - Integrate with external abuse databases
 * - Admin-controlled risk tuning
 */

import { logger } from '../logger';
import type { TLDRiskProfile } from '../detectors/tld-risk';

export interface TLDRiskUpdateResult {
	success: boolean;
	profilesCount: number;
	timestamp: string;
	error?: string;
}

/**
 * Load TLD risk profiles from KV (with caching)
 */
let cachedProfiles: Map<string, TLDRiskProfile> | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL = 86400000; // 24 hours (TLD risks change slowly)

export async function loadTLDRiskProfiles(
	kv: KVNamespace
): Promise<Map<string, TLDRiskProfile>> {
	// Return cached profiles if still valid
	const now = Date.now();
	if (cachedProfiles && (now - cacheTimestamp) < CACHE_TTL) {
		return cachedProfiles;
	}

	try {
		const profilesJson = await kv.get('tld_risk_profiles', 'json');

		// S11 fix: validate KV data at runtime instead of blind type cast.
		// Corrupted or tampered KV data could cause unexpected behavior.
		if (profilesJson && Array.isArray(profilesJson) && profilesJson.every(
			(p: any) => p && typeof p === 'object' && typeof p.tld === 'string'
		)) {
			// Convert array to Map for fast lookup
			cachedProfiles = new Map(
				profilesJson.map(profile => [profile.tld, profile])
			);
			cacheTimestamp = now;

			logger.info({
				event: 'tld_profiles_loaded_from_kv',
				count: cachedProfiles.size,
				cached: true
			}, `Loaded ${cachedProfiles.size} TLD profiles from KV`);

			return cachedProfiles;
		}

		logger.warn({
			event: 'tld_profiles_not_found_in_kv'
		}, 'No TLD profiles found in KV, using fallback');

		// Return empty map (caller should use hardcoded fallback)
		return new Map<string, TLDRiskProfile>();
	} catch (error) {
		logger.error({
			event: 'tld_profiles_load_failed',
			error: error instanceof Error ? error.message : String(error)
		}, 'Failed to load TLD profiles from KV');

		// Return cached profiles if available, even if expired
		if (cachedProfiles) {
			logger.warn({
				event: 'using_expired_cache',
				count: cachedProfiles.size
			}, 'Using expired cache due to KV load failure');
			return cachedProfiles;
		}

		return new Map<string, TLDRiskProfile>();
	}
}

/**
 * Update TLD risk profiles in KV storage
 *
 * @param kv - KV namespace
 * @param profiles - Array of TLD risk profiles
 * @returns Update result with success status
 */
export async function updateTLDRiskProfiles(
	kv: KVNamespace,
	profiles: TLDRiskProfile[]
): Promise<TLDRiskUpdateResult> {
	const startTime = Date.now();

	try {
		logger.info({
			event: 'tld_profiles_update_started',
			count: profiles.length
		}, `Updating ${profiles.length} TLD risk profiles`);

		// Validate profiles
		for (const profile of profiles) {
			if (!profile.tld || typeof profile.riskMultiplier !== 'number') {
				throw new Error(`Invalid profile: ${JSON.stringify(profile)}`);
			}
		}

		// Prepare metadata
		const metadata = {
			count: profiles.length,
			lastUpdated: new Date().toISOString(),
			version: '1.0.0',
			source: 'admin_api'
		};

		// Store in KV with metadata attached to the key
		await kv.put('tld_risk_profiles', JSON.stringify(profiles), {
			metadata: metadata
		});

		// Clear cache
		clearTLDCache();

		const duration = Date.now() - startTime;

		logger.info({
			event: 'tld_profiles_updated',
			count: profiles.length,
			duration_ms: duration,
			last_updated: metadata.lastUpdated
		}, `Successfully updated ${profiles.length} TLD risk profiles`);

		return {
			success: true,
			profilesCount: profiles.length,
			timestamp: metadata.lastUpdated
		};
	} catch (error) {
		const duration = Date.now() - startTime;

		logger.error({
			event: 'tld_profiles_update_failed',
			duration_ms: duration,
			error: error instanceof Error ? {
				message: error.message,
				stack: error.stack
			} : String(error)
		}, 'Failed to update TLD risk profiles');

		return {
			success: false,
			profilesCount: 0,
			timestamp: new Date().toISOString(),
			error: error instanceof Error ? error.message : String(error)
		};
	}
}

/**
 * Get TLD risk profiles metadata
 */
export async function getTLDRiskMetadata(
	kv: KVNamespace
): Promise<{
	count: number;
	lastUpdated: string;
	version: string;
	source: string;
} | null> {
	try {
		// Get metadata from the key itself
		const result = await kv.getWithMetadata('tld_risk_profiles');
		return result.metadata as any;
	} catch (error) {
		logger.error({
			event: 'tld_metadata_fetch_failed',
			error: error instanceof Error ? error.message : String(error)
		}, 'Failed to fetch TLD risk metadata');
		return null;
	}
}

/**
 * Clear the TLD profile cache (useful for testing or forcing reload)
 */
export function clearTLDCache(): void {
	cachedProfiles = null;
	cacheTimestamp = 0;
}

/**
 * Get a single TLD risk profile by TLD
 */
export async function getTLDRiskProfile(
	kv: KVNamespace,
	tld: string
): Promise<TLDRiskProfile | null> {
	const profiles = await loadTLDRiskProfiles(kv);
	return profiles.get(tld.toLowerCase()) || null;
}

/**
 * Update a single TLD risk profile
 */
export async function updateSingleTLDProfile(
	kv: KVNamespace,
	tld: string,
	updates: Partial<Omit<TLDRiskProfile, 'tld'>>
): Promise<TLDRiskUpdateResult> {
	try {
		// Load existing profiles
		const profiles = await loadTLDRiskProfiles(kv);
		const existing = profiles.get(tld.toLowerCase());

		if (!existing) {
			throw new Error(`TLD profile not found: ${tld}`);
		}

		// Merge updates
		const updated: TLDRiskProfile = {
			...existing,
			...updates,
			tld: existing.tld // Preserve original TLD
		};

		// Update in the profiles array
		const profilesArray = Array.from(profiles.values());
		const index = profilesArray.findIndex(p => p.tld === tld.toLowerCase());
		if (index !== -1) {
			profilesArray[index] = updated;
		}

		// Save back to KV
		return await updateTLDRiskProfiles(kv, profilesArray);
	} catch (error) {
		logger.error({
			event: 'single_tld_update_failed',
			tld,
			error: error instanceof Error ? error.message : String(error)
		}, `Failed to update TLD profile: ${tld}`);

		return {
			success: false,
			profilesCount: 0,
			timestamp: new Date().toISOString(),
			error: error instanceof Error ? error.message : String(error)
		};
	}
}
