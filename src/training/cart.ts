/**
 * CART Decision Tree Trainer (Gini Impurity)
 *
 * Hand-rolled implementation of the Classification and Regression Trees
 * algorithm for binary classification. Produces the exact same CompactTreeNode
 * JSON format consumed by src/detectors/forest-engine.ts.
 *
 * Algorithm:
 *   1. At each node, select sqrt(numFeatures) random candidate features
 *   2. For each candidate, find the best split via sorted Gini scan
 *   3. Split samples left/right and recurse
 *   4. Leaf nodes store P(fraud) = fraudCount / totalCount
 */

import type { CompactTreeNode } from '../detectors/forest-engine';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CARTConfig {
	/** Maximum tree depth (default: 6) */
	maxDepth: number;
	/** Minimum samples required at a leaf node (default: 20) */
	minSamplesLeaf: number;
	/** Number of candidate features to evaluate per split (default: sqrt(n)) */
	maxFeatures?: number;
	/** PRNG seed for reproducible feature subsampling */
	seed?: number;
}

export const DEFAULT_CART_CONFIG: CARTConfig = {
	maxDepth: 6,
	minSamplesLeaf: 20,
};

/** Accumulated Gini decrease per feature, used for feature importance. */
export type GiniImportanceAccumulator = Map<string, number>;

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) — same generator used in synthetic data
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
	let s = seed | 0;
	return () => {
		s = (s + 0x6d2b79f5) | 0;
		let t = Math.imul(s ^ (s >>> 15), 1 | s);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compute Gini impurity for a binary split.
 * gini(S) = 1 - p(0)^2 - p(1)^2
 */
function giniImpurity(positiveCount: number, totalCount: number): number {
	if (totalCount === 0) return 0;
	const p = positiveCount / totalCount;
	return 1 - p * p - (1 - p) * (1 - p);
}

/**
 * Select `k` unique random indices from `[0, n)` using Fisher-Yates partial
 * shuffle. Returns sorted indices for cache-friendly access.
 */
function sampleIndices(n: number, k: number, rng: () => number): number[] {
	// Build a full index array and partially shuffle
	const indices = new Array<number>(n);
	for (let i = 0; i < n; i++) indices[i] = i;

	const count = Math.min(k, n);
	for (let i = 0; i < count; i++) {
		const j = i + Math.floor(rng() * (n - i));
		const tmp = indices[i];
		indices[i] = indices[j];
		indices[j] = tmp;
	}

	return indices.slice(0, count).sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Core split-finding
// ---------------------------------------------------------------------------

interface SplitCandidate {
	featureIndex: number;
	threshold: number;
	/** Weighted Gini impurity of the split */
	gini: number;
	/** Gini decrease = parentGini - splitGini (for importance tracking) */
	giniDecrease: number;
}

/**
 * Find the best binary split across a set of candidate features.
 *
 * For each candidate feature:
 *   1. Sort sample indices by that feature's value
 *   2. Scan left-to-right, computing the weighted Gini at each midpoint
 *   3. Track the globally best (lowest weighted Gini) split
 *
 * Uses sample weights for conflict-zone weighting support.
 */
function findBestSplit(
	featureMatrix: Float64Array[], // featureMatrix[featureIdx][sampleIdx]
	labels: Uint8Array,
	weights: Float64Array,
	sampleIndices: number[],
	candidateFeatureIndices: number[],
	minSamplesLeaf: number,
): SplitCandidate | null {
	const n = sampleIndices.length;
	if (n < minSamplesLeaf * 2) return null;

	// Compute parent Gini (weighted)
	let parentWeightedPos = 0;
	let parentTotalWeight = 0;
	for (let i = 0; i < n; i++) {
		const idx = sampleIndices[i];
		const w = weights[idx];
		parentTotalWeight += w;
		if (labels[idx] === 1) parentWeightedPos += w;
	}
	const parentGini = giniImpurity(parentWeightedPos, parentTotalWeight);

	// If node is pure, no point splitting
	if (parentGini === 0) return null;

	let best: SplitCandidate | null = null;

	// Reusable sort buffer — avoids allocation per feature
	const sortBuf: { idx: number; val: number }[] = new Array(n);

	for (const fi of candidateFeatureIndices) {
		const featureCol = featureMatrix[fi];

		// Fill sort buffer with (sampleIndex, featureValue) pairs
		for (let i = 0; i < n; i++) {
			sortBuf[i] = { idx: sampleIndices[i], val: featureCol[sampleIndices[i]] };
		}
		sortBuf.length = n; // trim if previous iteration was longer
		sortBuf.sort((a, b) => a.val - b.val);

		// Scan from left to right, accumulating left-side statistics
		let leftWeightedPos = 0;
		let leftTotalWeight = 0;

		for (let i = 0; i < n - 1; i++) {
			const { idx, val: currentVal } = sortBuf[i];
			const w = weights[idx];
			leftTotalWeight += w;
			if (labels[idx] === 1) leftWeightedPos += w;

			const nextVal = sortBuf[i + 1].val;

			// Skip if this value equals the next (no valid split between identical values)
			if (currentVal === nextVal) continue;

			// Check min_samples_leaf constraint (count-based, not weight-based)
			const leftCount = i + 1;
			const rightCount = n - leftCount;
			if (leftCount < minSamplesLeaf || rightCount < minSamplesLeaf) continue;

			// Compute weighted Gini for this split
			const rightTotalWeight = parentTotalWeight - leftTotalWeight;
			const rightWeightedPos = parentWeightedPos - leftWeightedPos;

			const leftGini = giniImpurity(leftWeightedPos, leftTotalWeight);
			const rightGini = giniImpurity(rightWeightedPos, rightTotalWeight);
			const weightedGini =
				(leftTotalWeight / parentTotalWeight) * leftGini +
				(rightTotalWeight / parentTotalWeight) * rightGini;

			if (best === null || weightedGini < best.gini) {
				best = {
					featureIndex: fi,
					threshold: (currentVal + nextVal) / 2,
					gini: weightedGini,
					giniDecrease: parentGini - weightedGini,
				};
			}
		}
	}

	return best;
}

// ---------------------------------------------------------------------------
// Tree building (recursive)
// ---------------------------------------------------------------------------

/**
 * Build a CART decision tree recursively.
 *
 * @param featureMatrix   Column-major feature data: featureMatrix[featureIdx][sampleIdx]
 * @param labels          Binary labels (0 or 1) for each sample
 * @param weights         Per-sample weights (for conflict-zone weighting)
 * @param sampleIndices   Indices of samples available at this node
 * @param featureNames    Human-readable feature names (for the JSON output)
 * @param config          Tree hyperparameters
 * @param depth           Current depth (starts at 0)
 * @param rng             Seeded PRNG for random feature subsampling
 * @param importance       Accumulator for per-feature Gini decrease
 * @param totalSamples    Total training set size (for importance normalization)
 */
export function buildTree(
	featureMatrix: Float64Array[],
	labels: Uint8Array,
	weights: Float64Array,
	sampleIndices: number[],
	featureNames: string[],
	config: CARTConfig,
	depth: number,
	rng: () => number,
	importance: GiniImportanceAccumulator,
	totalSamples: number,
): CompactTreeNode {
	const n = sampleIndices.length;

	// Compute weighted fraud probability for leaf value
	let weightedPos = 0;
	let totalWeight = 0;
	for (let i = 0; i < n; i++) {
		const idx = sampleIndices[i];
		const w = weights[idx];
		totalWeight += w;
		if (labels[idx] === 1) weightedPos += w;
	}
	const fraudProb = totalWeight > 0 ? weightedPos / totalWeight : 0;

	// --------------- Stopping criteria ---------------

	// Max depth reached
	if (depth >= config.maxDepth) {
		return { t: 'l', v: round6(fraudProb) };
	}

	// Too few samples to split
	if (n < config.minSamplesLeaf * 2) {
		return { t: 'l', v: round6(fraudProb) };
	}

	// Pure node
	if (fraudProb === 0 || fraudProb === 1) {
		return { t: 'l', v: round6(fraudProb) };
	}

	// --------------- Find best split ---------------

	const numFeatures = featureNames.length;
	const maxFeatures = config.maxFeatures ?? Math.max(1, Math.floor(Math.sqrt(numFeatures)));
	const candidateIndices = sampleIndices.length > 0
		? sampleFeatureIndices(numFeatures, maxFeatures, rng)
		: [];

	const split = findBestSplit(
		featureMatrix,
		labels,
		weights,
		sampleIndices,
		candidateIndices,
		config.minSamplesLeaf,
	);

	// No valid split found — make leaf
	if (split === null) {
		return { t: 'l', v: round6(fraudProb) };
	}

	// --------------- Accumulate feature importance ---------------

	const featureName = featureNames[split.featureIndex];
	const nodeWeight = n / totalSamples;
	const currentImportance = importance.get(featureName) ?? 0;
	importance.set(featureName, currentImportance + nodeWeight * split.giniDecrease);

	// --------------- Partition samples ---------------

	const leftIndices: number[] = [];
	const rightIndices: number[] = [];
	const featureCol = featureMatrix[split.featureIndex];

	for (let i = 0; i < n; i++) {
		const idx = sampleIndices[i];
		const val = featureCol[idx];
		// Match scikit-learn convention: missing/NaN goes left
		if (val !== val || val === undefined || val <= split.threshold) {
			leftIndices.push(idx);
		} else {
			rightIndices.push(idx);
		}
	}

	// Safety: if partition is degenerate (shouldn't happen given findBestSplit checks)
	if (leftIndices.length === 0 || rightIndices.length === 0) {
		return { t: 'l', v: round6(fraudProb) };
	}

	// --------------- Recurse ---------------

	const leftChild = buildTree(
		featureMatrix, labels, weights, leftIndices,
		featureNames, config, depth + 1, rng, importance, totalSamples,
	);
	const rightChild = buildTree(
		featureMatrix, labels, weights, rightIndices,
		featureNames, config, depth + 1, rng, importance, totalSamples,
	);

	return {
		t: 'n',
		f: featureName,
		v: round6(split.threshold),
		l: leftChild,
		r: rightChild,
	};
}

/**
 * Select `k` unique feature indices from `[0, numFeatures)`.
 */
function sampleFeatureIndices(numFeatures: number, k: number, rng: () => number): number[] {
	return sampleIndices(numFeatures, k, rng);
}

function round6(v: number): number {
	return Math.round(v * 1e6) / 1e6;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CARTTrainResult {
	tree: CompactTreeNode;
	importance: GiniImportanceAccumulator;
}

/**
 * Train a single CART decision tree.
 *
 * @param featureMatrix  Column-major Float64Arrays: featureMatrix[featureIdx][sampleIdx]
 * @param labels         Uint8Array of binary labels (0 or 1)
 * @param weights        Float64Array of per-sample weights
 * @param featureNames   Feature name strings (same order as featureMatrix columns)
 * @param config         Hyperparameters
 * @param seed           PRNG seed for feature subsampling
 */
export function trainCART(
	featureMatrix: Float64Array[],
	labels: Uint8Array,
	weights: Float64Array,
	featureNames: string[],
	config: CARTConfig = DEFAULT_CART_CONFIG,
	seed: number = 42,
): CARTTrainResult {
	if (featureMatrix.length !== featureNames.length) {
		throw new Error(
			`Feature matrix has ${featureMatrix.length} columns but ${featureNames.length} names provided`
		);
	}
	const numSamples = labels.length;
	if (numSamples === 0) {
		throw new Error('Cannot train on empty dataset');
	}
	for (const col of featureMatrix) {
		if (col.length !== numSamples) {
			throw new Error(
				`Feature column length ${col.length} does not match label count ${numSamples}`
			);
		}
	}
	if (weights.length !== numSamples) {
		throw new Error(
			`Weights length ${weights.length} does not match label count ${numSamples}`
		);
	}

	const rng = mulberry32(seed);
	const importance: GiniImportanceAccumulator = new Map();

	// All sample indices
	const allIndices = new Array<number>(numSamples);
	for (let i = 0; i < numSamples; i++) allIndices[i] = i;

	const tree = buildTree(
		featureMatrix, labels, weights, allIndices,
		featureNames, config, 0, rng, importance, numSamples,
	);

	return { tree, importance };
}
