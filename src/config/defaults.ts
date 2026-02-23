/**
 * Decision-tree configuration defaults.
 *
 * The reset branch keeps the runtime intentionally small: we only need enough
 * knobs to control warn/block thresholds, deterministic overrides, domain/TLD
 * weights, and a few feature flags. Everything else (training & model tuning)
 * now lives offline.
 */

export interface FraudDetectionConfig {
	riskThresholds: {
		block: number;
		warn: number;
	};
	baseRiskScores: {
		invalidFormat: number;
		disposableDomain: number;
	};
	features: {
		enableDisposableCheck: boolean;
		enablePatternCheck: boolean;
		enableTLDRiskProfiling: boolean;
		enableMXCheck: boolean;
	};
	logging: {
		logAllValidations: boolean;
		logLevel: 'debug' | 'info' | 'warn' | 'error';
		logBlocks: boolean;
	};
	headers: {
		enableResponseHeaders: boolean;
		enableOriginHeaders: boolean;
		originUrl: string;
	};
	actionOverride?: 'allow' | 'warn' | 'block' | null;
	riskWeights: {
		domainReputation: number;
		tldRisk: number;
	};
	patternThresholds: {
		sequential: number;
		dated: number;
		plusAddressing: number;
	};
	rateLimiting: {
		enabled: boolean;
		maxValidationsPerMinute: number;
		maxValidationsPerHour: number;
	};
	admin: {
		enabled: boolean;
	};
	adjustments: {
		professionalEmailFactor: number;
		professionalDomainFactor: number;
		professionalAbnormalityFactor: number;
	};
	ood: {
		maxRisk: number;
		warnZoneMin: number;
	};
}

export const DEFAULT_CONFIG: FraudDetectionConfig = {
	riskThresholds: {
		block: 0.65,
		warn: 0.35,
	},
	baseRiskScores: {
		invalidFormat: 0.8,
		disposableDomain: 0.95,
	},
	features: {
		enableDisposableCheck: true,
		enablePatternCheck: true,
		enableTLDRiskProfiling: true,
		enableMXCheck: true,
	},
	logging: {
		logAllValidations: true,
		logLevel: 'info',
		logBlocks: true,
	},
	headers: {
		enableResponseHeaders: true,
		enableOriginHeaders: false,
		originUrl: '',
	},
	actionOverride: null,
	riskWeights: {
		domainReputation: 0.2,
		tldRisk: 0.3,
	},
	patternThresholds: {
		sequential: 0.6,
		dated: 0.75,
		plusAddressing: 0.7,
	},
	rateLimiting: {
		enabled: false,
		maxValidationsPerMinute: 60,
		maxValidationsPerHour: 1000,
	},
	admin: {
		enabled: false,
	},
	adjustments: {
		professionalEmailFactor: 0.5,
		professionalDomainFactor: 0.5,
		professionalAbnormalityFactor: 0.6,
	},
	ood: {
		maxRisk: 0.85,
		warnZoneMin: 0.6,
	},
};

export const SENSITIVE_CONFIG_KEYS = ['admin', 'headers.originUrl'];

export function validateConfig(config: Partial<FraudDetectionConfig>): {
	valid: boolean;
	errors: string[];
} {
	const errors: string[] = [];

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

	if (config.riskWeights) {
		if (config.riskWeights.domainReputation < 0 || config.riskWeights.domainReputation > 1) {
			errors.push('riskWeights.domainReputation must be between 0 and 1');
		}
		if (config.riskWeights.tldRisk < 0 || config.riskWeights.tldRisk > 1) {
			errors.push('riskWeights.tldRisk must be between 0 and 1');
		}
	}

	if (config.adjustments) {
		if (config.adjustments.professionalEmailFactor < 0 || config.adjustments.professionalEmailFactor > 1) {
			errors.push('adjustments.professionalEmailFactor must be between 0 and 1');
		}
		if (config.adjustments.professionalDomainFactor < 0 || config.adjustments.professionalDomainFactor > 1) {
			errors.push('adjustments.professionalDomainFactor must be between 0 and 1');
		}
		if (
			config.adjustments.professionalAbnormalityFactor < 0 ||
			config.adjustments.professionalAbnormalityFactor > 1
		) {
			errors.push('adjustments.professionalAbnormalityFactor must be between 0 and 1');
		}
	}

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

	if (config.patternThresholds) {
		for (const [key, value] of Object.entries(config.patternThresholds)) {
			if (value < 0 || value > 1) {
				errors.push(`patternThresholds.${key} must be between 0 and 1`);
			}
		}
	}

	if (config.actionOverride && !['allow', 'warn', 'block'].includes(config.actionOverride)) {
		errors.push('actionOverride must be "allow", "warn", or "block"');
	}

	return {
		valid: errors.length === 0,
		errors,
	};
}
