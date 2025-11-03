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

	// Base Risk Scores (configurable overrides for specific conditions)
	baseRiskScores: {
		invalidFormat: number; // Risk score for invalid email format (default 0.8)
		disposableDomain: number; // Risk score for disposable domains (default 0.95)
		highEntropy: number; // Entropy threshold for high randomness (default 0.7)
	};

	// Detection Confidence Thresholds
	confidenceThresholds: {
		markovFraud: number; // Confidence threshold for Markov fraud detection (default 0.7)
		markovRisk: number; // Markov risk score threshold (default 0.6)
		patternRisk: number; // Pattern detection risk threshold (default 0.5)
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

	// Risk Scoring Weights (DEPRECATED in v2.0+)
	// These are kept for backwards compatibility but NOT used in scoring
	// v2.0+ uses pure algorithmic scoring (Markov confidence directly)
	// See docs/SCORING.md for current approach
	riskWeights: {
		entropy: number; // DEPRECATED - Not used
		domainReputation: number; // DEPRECATED - Now fixed at 0.2
		tldRisk: number; // DEPRECATED - Now fixed at 0.1
		patternDetection: number; // DEPRECATED - Not used
		markovChain: number; // DEPRECATED - Confidence used directly
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

	// Base risk scores for specific conditions
	baseRiskScores: {
		invalidFormat: 0.8, // Invalid email format gets high base risk
		disposableDomain: 0.95, // Disposable domains are nearly certain fraud
		highEntropy: 0.7, // Threshold for detecting random strings
	},

	// Detection confidence thresholds
	confidenceThresholds: {
		markovFraud: 0.7, // Markov must be 70%+ confident to flag fraud
		markovRisk: 0.6, // Markov risk contribution threshold
		patternRisk: 0.5, // Pattern detection risk threshold
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

	// Risk weights (DEPRECATED in v2.0+, kept for backwards compatibility only)
	// v2.0+ uses pure algorithmic scoring - Markov confidence directly, no multiplication
	// These values are ignored in current scoring logic
	// See calculateAlgorithmicRiskScore() in fraud-detection.ts for actual implementation
	// Current approach:
	// - Primary: Markov confidence (0-1) used directly
	// - Secondary: Pattern overrides (keyboard: 0.9, sequential: 0.8, dated: 0.7)
	// - Tertiary: Domain signals (reputation * 0.2 + TLD * 0.1)
	riskWeights: {
		entropy: 0.05, // DEPRECATED - Not used in v2.0+
		domainReputation: 0.10, // DEPRECATED - Now fixed at 0.2
		tldRisk: 0.10, // DEPRECATED - Now fixed at 0.1
		patternDetection: 0.50, // DEPRECATED - Pattern overrides used instead
		markovChain: 0.25, // DEPRECATED - Confidence used directly (no multiplication)
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
