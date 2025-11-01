/**
 * Default Configuration for Bogus Email Pattern Recognition
 *
 * These are sane defaults that allow the worker to function without any additional configuration.
 * Settings can be overridden by:
 * 1. KV configuration (runtime-editable via admin API)
 * 2. Environment variables (set in wrangler.jsonc)
 * 3. Worker secrets (for sensitive data)
 *
 * Priority: Secrets > Env Vars > KV Config > Defaults
 */

export interface FraudDetectionConfig {
	// Risk Thresholds
	riskThresholds: {
		block: number; // Risk score above which to block (0-1)
		warn: number; // Risk score above which to warn (0-1)
	};

	// Feature Toggles
	features: {
		enableMxCheck: boolean; // Enable MX record validation
		enableDisposableCheck: boolean; // Enable disposable domain detection
		enablePatternCheck: boolean; // Enable pattern detection
		enableNGramAnalysis: boolean; // Enable gibberish detection
		enableTLDRiskProfiling: boolean; // Enable TLD risk scoring
		enableBenfordsLaw: boolean; // Enable batch attack detection
		enableKeyboardWalkDetection: boolean; // Enable keyboard walk patterns
		enableMarkovChainDetection: boolean; // Enable Markov Chain pattern detection (Phase 7)
	};

	// Logging Configuration
	logging: {
		logAllValidations: boolean; // Log every validation
		logLevel: 'debug' | 'info' | 'warn' | 'error'; // Pino log level
		logBlocks: boolean; // Separate logging for blocks
	};

	// Custom Headers Configuration
	headers: {
		enableResponseHeaders: boolean; // Add fraud headers to responses
		enableOriginHeaders: boolean; // Forward fraud data to origin
		originUrl: string; // Origin URL to forward requests
	};

	// Action Override
	actionOverride: 'allow' | 'warn' | 'block'; // Override decision logic

	// Risk Scoring Weights (must sum to 1.0)
	riskWeights: {
		entropy: number; // 0-1
		domainReputation: number; // 0-1
		tldRisk: number; // 0-1
		patternDetection: number; // 0-1
		markovChain: number; // 0-1 (Phase 7)
	};

	// Pattern Detection Thresholds
	patternThresholds: {
		sequential: number; // Confidence threshold for sequential patterns
		dated: number; // Confidence threshold for dated patterns
		plusAddressing: number; // Confidence threshold for plus-addressing
		keyboardWalk: number; // Confidence threshold for keyboard walks
		gibberish: number; // Confidence threshold for gibberish
	};

	// Rate Limiting (if enabled in future)
	rateLimiting: {
		enabled: boolean;
		maxValidationsPerMinute: number; // Per fingerprint
		maxValidationsPerHour: number; // Per fingerprint
	};

	// Admin API Configuration
	admin: {
		enabled: boolean; // Enable admin endpoints
		// Note: ADMIN_API_KEY should be set as a Worker secret
	};

	// Markov Chain Configuration (Phase 7)
	markov: {
		adaptationRate: number; // Training adaptation rate (0-1, default 0.5)
		minTrainingExamples: number; // Minimum examples to train (default 100)
		retrainIntervalDays: number; // Days between retraining (default 7)
	};
}

/**
 * Default configuration values
 * These work out of the box with no additional setup
 */
export const DEFAULT_CONFIG: FraudDetectionConfig = {
	// Conservative defaults - balance security with false positives
	riskThresholds: {
		block: 0.6, // Block high-risk emails
		warn: 0.3, // Flag medium-risk for review
	},

	// Enable all detection features by default
	features: {
		enableMxCheck: false, // Disabled by default (DNS overhead)
		enableDisposableCheck: true, // Recommended
		enablePatternCheck: true, // Recommended
		enableNGramAnalysis: true, // Phase 6A feature
		enableTLDRiskProfiling: true, // Phase 6A feature
		enableBenfordsLaw: true, // Batch detection
		enableKeyboardWalkDetection: true, // Multi-layout keyboard walks
		enableMarkovChainDetection: true, // Phase 7 feature (high accuracy)
	},

	// Comprehensive logging for observability
	logging: {
		logAllValidations: true, // Log everything for analytics
		logLevel: 'info', // Standard logging
		logBlocks: true, // Track all blocks
	},

	// Headers enabled for easy integration
	headers: {
		enableResponseHeaders: true, // Useful for debugging
		enableOriginHeaders: false, // Disabled by default (requires ORIGIN_URL)
		originUrl: '', // Must be configured
	},

	// No action override by default
	actionOverride: 'allow',

	// Risk weights based on Phase 7 tuning with Markov Chains
	// Bergholz et al. (2008): DMC features alone achieved 97.95% F-measure
	riskWeights: {
		entropy: 0.15, // 15% weight on randomness (reduced to make room for Markov)
		domainReputation: 0.10, // 10% on domain quality
		tldRisk: 0.10, // 10% on TLD risk
		patternDetection: 0.40, // 40% on pattern matching (reduced from 50%)
		markovChain: 0.25, // 25% on Markov Chain detection (Phase 7 - high accuracy)
	},

	// Pattern confidence thresholds
	patternThresholds: {
		sequential: 0.8, // High confidence for sequential
		dated: 0.7, // Medium-high for dated patterns
		plusAddressing: 0.6, // Medium confidence
		keyboardWalk: 0.8, // High confidence for keyboard walks
		gibberish: 0.9, // Very high confidence for gibberish
	},

	// Rate limiting disabled by default (requires Durable Objects)
	rateLimiting: {
		enabled: false,
		maxValidationsPerMinute: 60,
		maxValidationsPerHour: 1000,
	},

	// Admin API disabled by default (enable with ADMIN_API_KEY secret)
	admin: {
		enabled: false,
	},

	// Markov Chain Configuration (Phase 7)
	markov: {
		adaptationRate: 0.5, // Skip examples within 0.5 std dev (saves ~40% memory)
		minTrainingExamples: 100, // Minimum examples needed for reliable model
		retrainIntervalDays: 7, // Retrain weekly to capture new patterns
	},
};

/**
 * Configuration keys that should not be stored in KV
 * These are sensitive or system-level settings
 */
export const SENSITIVE_CONFIG_KEYS = [
	'admin',
	'headers.originUrl', // May contain sensitive URLs
];

/**
 * Validate configuration values
 */
export function validateConfig(config: Partial<FraudDetectionConfig>): {
	valid: boolean;
	errors: string[];
} {
	const errors: string[] = [];

	// Validate risk thresholds
	if (config.riskThresholds) {
		const { block, warn } = config.riskThresholds;
		if (block < 0 || block > 1) {
			errors.push('riskThresholds.block must be between 0 and 1');
		}
		if (warn < 0 || warn > 1) {
			errors.push('riskThresholds.warn must be between 0 and 1');
		}
		if (warn >= block) {
			errors.push('riskThresholds.warn must be less than riskThresholds.block');
		}
	}

	// Validate risk weights sum to ~1.0 (allow small floating point error)
	if (config.riskWeights) {
		const sum =
			config.riskWeights.entropy +
			config.riskWeights.domainReputation +
			config.riskWeights.tldRisk +
			config.riskWeights.patternDetection +
			(config.riskWeights.markovChain || 0);

		if (Math.abs(sum - 1.0) > 0.01) {
			errors.push(`riskWeights must sum to 1.0 (currently ${sum.toFixed(2)})`);
		}
	}

	// Validate pattern thresholds
	if (config.patternThresholds) {
		for (const [key, value] of Object.entries(config.patternThresholds)) {
			if (value < 0 || value > 1) {
				errors.push(`patternThresholds.${key} must be between 0 and 1`);
			}
		}
	}

	// Validate action override
	if (config.actionOverride && !['allow', 'warn', 'block'].includes(config.actionOverride)) {
		errors.push('actionOverride must be "allow", "warn", or "block"');
	}

	return {
		valid: errors.length === 0,
		errors,
	};
}
