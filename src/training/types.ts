/**
 * Types for Continuous Learning Pipeline
 */

/**
 * Raw validation result from Analytics Engine
 */
export interface ValidationRecord {
	email: string;
	decision: 'block' | 'allow' | 'warn';
	riskScore: number;
	confidence: number;

	// Pattern signals
	patternFamily?: string;
	entropyCategory?: string;

	// Markov signals
	markovDetected?: boolean;
	markovConfidence?: number;

	// Bot management
	botScore?: number;

	// Metadata
	timestamp: string;
	consumer?: string;
	flow?: string;
}

/**
 * Labeled training sample
 */
export interface TrainingSample {
	email: string;
	localPart: string;
	label: 'legit' | 'fraud';
	confidence: number;
	source: 'heuristic' | 'manual' | 'whitelist';
	signals: {
		decision: string;
		riskScore: number;
		markovDetected?: boolean;
		markovConfidence?: number;
		patternFamily?: string;
	};
	timestamp: string;
}

/**
 * Training dataset stored in KV
 */
export interface TrainingDataset {
	date: string;
	version: string;
	source: 'production_analytics' | 'manual_review';
	samples: {
		legit: TrainingSample[];
		fraud: TrainingSample[];
	};
	stats: {
		totalLegit: number;
		totalFraud: number;
		avgLegitConfidence: number;
		avgFraudConfidence: number;
		ambiguousCount: number;
		extractionDuration: number;
	};
	config: {
		minConfidence: number;
		daysExtracted: number;
		filters: string[];
	};
}

/**
 * Heuristic labeling result
 */
export interface LabelingResult {
	label: 'legit' | 'fraud' | 'ambiguous';
	confidence: number;
	reasons: string[];
}
