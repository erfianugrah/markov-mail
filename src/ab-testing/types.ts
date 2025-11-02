/**
 * A/B Testing Framework Types
 *
 * Enables data-driven optimization through controlled experiments.
 * Used to validate improvements like Bot Management, Ensemble Markov, and Continuous Learning.
 */

import type { FraudDetectionConfig } from '../config/defaults';

export type ABVariant = 'control' | 'treatment';

export interface ABTestConfig {
	// Experiment identification
	experimentId: string;
	description: string;

	// Traffic allocation
	variants: {
		control: {
			weight: number; // 0-100 (e.g., 90 for 90%)
			config?: Partial<FraudDetectionConfig>; // Config overrides
		};
		treatment: {
			weight: number; // 0-100 (e.g., 10 for 10%)
			config?: Partial<FraudDetectionConfig>; // Config overrides
		};
	};

	// Experiment timeline
	startDate: string; // ISO 8601
	endDate: string; // ISO 8601
	enabled: boolean;

	// Metadata for tracking
	metadata?: {
		hypothesis: string;
		expectedImpact: string;
		successMetrics: string[];
		owner?: string;
		tags?: string[];
	};
}

export interface ABTestResult {
	variant: ABVariant;
	experimentId: string;
	config: FraudDetectionConfig;
	assignedAt: string;
}

export interface ABTestAssignment {
	fingerprintHash: string;
	variant: ABVariant;
	experimentId: string;
	bucket: number; // 0-99
}

/**
 * Analytics fields for A/B testing
 * These should be added to the analytics event
 */
export interface ABAnalyticsFields {
	experimentId?: string;
	variant?: ABVariant;
	bucket?: number;
}
