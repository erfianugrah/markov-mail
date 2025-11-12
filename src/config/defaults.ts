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
	actionOverride?: 'allow' | 'warn' | 'block' | null; // Override decision logic (null = no override)

	// Risk Scoring Weights (v2.4.2+)
	// Reintroduced with new meaning for tunable domain signal weights
	riskWeights: {
		domainReputation: number; // Weight for domain reputation signal (default 0.2)
		tldRisk: number;          // Weight for TLD risk signal (default 0.3)
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

	// Risk Adjustments (v2.4.2+)
	// Tunable factors for professional email leniency
	adjustments: {
		professionalEmailFactor: number;  // Classification risk reduction for professional emails (default 0.5)
		professionalDomainFactor: number; // Domain risk reduction for professional emails (default 0.5)
	};

	// Ensemble Configuration (v2.4.2+)
	// Boost scoring when multiple signals agree
	ensemble: {
		boostMultiplier: number;       // Boost when Markov + TLD agree (default 0.3)
		maxBoost: number;              // Max ensemble boost cap (default 0.3)
		tldAgreementThreshold: number; // TLD score threshold for agreement (default 0.5)
	};

	// OOD (Out-of-Distribution) Detection (v2.4.2+)
	// Tunable parameters for abnormality risk calculation
	ood: {
		maxRisk: number;     // Maximum abnormality risk contribution (default 0.65)
		warnZoneMin: number; // Starting risk in warn zone (default 0.35)
		// Note: OOD thresholds (3.8, 5.5) remain hardcoded (research-backed)
	};
}

/**
 * Default configuration values
 * These work out of the box with no additional setup
 */
export const DEFAULT_CONFIG: FraudDetectionConfig = {
	// Conservative defaults - balance security with false positives
	// Updated 2025-11-07: Tuned based on D1 analysis to reduce false positives
	riskThresholds: {
		block: 0.65, // Block high-risk emails (increased from 0.6)
		warn: 0.35, // Flag medium-risk for review (increased from 0.3)
	},

	// Base risk scores for specific conditions
	baseRiskScores: {
		invalidFormat: 0.8, // Invalid email format gets high base risk
		disposableDomain: 0.95, // Disposable domains are nearly certain fraud
		highEntropy: 0.7, // Threshold for detecting random strings
	},

	// Detection confidence thresholds
	// Updated 2025-11-07: Increased to reduce false positives on legitimate unusual names
	confidenceThresholds: {
		markovFraud: 0.75, // Markov must be 75%+ confident to flag fraud (increased from 0.7)
		markovRisk: 0.65, // Markov risk contribution threshold (increased from 0.6)
		patternRisk: 0.55, // Pattern detection risk threshold (increased from 0.5)
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

	// No action override by default (null = enforcement mode)
	actionOverride: null,

	// Risk weights (v2.4.2+)
	// Reintroduced with new meaning for tunable domain signal weights
	// v2.4.2: Used for domain reputation and TLD risk signal weights
	riskWeights: {
		domainReputation: 0.2, // Weight for domain reputation signal (was hardcoded at 0.2)
		tldRisk: 0.3,          // Weight for TLD risk signal (was hardcoded at 0.3)
	},

	// Pattern confidence thresholds
	// Updated 2025-11-07: Tuned to reduce false positives on legitimate patterns
	patternThresholds: {
		sequential: 0.8, // High confidence for sequential
		dated: 0.75, // Medium-high for dated patterns (increased from 0.7)
		plusAddressing: 0.7, // Medium confidence (increased from 0.6 - Gmail power users)
		keyboardWalk: 0.85, // High confidence for keyboard walks (increased from 0.8)
		gibberish: 0.85, // High confidence for gibberish (decreased from 0.9 - more sensitive)
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

	// Risk Adjustments (v2.4.2+)
	// Professional emails (info@, support@, admin@) get reduced risk scoring
	adjustments: {
		professionalEmailFactor: 0.5,  // Multiply classification risk by 0.5 for professional emails
		professionalDomainFactor: 0.5, // Multiply domain risk by 0.5 for professional emails
	},

	// Ensemble Configuration (v2.4.2+)
	// When Markov classification and TLD risk both signal fraud, boost confidence
	ensemble: {
		boostMultiplier: 0.3,       // Boost amount: classificationRisk * tldRiskScore * 0.3
		maxBoost: 0.3,              // Maximum boost cap (prevents over-confidence)
		tldAgreementThreshold: 0.5, // TLD score must exceed this to count as agreement
	},

	// OOD (Out-of-Distribution) Detection (v2.4.2+)
	// Detects patterns unfamiliar to both legitimate and fraudulent models
	ood: {
		maxRisk: 0.65,     // Maximum abnormality risk (was hardcoded, now tunable)
		warnZoneMin: 0.35, // Starting risk value in warn zone (3.8-5.5 nats)
		// Formula: abnormalityRisk = warnZoneMin + progress * (maxRisk - warnZoneMin)
		// Where progress = (minEntropy - 3.8) / (5.5 - 3.8)
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

	// Validate risk weights (v2.4.2+)
	if (config.riskWeights) {
		if (config.riskWeights.domainReputation < 0 || config.riskWeights.domainReputation > 1) {
			errors.push('riskWeights.domainReputation must be between 0 and 1');
		}
		if (config.riskWeights.tldRisk < 0 || config.riskWeights.tldRisk > 1) {
			errors.push('riskWeights.tldRisk must be between 0 and 1');
		}
	}

	// Validate adjustments (v2.4.2+)
	if (config.adjustments) {
		if (config.adjustments.professionalEmailFactor < 0 || config.adjustments.professionalEmailFactor > 1) {
			errors.push('adjustments.professionalEmailFactor must be between 0 and 1');
		}
		if (config.adjustments.professionalDomainFactor < 0 || config.adjustments.professionalDomainFactor > 1) {
			errors.push('adjustments.professionalDomainFactor must be between 0 and 1');
		}
	}

	// Validate ensemble (v2.4.2+)
	if (config.ensemble) {
		if (config.ensemble.boostMultiplier < 0 || config.ensemble.boostMultiplier > 1) {
			errors.push('ensemble.boostMultiplier must be between 0 and 1');
		}
		if (config.ensemble.maxBoost < 0 || config.ensemble.maxBoost > 1) {
			errors.push('ensemble.maxBoost must be between 0 and 1');
		}
		if (config.ensemble.tldAgreementThreshold < 0 || config.ensemble.tldAgreementThreshold > 1) {
			errors.push('ensemble.tldAgreementThreshold must be between 0 and 1');
		}
	}

	// Validate OOD (v2.4.2+)
	if (config.ood) {
		if (config.ood.maxRisk < 0 || config.ood.maxRisk > 1) {
			errors.push('ood.maxRisk must be between 0 and 1');
		}
		if (config.ood.warnZoneMin < 0 || config.ood.warnZoneMin > 1) {
			errors.push('ood.warnZoneMin must be between 0 and 1');
		}
		if (config.ood.warnZoneMin >= config.ood.maxRisk) {
			errors.push('ood.warnZoneMin must be less than ood.maxRisk');
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
