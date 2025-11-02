/**
 * A/B Test Variant Assignment Logic
 *
 * Implements consistent hash-based traffic splitting to ensure users
 * are consistently assigned to the same variant throughout the experiment.
 */

import type { ABTestConfig, ABVariant, ABTestAssignment } from './types';
import type { FraudDetectionConfig } from '../config/defaults';

/**
 * Assign variant based on fingerprint hash (consistent hashing)
 *
 * Uses the first 8 characters of the fingerprint hash to determine
 * which bucket (0-99) the user falls into, then maps to variant
 * based on experiment weights.
 *
 * @example
 * // 90/10 split (control=90%, treatment=10%)
 * // Bucket 0-89 → control
 * // Bucket 90-99 → treatment
 */
export function getVariant(fingerprintHash: string, config: ABTestConfig): ABVariant {
	// Use first 8 characters of hash for bucket assignment
	const hashSegment = fingerprintHash.substring(0, 8);
	const hashValue = parseInt(hashSegment, 16);

	// Map to 0-99 bucket
	const bucket = hashValue % 100;

	// Assign based on weights
	// Treatment weight is percentage of traffic (e.g., 10 = 10%)
	// Buckets 0-(weight-1) → treatment
	// Buckets weight-99 → control
	return bucket < config.variants.treatment.weight ? 'treatment' : 'control';
}

/**
 * Get full assignment details for logging
 */
export function getAssignment(fingerprintHash: string, config: ABTestConfig): ABTestAssignment {
	const hashSegment = fingerprintHash.substring(0, 8);
	const hashValue = parseInt(hashSegment, 16);
	const bucket = hashValue % 100;
	const variant = getVariant(fingerprintHash, config);

	return {
		fingerprintHash,
		variant,
		experimentId: config.experimentId,
		bucket,
	};
}

/**
 * Merge base config with variant-specific overrides
 *
 * Performs deep merge to handle nested objects like riskWeights
 */
export function getVariantConfig(
	variant: ABVariant,
	abConfig: ABTestConfig,
	baseConfig: FraudDetectionConfig
): FraudDetectionConfig {
	const variantOverrides = abConfig.variants[variant].config || {};

	// Deep merge config (handle nested objects like riskWeights)
	return deepMerge(baseConfig, variantOverrides) as FraudDetectionConfig;
}

/**
 * Deep merge utility for config objects
 *
 * Recursively merges source into target, with source taking precedence
 */
function deepMerge(target: any, source: any): any {
	const output = { ...target };

	for (const key in source) {
		if (source[key] instanceof Object && key in target && !(source[key] instanceof Array)) {
			output[key] = deepMerge(target[key], source[key]);
		} else {
			output[key] = source[key];
		}
	}

	return output;
}

/**
 * Check if experiment is currently active
 */
export function isExperimentActive(config: ABTestConfig): boolean {
	if (!config.enabled) return false;

	const now = new Date();
	const start = new Date(config.startDate);
	const end = new Date(config.endDate);

	return now >= start && now <= end;
}

/**
 * Validate experiment configuration
 */
export function validateExperimentConfig(config: ABTestConfig): { valid: boolean; errors: string[] } {
	const errors: string[] = [];

	// Validate weights
	const totalWeight = config.variants.control.weight + config.variants.treatment.weight;
	if (totalWeight !== 100) {
		errors.push(`Variant weights must sum to 100 (currently ${totalWeight})`);
	}

	if (config.variants.control.weight < 0 || config.variants.control.weight > 100) {
		errors.push('Control weight must be between 0 and 100');
	}

	if (config.variants.treatment.weight < 0 || config.variants.treatment.weight > 100) {
		errors.push('Treatment weight must be between 0 and 100');
	}

	// Validate dates
	const start = new Date(config.startDate);
	const end = new Date(config.endDate);

	if (isNaN(start.getTime())) {
		errors.push('Invalid startDate format (must be ISO 8601)');
	}

	if (isNaN(end.getTime())) {
		errors.push('Invalid endDate format (must be ISO 8601)');
	}

	if (start >= end) {
		errors.push('startDate must be before endDate');
	}

	// Validate experiment ID
	if (!config.experimentId || config.experimentId.length === 0) {
		errors.push('experimentId is required');
	}

	return {
		valid: errors.length === 0,
		errors,
	};
}
