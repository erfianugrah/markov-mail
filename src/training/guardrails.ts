/**
 * Training Guardrails
 *
 * Validates a trained model before it is allowed to be uploaded to KV.
 * Performs threshold scanning and constraint verification to ensure the
 * model meets minimum quality standards.
 *
 * This is the in-process equivalent of cli/commands/model/guardrail.ts,
 * but without shelling out to Python scripts. Runs entirely in TypeScript
 * inside the container or during testing.
 */

import type { ForestModel } from '../detectors/forest-engine';
import { validateForestModel } from '../detectors/forest-engine';
import { applyPlattScaling } from './platt-scaling';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GuardrailConfig {
	/** Minimum recall required (default: 0.95) */
	minRecall: number;
	/** Maximum false positive rate (default: 0.05) */
	maxFpr: number;
	/** Maximum false negative rate (default: 0.05) */
	maxFnr: number;
	/** Minimum gap between warn and block thresholds (default: 0.01) */
	minGap: number;
	/** Threshold scan range: start (default: 0.05) */
	scanStart: number;
	/** Threshold scan range: end (default: 0.95) */
	scanEnd: number;
	/** Threshold scan step size (default: 0.01) */
	scanStep: number;
	/** Maximum model JSON size in bytes (default: 25 * 1024 * 1024) */
	maxModelSizeBytes: number;
}

export const DEFAULT_GUARDRAIL_CONFIG: GuardrailConfig = {
	minRecall: 0.95,
	maxFpr: 0.05,
	maxFnr: 0.05,
	minGap: 0.01,
	scanStart: 0.05,
	scanEnd: 0.95,
	scanStep: 0.01,
	maxModelSizeBytes: 25 * 1024 * 1024,
};

export interface ThresholdEntry {
	threshold: number;
	/** True positive rate (sensitivity/recall) */
	recall: number;
	/** False positive rate */
	fpr: number;
	/** False negative rate */
	fnr: number;
	/** Precision */
	precision: number;
	/** F1 score */
	f1: number;
}

export interface ThresholdRecommendation {
	warnThreshold: number;
	blockThreshold: number;
	warnMetrics: ThresholdEntry;
	blockMetrics: ThresholdEntry;
}

export interface GuardrailResult {
	passed: boolean;
	recommendation: ThresholdRecommendation | null;
	thresholdScan: ThresholdEntry[];
	modelValid: boolean;
	modelSizeBytes: number;
	/** If failed, human-readable reasons */
	failures: string[];
}

// ---------------------------------------------------------------------------
// Threshold scanning
// ---------------------------------------------------------------------------

/**
 * Scan calibrated predictions across a range of thresholds and compute
 * classification metrics at each point.
 *
 * @param calibratedScores  Platt-calibrated probabilities (0-1)
 * @param labels            True binary labels (0 or 1)
 * @param config            Scan range configuration
 */
export function scanThresholds(
	calibratedScores: number[],
	labels: number[],
	config: GuardrailConfig = DEFAULT_GUARDRAIL_CONFIG,
): ThresholdEntry[] {
	const n = calibratedScores.length;
	if (n !== labels.length) {
		throw new Error(`Score count ${n} does not match label count ${labels.length}`);
	}

	let totalPos = 0;
	let totalNeg = 0;
	for (let i = 0; i < n; i++) {
		if (labels[i] === 1) totalPos++;
		else totalNeg++;
	}

	if (totalPos === 0 || totalNeg === 0) {
		throw new Error(
			`Threshold scan requires both classes. Got ${totalPos} positive, ${totalNeg} negative.`
		);
	}

	const entries: ThresholdEntry[] = [];

	for (
		let threshold = config.scanStart;
		threshold <= config.scanEnd + config.scanStep / 2;
		threshold += config.scanStep
	) {
		const t = Math.round(threshold * 1000) / 1000; // avoid float drift

		let tp = 0;
		let fp = 0;
		let tn = 0;
		let fn = 0;

		for (let i = 0; i < n; i++) {
			const predicted = calibratedScores[i] >= t ? 1 : 0;
			const actual = labels[i];

			if (predicted === 1 && actual === 1) tp++;
			else if (predicted === 1 && actual === 0) fp++;
			else if (predicted === 0 && actual === 0) tn++;
			else fn++;
		}

		const recall = totalPos > 0 ? tp / totalPos : 0;
		const fpr = totalNeg > 0 ? fp / totalNeg : 0;
		const fnr = totalPos > 0 ? fn / totalPos : 0;
		const precision = (tp + fp) > 0 ? tp / (tp + fp) : 0;
		const f1 = (precision + recall) > 0 ? 2 * precision * recall / (precision + recall) : 0;

		entries.push({
			threshold: t,
			recall: Math.round(recall * 1e6) / 1e6,
			fpr: Math.round(fpr * 1e6) / 1e6,
			fnr: Math.round(fnr * 1e6) / 1e6,
			precision: Math.round(precision * 1e6) / 1e6,
			f1: Math.round(f1 * 1e6) / 1e6,
		});
	}

	return entries;
}

// ---------------------------------------------------------------------------
// Threshold recommendation
// ---------------------------------------------------------------------------

/**
 * Find optimal warn and block thresholds from a threshold scan.
 *
 * Strategy:
 *   - Warn threshold: lowest threshold where recall >= minRecall and FPR <= maxFpr
 *     (catches as many fraudsters as possible with acceptable false positive rate)
 *   - Block threshold: highest threshold where recall >= minRecall and FNR <= maxFnr
 *     (high confidence blocking with acceptable false negative rate)
 *   - Gap: blockThreshold - warnThreshold >= minGap
 */
function findThresholds(
	scan: ThresholdEntry[],
	config: GuardrailConfig,
): ThresholdRecommendation | null {
	// Find candidates for warn threshold (scan low to high)
	// Warn should be the lower threshold — flag suspicious but don't block
	let warnEntry: ThresholdEntry | null = null;
	for (const entry of scan) {
		if (entry.recall >= config.minRecall && entry.fpr <= config.maxFpr && entry.fnr <= config.maxFnr) {
			warnEntry = entry;
			break; // first (lowest) qualifying threshold
		}
	}

	// Find candidates for block threshold (scan high to low)
	// Block should be the higher threshold — high confidence
	let blockEntry: ThresholdEntry | null = null;
	for (let i = scan.length - 1; i >= 0; i--) {
		if (scan[i].recall >= config.minRecall && scan[i].fpr <= config.maxFpr && scan[i].fnr <= config.maxFnr) {
			blockEntry = scan[i];
			break; // last (highest) qualifying threshold
		}
	}

	if (!warnEntry || !blockEntry) {
		return null;
	}

	// Ensure warn < block with minimum gap
	if (blockEntry.threshold - warnEntry.threshold < config.minGap) {
		return null;
	}

	return {
		warnThreshold: warnEntry.threshold,
		blockThreshold: blockEntry.threshold,
		warnMetrics: warnEntry,
		blockMetrics: blockEntry,
	};
}

// ---------------------------------------------------------------------------
// Model structural validation
// ---------------------------------------------------------------------------

function validateModelStructure(model: ForestModel): string[] {
	const failures: string[] = [];

	if (!validateForestModel(model)) {
		failures.push('Model fails structural validation (validateForestModel)');
		return failures; // no point continuing
	}

	// Calibration coefficient sanity
	if (model.meta.calibration) {
		if (model.meta.calibration.coef <= 0) {
			failures.push(
				`Calibration coef must be positive (got ${model.meta.calibration.coef}). ` +
				`Negative coef inverts the fraud probability direction.`
			);
		}
		if (model.meta.calibration.samples !== undefined && model.meta.calibration.samples < 100) {
			failures.push(
				`Calibration used only ${model.meta.calibration.samples} samples (minimum 100)`
			);
		}
	} else {
		failures.push('Model has no calibration metadata');
	}

	// Feature list
	if (model.meta.features.length === 0) {
		failures.push('Model has empty feature list');
	}

	// Tree count consistency
	if (model.meta.tree_count !== model.forest.length) {
		failures.push(
			`Tree count mismatch: meta says ${model.meta.tree_count}, forest has ${model.forest.length}`
		);
	}

	return failures;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run full guardrail checks on a trained model with calibrated OOB predictions.
 *
 * This is the gate between training and KV upload. If this returns
 * `passed: false`, the model MUST NOT be uploaded.
 *
 * @param model              The trained ForestModel
 * @param calibratedScores   Platt-calibrated OOB predictions. Callers MUST
 *                           apply calibration before passing scores here.
 *                           (Previously this function calibrated internally,
 *                           which caused double-calibration bugs when callers
 *                           also calibrated.)
 * @param labels             True binary labels for the training set
 * @param config             Guardrail thresholds and constraints
 * @returns GuardrailResult with pass/fail and recommendations
 */
export function runGuardrails(
	model: ForestModel,
	calibratedScores: number[],
	labels: number[],
	config: GuardrailConfig = DEFAULT_GUARDRAIL_CONFIG,
): GuardrailResult {
	const failures: string[] = [];

	// 1. Structural validation
	const structuralFailures = validateModelStructure(model);
	failures.push(...structuralFailures);
	const modelValid = structuralFailures.length === 0;

	// 2. Size check
	const modelJson = JSON.stringify(model);
	const modelSizeBytes = new TextEncoder().encode(modelJson).byteLength;

	if (modelSizeBytes > config.maxModelSizeBytes) {
		failures.push(
			`Model size ${(modelSizeBytes / 1024 / 1024).toFixed(2)} MB exceeds ` +
			`limit of ${(config.maxModelSizeBytes / 1024 / 1024).toFixed(0)} MB`
		);
	}

	// 3. Threshold scan (scores are already Platt-calibrated by the caller)
	const thresholdScan = scanThresholds(calibratedScores, labels, config);

	// 5. Find thresholds
	const recommendation = findThresholds(thresholdScan, config);

	if (!recommendation) {
		failures.push(
			`No threshold pair satisfies constraints: ` +
			`recall >= ${config.minRecall}, FPR <= ${config.maxFpr}, ` +
			`FNR <= ${config.maxFnr}, gap >= ${config.minGap}`
		);
	}

	const passed = failures.length === 0 && recommendation !== null;

	return {
		passed,
		recommendation,
		thresholdScan,
		modelValid,
		modelSizeBytes,
		failures,
	};
}
