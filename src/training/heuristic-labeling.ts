/**
 * Heuristic Labeling for Training Data
 *
 * Automatically labels validation records as legit/fraud/ambiguous
 * based on confidence signals from detection systems.
 */

import type { ValidationRecord, LabelingResult } from './types';

/**
 * Apply heuristic labeling to a validation record
 */
export function applyHeuristicLabel(
	record: ValidationRecord,
	minConfidence: number = 0.8
): LabelingResult {
	const reasons: string[] = [];
	let label: 'legit' | 'fraud' | 'ambiguous' = 'ambiguous';
	let confidence = 0;

	// FRAUD INDICATORS (high confidence)
	const fraudIndicators = [];

	// 1. Blocked with high risk score
	if (record.decision === 'block' && record.riskScore >= 0.7) {
		fraudIndicators.push({
			weight: 0.9,
			reason: `Blocked with high risk (${record.riskScore.toFixed(2)})`
		});
	}

	// 2. Markov Chain detected with high confidence
	if (record.markovDetected && record.markovConfidence && record.markovConfidence >= 0.8) {
		fraudIndicators.push({
			weight: 0.85,
			reason: `Markov fraud detected (${record.markovConfidence.toFixed(2)})`
		});
	}

	// 3. Known fraud patterns
	// DEPRECATED (v2.2.0): Removed 'keyboard_walk' - now detected by Markov
	const fraudPatterns = ['sequential', 'dated'];
	if (record.patternFamily && fraudPatterns.includes(record.patternFamily)) {
		fraudIndicators.push({
			weight: 0.7,
			reason: `Fraud pattern: ${record.patternFamily}`
		});
	}

	// 4. Very high risk score (even if not blocked)
	if (record.riskScore >= 0.8) {
		fraudIndicators.push({
			weight: 0.75,
			reason: `Very high risk score (${record.riskScore.toFixed(2)})`
		});
	}

	// LEGIT INDICATORS (high confidence)
	const legitIndicators = [];

	// 1. Allowed with low risk score
	if (record.decision === 'allow' && record.riskScore < 0.3) {
		legitIndicators.push({
			weight: 0.9,
			reason: `Allowed with low risk (${record.riskScore.toFixed(2)})`
		});
	}

	// 2. Markov NOT detected with low confidence
	if (record.markovDetected === false || (record.markovConfidence && record.markovConfidence < 0.3)) {
		legitIndicators.push({
			weight: 0.8,
			reason: `Markov legit pattern (${(record.markovConfidence || 0).toFixed(2)})`
		});
	}

	// 3. Very low risk score
	if (record.riskScore < 0.2) {
		legitIndicators.push({
			weight: 0.85,
			reason: `Very low risk score (${record.riskScore.toFixed(2)})`
		});
	}

	// 4. Bot score indicates human (if available)
	if (record.botScore && record.botScore > 80) {
		legitIndicators.push({
			weight: 0.6,
			reason: `High bot score (human-like: ${record.botScore})`
		});
	}

	// AMBIGUOUS INDICATORS
	const ambiguousIndicators = [];

	// 1. Warn decision (middle ground)
	if (record.decision === 'warn') {
		ambiguousIndicators.push('Warn decision (uncertain)');
	}

	// 2. Risk score in middle range
	if (record.riskScore >= 0.3 && record.riskScore <= 0.7) {
		ambiguousIndicators.push(`Mid-range risk (${record.riskScore.toFixed(2)})`);
	}

	// 3. Conflicting signals
	if (fraudIndicators.length > 0 && legitIndicators.length > 0) {
		ambiguousIndicators.push('Conflicting signals detected');
	}

	// DECISION LOGIC

	// Calculate weighted scores
	const fraudScore = fraudIndicators.reduce((sum, ind) => sum + ind.weight, 0) /
		Math.max(1, fraudIndicators.length);
	const legitScore = legitIndicators.reduce((sum, ind) => sum + ind.weight, 0) /
		Math.max(1, legitIndicators.length);

	// Decide label based on scores
	if (fraudIndicators.length > 0 && fraudScore >= minConfidence && legitIndicators.length === 0) {
		// Strong fraud indicators, no legit indicators
		label = 'fraud';
		confidence = fraudScore;
		reasons.push(...fraudIndicators.map(i => i.reason));
	} else if (legitIndicators.length > 0 && legitScore >= minConfidence && fraudIndicators.length === 0) {
		// Strong legit indicators, no fraud indicators
		label = 'legit';
		confidence = legitScore;
		reasons.push(...legitIndicators.map(i => i.reason));
	} else {
		// Ambiguous: conflicting signals, low confidence, or middle ground
		label = 'ambiguous';
		confidence = Math.max(fraudScore, legitScore);
		reasons.push(...ambiguousIndicators);

		if (fraudIndicators.length > 0 && legitIndicators.length > 0) {
			reasons.push(`Conflict: ${fraudIndicators.length} fraud vs ${legitIndicators.length} legit signals`);
		} else if (confidence < minConfidence) {
			reasons.push(`Low confidence (${confidence.toFixed(2)} < ${minConfidence})`);
		}
	}

	return {
		label,
		confidence,
		reasons
	};
}

/**
 * Batch label multiple records
 */
export function batchLabel(
	records: ValidationRecord[],
	minConfidence: number = 0.8
): {
	legit: ValidationRecord[];
	fraud: ValidationRecord[];
	ambiguous: ValidationRecord[];
	stats: {
		total: number;
		legit: number;
		fraud: number;
		ambiguous: number;
	};
} {
	const legit: ValidationRecord[] = [];
	const fraud: ValidationRecord[] = [];
	const ambiguous: ValidationRecord[] = [];

	for (const record of records) {
		const result = applyHeuristicLabel(record, minConfidence);

		if (result.label === 'fraud' && result.confidence >= minConfidence) {
			fraud.push(record);
		} else if (result.label === 'legit' && result.confidence >= minConfidence) {
			legit.push(record);
		} else {
			ambiguous.push(record);
		}
	}

	return {
		legit,
		fraud,
		ambiguous,
		stats: {
			total: records.length,
			legit: legit.length,
			fraud: fraud.length,
			ambiguous: ambiguous.length
		}
	};
}

/**
 * Quality check: Ensure labeled data meets quality thresholds
 */
export function validateDatasetQuality(
	legit: ValidationRecord[],
	fraud: ValidationRecord[],
	minSamplesPerClass: number = 100
): {
	valid: boolean;
	issues: string[];
} {
	const issues: string[] = [];

	// Check minimum sample count
	if (legit.length < minSamplesPerClass) {
		issues.push(`Insufficient legit samples (${legit.length} < ${minSamplesPerClass})`);
	}

	if (fraud.length < minSamplesPerClass) {
		issues.push(`Insufficient fraud samples (${fraud.length} < ${minSamplesPerClass})`);
	}

	// Check class balance (should not be too imbalanced)
	const ratio = Math.max(legit.length, fraud.length) / Math.min(legit.length, fraud.length);
	if (ratio > 10) {
		issues.push(`Severe class imbalance (ratio: ${ratio.toFixed(1)}:1)`);
	}

	// Check for duplicate emails
	const legitEmails = new Set(legit.map(r => r.email));
	const fraudEmails = new Set(fraud.map(r => r.email));
	const overlap = [...legitEmails].filter(e => fraudEmails.has(e));

	if (overlap.length > 0) {
		issues.push(`${overlap.length} emails appear in both classes`);
	}

	return {
		valid: issues.length === 0,
		issues
	};
}
