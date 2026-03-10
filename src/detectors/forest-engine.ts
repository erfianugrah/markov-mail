/**
 * Random Forest Inference Engine
 *
 * Lightweight engine for traversing JSON-exported Random Forest models.
 * Optimized for edge computing with minimal memory footprint.
 */

// Minified JSON types (t=type, f=feature, v=value, l=left, r=right)
export type CompactTreeNode =
	| { t: 'l'; v: number } // Leaf node with fraud probability
	| {
			t: 'n'; // Internal node
			f: string; // Feature name
			v: number; // Threshold value
			l: CompactTreeNode; // Left child
			r: CompactTreeNode; // Right child
	  };

export interface ForestCalibrationMeta {
	method?: string;
	intercept: number;
	coef: number;
	samples?: number;
}

export interface ForestMeta {
	version: string;
	features: string[];
	tree_count: number;
	feature_importance?: Record<string, number>;
	calibration?: ForestCalibrationMeta;
	config?: {
		n_trees?: number;
		max_depth?: number;
		min_samples_leaf?: number;
		conflict_weight?: number;
	};
}

export interface ForestModel {
	meta: ForestMeta;
	forest: CompactTreeNode[];
}

// Absolute upper bound on tree depth to prevent runaway traversal
const ABSOLUTE_MAX_DEPTH = 50;

/**
 * Apply Platt scaling calibration to a raw forest score.
 * Transforms the raw tree-vote average into a calibrated probability
 * using the logistic sigmoid: P(fraud) = 1 / (1 + exp(-(coef * score + intercept)))
 *
 * M1 fix: calibration coefficients were computed during training but never
 * applied at inference time, making the entire calibration pipeline dead code.
 */
function applyCalibration(rawScore: number, calibration: ForestCalibrationMeta): number {
	const logit = calibration.coef * rawScore + calibration.intercept;
	// Clamp to prevent exp() overflow (|logit| > 500 is effectively 0 or 1)
	const clampedLogit = Math.max(-500, Math.min(500, logit));
	return 1 / (1 + Math.exp(-clampedLogit));
}

/**
 * Predicts fraud probability using a Random Forest.
 * Runs input through all trees and returns the average probability.
 * Applies Platt scaling calibration when available.
 *
 * @param model - The trained forest model loaded from KV
 * @param features - Feature vector as key-value pairs
 * @returns Calibrated fraud probability (0.0 - 1.0)
 */
export function predictForestScore(model: ForestModel, features: Record<string, number>): number {
	if (!model || !model.forest || model.forest.length === 0) {
		console.warn('Invalid forest model loaded');
		return 0;
	}

	// Use model's configured max_depth if available, with an absolute safety cap
	const maxDepth = Math.min(model.meta.config?.max_depth ?? 20, ABSOLUTE_MAX_DEPTH);

	let totalScore = 0;
	const treeCount = model.forest.length;

	// Run input through every tree and accumulate scores
	for (let i = 0; i < treeCount; i++) {
		totalScore += traverseTree(model.forest[i], features, maxDepth);
	}

	// Raw average probability across all trees
	const rawScore = totalScore / treeCount;

	// M1 fix: apply Platt scaling calibration if available
	if (model.meta.calibration && typeof model.meta.calibration.coef === 'number' && typeof model.meta.calibration.intercept === 'number') {
		return applyCalibration(rawScore, model.meta.calibration);
	}

	return rawScore;
}

/**
 * Traverse a single decision tree iteratively.
 * Uses iterative approach instead of recursive to avoid stack overflow.
 *
 * M4 fix: NaN feature values now go LEFT (scikit-learn convention for missing values).
 * M5 fix: Missing features (undefined) are distinguished from zero-valued features
 *   by also routing them left, matching scikit-learn's default missing-value behavior.
 *
 * @param node - Root node of the tree
 * @param features - Feature vector
 * @returns Fraud probability from leaf node (0.0 - 1.0)
 */
function traverseTree(node: CompactTreeNode, features: Record<string, number>, maxDepth: number = 20): number {
	let current = node;
	let depth = 0;

	// Traverse tree iteratively
	while (current.t === 'n' && depth < maxDepth) {
		const featureValue = features[current.f];

		// M4+M5 fix: treat missing (undefined) and NaN as "go left" to match
		// scikit-learn's convention for missing values. Previously, missing features
		// defaulted to 0 (indistinguishable from valid zero), and NaN always went
		// right (since NaN <= threshold is false in IEEE 754), corrupting predictions.
		if (featureValue === undefined || featureValue === null || Number.isNaN(featureValue)) {
			current = current.l;
		} else if (featureValue <= current.v) {
			current = current.l;
		} else {
			current = current.r;
		}

		depth++;
	}

	// Reached leaf node or max depth
	if (current.t === 'l') {
		return current.v;
	}

	// Safety fallback (shouldn't happen with valid trees)
	console.warn('Tree traversal reached max depth without finding leaf');
	return 0;
}

/**
 * Get detailed prediction with per-tree scores (for debugging)
 *
 * @param model - The trained forest model
 * @param features - Feature vector
 * @returns Object with average score and individual tree scores
 */
export function predictForestScoreDetailed(
	model: ForestModel,
	features: Record<string, number>
): {
	score: number;
	treeScores: number[];
} {
	if (!model || !model.forest || model.forest.length === 0) {
		return { score: 0, treeScores: [] };
	}

	// Use model's configured max_depth if available, with an absolute safety cap
	const maxDepth = Math.min(model.meta.config?.max_depth ?? 20, ABSOLUTE_MAX_DEPTH);

	const treeScores: number[] = [];
	let totalScore = 0;

	for (let i = 0; i < model.forest.length; i++) {
		const score = traverseTree(model.forest[i], features, maxDepth);
		treeScores.push(score);
		totalScore += score;
	}

	return {
		score: totalScore / model.forest.length,
		treeScores,
	};
}

export interface FeatureAlignmentResult {
	aligned: boolean;
	missingInVector: string[];
	extraInVector: string[];
	/** Fraction of model features missing from the vector (0-1) */
	missingRatio: number;
}

/**
 * Check that the model's expected features align with what the code provides.
 *
 * M6 fix: returns a structured result and throws on critical mismatches
 * (>20% of model features missing). Previously, mismatches were silently
 * logged and predictions proceeded with zeroed-out features.
 */
export function checkFeatureAlignment(model: ForestModel, featureVector: Record<string, number>): FeatureAlignmentResult {
	const modelFeatures = new Set(model.meta.features);
	const vectorKeys = new Set(Object.keys(featureVector));

	const missingInVector = model.meta.features.filter(f => !vectorKeys.has(f));
	const extraInVector = Object.keys(featureVector).filter(k => !modelFeatures.has(k));
	const missingRatio = model.meta.features.length > 0 ? missingInVector.length / model.meta.features.length : 0;

	if (missingInVector.length > 0) {
		console.warn(
			`[forest-engine] Model expects ${missingInVector.length} features not in feature vector: ${missingInVector.join(', ')}`
		);
	}
	if (extraInVector.length > 0) {
		console.warn(
			`[forest-engine] Feature vector has ${extraInVector.length} features not in model (unused): ${extraInVector.join(', ')}`
		);
	}

	// Critical: if more than 20% of model features are missing, the prediction
	// is unreliable. Throw so callers can degrade gracefully rather than serve
	// silently corrupted scores.
	if (missingRatio > 0.2) {
		throw new Error(
			`[forest-engine] Critical feature alignment failure: ${missingInVector.length}/${model.meta.features.length} ` +
			`(${(missingRatio * 100).toFixed(0)}%) model features missing from vector. ` +
			`Missing: ${missingInVector.slice(0, 10).join(', ')}${missingInVector.length > 10 ? '...' : ''}`
		);
	}

	return {
		aligned: missingInVector.length === 0 && extraInVector.length === 0,
		missingInVector,
		extraInVector,
		missingRatio,
	};
}

/**
 * Validate that a forest model has the expected structure
 *
 * @param model - Model to validate
 * @returns True if valid, false otherwise
 */
export function validateForestModel(model: unknown): model is ForestModel {
	if (!model || typeof model !== 'object') {
		return false;
	}

	const m = model as Partial<ForestModel>;

	// Check required meta fields
	if (!m.meta || typeof m.meta !== 'object') {
		return false;
	}

	if (!m.meta.version || typeof m.meta.version !== 'string') {
		return false;
	}

	if (!Array.isArray(m.meta.features) || m.meta.features.length === 0) {
		return false;
	}

	if (typeof m.meta.tree_count !== 'number' || m.meta.tree_count <= 0) {
		return false;
	}

	if (m.meta.feature_importance) {
		for (const value of Object.values(m.meta.feature_importance)) {
			if (typeof value !== 'number' || Number.isNaN(value)) {
				return false;
			}
		}
	}

	if (m.meta.calibration) {
		const { intercept, coef } = m.meta.calibration as ForestCalibrationMeta;
		if (typeof intercept !== 'number' || typeof coef !== 'number') {
			return false;
		}
	}

	// Check forest array
	if (!Array.isArray(m.forest) || m.forest.length === 0) {
		return false;
	}

	if (m.forest.length !== m.meta.tree_count) {
		console.warn(`Tree count mismatch: meta=${m.meta.tree_count}, forest=${m.forest.length}`);
		return false;
	}

	return true;
}
