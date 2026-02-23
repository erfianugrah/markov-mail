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
 * Predicts fraud probability using a Random Forest.
 * Runs input through all trees and returns the average probability.
 *
 * @param model - The trained forest model loaded from KV
 * @param features - Feature vector as key-value pairs
 * @returns Fraud probability (0.0 - 1.0)
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

	// Return average probability across all trees
	return totalScore / treeCount;
}

/**
 * Traverse a single decision tree iteratively.
 * Uses iterative approach instead of recursive to avoid stack overflow.
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
		// Get feature value, default to 0 if missing
		const featureValue = features[current.f] ?? 0;

		// Scikit-learn convention: if feature <= threshold, go LEFT
		if (featureValue <= current.v) {
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

	const treeScores: number[] = [];
	let totalScore = 0;

	for (let i = 0; i < model.forest.length; i++) {
		const score = traverseTree(model.forest[i], features);
		treeScores.push(score);
		totalScore += score;
	}

	return {
		score: totalScore / model.forest.length,
		treeScores,
	};
}

/**
 * Check that the model's expected features align with what the code provides.
 * Logs warnings for mismatched features but does not reject the model (the
 * engine defaults missing features to 0, which is lossy but non-fatal).
 */
export function checkFeatureAlignment(model: ForestModel, featureVector: Record<string, number>): void {
	const modelFeatures = new Set(model.meta.features);
	const vectorKeys = new Set(Object.keys(featureVector));

	const missingInVector = model.meta.features.filter(f => !vectorKeys.has(f));
	const extraInVector = Object.keys(featureVector).filter(k => !modelFeatures.has(k));

	if (missingInVector.length > 0) {
		console.warn(
			`[forest-engine] Model expects ${missingInVector.length} features not in feature vector (will default to 0): ${missingInVector.join(', ')}`
		);
	}
	if (extraInVector.length > 0) {
		console.warn(
			`[forest-engine] Feature vector has ${extraInVector.length} features not in model (unused): ${extraInVector.join(', ')}`
		);
	}
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
