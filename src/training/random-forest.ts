/**
 * Random Forest Trainer
 *
 * Hand-rolled implementation of Random Forest for binary classification.
 * Uses bootstrap aggregating (bagging) with random feature subsampling
 * at each node (delegated to CART). Tracks out-of-bag (OOB) predictions
 * for unbiased Platt scaling calibration.
 *
 * Produces the exact ForestModel JSON format consumed by
 * src/detectors/forest-engine.ts.
 */

import type { CompactTreeNode, ForestModel, ForestMeta } from '../detectors/forest-engine';
import { trainCART, type CARTConfig, type GiniImportanceAccumulator } from './cart';
import { fitPlattScaling, type PlattCoefficients } from './platt-scaling';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RandomForestConfig {
	/** Number of trees in the ensemble (default: 10) */
	nTrees: number;
	/** Maximum tree depth (default: 6) */
	maxDepth: number;
	/** Minimum samples per leaf (default: 20) */
	minSamplesLeaf: number;
	/** Conflict-zone weight multiplier (default: 20) */
	conflictWeight: number;
	/** Bigram entropy threshold for conflict zone (default: 3.0) */
	conflictEntropyThreshold: number;
	/** Domain reputation threshold for conflict zone (default: 0.6) */
	conflictReputationThreshold: number;
	/** Base PRNG seed (default: 42). Each tree uses seed + treeIndex. */
	seed: number;
	/** Model version string (default: auto-generated) */
	version?: string;
}

export const DEFAULT_RF_CONFIG: RandomForestConfig = {
	nTrees: 10,
	maxDepth: 6,
	minSamplesLeaf: 20,
	conflictWeight: 20,
	conflictEntropyThreshold: 3.0,
	conflictReputationThreshold: 0.6,
	seed: 42,
};

export interface TrainingDataset {
	/** Column-major feature matrix: featureMatrix[featureIdx][sampleIdx] */
	featureMatrix: Float64Array[];
	/** Binary labels (0 = legit, 1 = fraud) */
	labels: Uint8Array;
	/** Feature names in same order as featureMatrix columns */
	featureNames: string[];
}

export interface TrainingResult {
	model: ForestModel;
	/** OOB predictions for each training sample (NaN if sample was never OOB) */
	oobPredictions: Float64Array;
	/** Per-tree OOB accuracy */
	treeOobAccuracies: number[];
	/** Training duration in milliseconds */
	durationMs: number;
	/** Training summary statistics */
	stats: TrainingStats;
}

export interface TrainingStats {
	totalSamples: number;
	fraudCount: number;
	legitCount: number;
	conflictZoneSamples: number;
	oobSamplesUsed: number;
	meanOobAccuracy: number;
}

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32)
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
// Bootstrap sampling
// ---------------------------------------------------------------------------

/**
 * Generate a weighted bootstrap sample (sampling with replacement).
 *
 * Probability of selecting sample i is proportional to weights[i].
 * Returns the selected indices and a boolean mask indicating which samples
 * were NOT selected (out-of-bag).
 */
function weightedBootstrapSample(
	n: number,
	weights: Float64Array,
	rng: () => number,
): { bootstrapIndices: number[]; oobMask: Uint8Array } {
	// Build cumulative weight distribution
	const cumWeights = new Float64Array(n);
	cumWeights[0] = weights[0];
	for (let i = 1; i < n; i++) {
		cumWeights[i] = cumWeights[i - 1] + weights[i];
	}
	const totalWeight = cumWeights[n - 1];

	// Sample n indices with replacement (weighted)
	const bootstrapIndices = new Array<number>(n);
	const selected = new Uint8Array(n); // track which originals were picked

	for (let i = 0; i < n; i++) {
		const r = rng() * totalWeight;
		// Binary search for the index
		let lo = 0;
		let hi = n - 1;
		while (lo < hi) {
			const mid = (lo + hi) >>> 1;
			if (cumWeights[mid] < r) {
				lo = mid + 1;
			} else {
				hi = mid;
			}
		}
		bootstrapIndices[i] = lo;
		selected[lo] = 1;
	}

	// OOB mask: 1 for samples NOT in bootstrap
	const oobMask = new Uint8Array(n);
	for (let i = 0; i < n; i++) {
		oobMask[i] = selected[i] === 0 ? 1 : 0;
	}

	return { bootstrapIndices, oobMask };
}

// ---------------------------------------------------------------------------
// Sample weight computation (conflict-zone weighting)
// ---------------------------------------------------------------------------

/**
 * Compute per-sample weights matching the conflict-zone strategy from
 * train_forest.py. Samples where bigram_entropy > threshold AND
 * domain_reputation_score >= threshold get a higher weight.
 */
function computeSampleWeights(
	dataset: TrainingDataset,
	config: RandomForestConfig,
): { weights: Float64Array; conflictCount: number } {
	const n = dataset.labels.length;
	const weights = new Float64Array(n);
	weights.fill(1.0);

	// Find feature indices
	const entropyIdx = dataset.featureNames.indexOf('bigram_entropy');
	const reputationIdx = dataset.featureNames.indexOf('domain_reputation_score');

	let conflictCount = 0;

	if (entropyIdx >= 0 && reputationIdx >= 0) {
		const entropyCol = dataset.featureMatrix[entropyIdx];
		const reputationCol = dataset.featureMatrix[reputationIdx];

		for (let i = 0; i < n; i++) {
			if (
				entropyCol[i] > config.conflictEntropyThreshold &&
				reputationCol[i] >= config.conflictReputationThreshold
			) {
				weights[i] = config.conflictWeight;
				conflictCount++;
			}
		}
	}

	return { weights, conflictCount };
}

// ---------------------------------------------------------------------------
// Tree prediction (for OOB scoring)
// ---------------------------------------------------------------------------

/**
 * Predict a single sample through a trained tree. Iterative traversal
 * matching forest-engine.ts behavior.
 */
function predictSingle(tree: CompactTreeNode, features: Float64Array, _featureNames: string[], featureNameToIndex: Map<string, number>): number {
	let current = tree;
	let depth = 0;
	const maxDepth = 50;

	while (current.t === 'n' && depth < maxDepth) {
		const featureIdx = featureNameToIndex.get(current.f);
		const val = featureIdx !== undefined ? features[featureIdx] : NaN;

		// Match forest-engine.ts: NaN/undefined goes left (scikit-learn convention)
		if (val !== val || val === undefined || val <= current.v) {
			current = current.l;
		} else {
			current = current.r;
		}
		depth++;
	}

	return current.t === 'l' ? current.v : 0;
}

// ---------------------------------------------------------------------------
// Feature importance normalization
// ---------------------------------------------------------------------------

function mergeImportance(
	accumulator: Map<string, number>,
	treeImportance: GiniImportanceAccumulator,
): void {
	for (const [feature, value] of treeImportance) {
		accumulator.set(feature, (accumulator.get(feature) ?? 0) + value);
	}
}

function normalizeImportance(
	accumulated: Map<string, number>,
	_nTrees: number,
): Record<string, number> {
	const result: Record<string, number> = {};
	let total = 0;

	for (const value of accumulated.values()) {
		total += value;
	}

	if (total === 0) {
		// All features equally unimportant
		for (const key of accumulated.keys()) {
			result[key] = 0;
		}
		return result;
	}

	for (const [feature, value] of accumulated) {
		result[feature] = Math.round((value / total) * 1e6) / 1e6;
	}

	return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Train a Random Forest classifier.
 *
 * @param dataset   Training data (column-major feature matrix + labels)
 * @param config    Hyperparameters (trees, depth, weights, seed)
 * @param onProgress  Optional callback for progress reporting
 * @returns Trained model + OOB predictions + diagnostics
 */
export function trainRandomForest(
	dataset: TrainingDataset,
	config: RandomForestConfig = DEFAULT_RF_CONFIG,
	onProgress?: (treeIndex: number, total: number) => void,
): TrainingResult {
	const startTime = Date.now();
	const n = dataset.labels.length;
	const numFeatures = dataset.featureNames.length;

	if (n === 0) throw new Error('Cannot train on empty dataset');
	if (numFeatures === 0) throw new Error('No features in dataset');

	// Validate dimensions
	if (dataset.featureMatrix.length !== numFeatures) {
		throw new Error(
			`featureMatrix has ${dataset.featureMatrix.length} columns but ${numFeatures} feature names`
		);
	}

	// Compute sample weights (conflict-zone weighting)
	const { weights, conflictCount } = computeSampleWeights(dataset, config);

	// Count labels
	let fraudCount = 0;
	for (let i = 0; i < n; i++) {
		if (dataset.labels[i] === 1) fraudCount++;
	}
	const legitCount = n - fraudCount;

	// Build feature name index for fast prediction lookup
	const featureNameToIndex = new Map<string, number>();
	for (let i = 0; i < numFeatures; i++) {
		featureNameToIndex.set(dataset.featureNames[i], i);
	}

	// Accumulators
	const forest: CompactTreeNode[] = [];
	const aggregatedImportance = new Map<string, number>();
	const oobPredictionSums = new Float64Array(n);  // sum of OOB predictions
	const oobPredictionCounts = new Uint32Array(n);  // count of OOB predictions
	const treeOobAccuracies: number[] = [];

	// CART config (shared across trees, except seed)
	const cartConfig: CARTConfig = {
		maxDepth: config.maxDepth,
		minSamplesLeaf: config.minSamplesLeaf,
	};

	// Train each tree
	for (let t = 0; t < config.nTrees; t++) {
		const treeSeed = config.seed + t;
		const treeRng = mulberry32(treeSeed);

		// Weighted bootstrap sample
		const { bootstrapIndices, oobMask } = weightedBootstrapSample(n, weights, treeRng);

		// Build bootstrap feature matrix (reindex samples)
		const bootstrapN = bootstrapIndices.length;
		const bootstrapMatrix: Float64Array[] = new Array(numFeatures);
		const bootstrapLabels = new Uint8Array(bootstrapN);
		const bootstrapWeights = new Float64Array(bootstrapN);

		for (let f = 0; f < numFeatures; f++) {
			bootstrapMatrix[f] = new Float64Array(bootstrapN);
			const srcCol = dataset.featureMatrix[f];
			for (let i = 0; i < bootstrapN; i++) {
				bootstrapMatrix[f][i] = srcCol[bootstrapIndices[i]];
			}
		}
		for (let i = 0; i < bootstrapN; i++) {
			bootstrapLabels[i] = dataset.labels[bootstrapIndices[i]];
			bootstrapWeights[i] = weights[bootstrapIndices[i]];
		}

		// Train CART tree
		const { tree, importance } = trainCART(
			bootstrapMatrix,
			bootstrapLabels,
			bootstrapWeights,
			dataset.featureNames,
			cartConfig,
			treeSeed,
		);

		forest.push(tree);
		mergeImportance(aggregatedImportance, importance);

		// Compute OOB predictions for this tree
		let oobCorrect = 0;
		let oobTotal = 0;

		for (let i = 0; i < n; i++) {
			if (oobMask[i] === 0) continue; // sample was in bootstrap, skip

			// Build feature row for this sample
			const featureRow = new Float64Array(numFeatures);
			for (let f = 0; f < numFeatures; f++) {
				featureRow[f] = dataset.featureMatrix[f][i];
			}

			const pred = predictSingle(tree, featureRow, dataset.featureNames, featureNameToIndex);
			oobPredictionSums[i] += pred;
			oobPredictionCounts[i]++;

			// Track OOB accuracy (threshold at 0.5 for binary classification)
			const predictedLabel = pred >= 0.5 ? 1 : 0;
			if (predictedLabel === dataset.labels[i]) oobCorrect++;
			oobTotal++;
		}

		treeOobAccuracies.push(oobTotal > 0 ? oobCorrect / oobTotal : 0);

		if (onProgress) {
			onProgress(t + 1, config.nTrees);
		}
	}

	// Compute final OOB predictions (average across trees that didn't see each sample)
	const oobPredictions = new Float64Array(n);
	let oobSamplesUsed = 0;

	for (let i = 0; i < n; i++) {
		if (oobPredictionCounts[i] > 0) {
			oobPredictions[i] = oobPredictionSums[i] / oobPredictionCounts[i];
			oobSamplesUsed++;
		} else {
			// Sample was in every bootstrap — no OOB prediction available
			oobPredictions[i] = NaN;
		}
	}

	// Fit Platt scaling on OOB predictions
	const oobScores: number[] = [];
	const oobLabels: number[] = [];
	for (let i = 0; i < n; i++) {
		if (!Number.isNaN(oobPredictions[i])) {
			oobScores.push(oobPredictions[i]);
			oobLabels.push(dataset.labels[i]);
		}
	}

	let calibration: PlattCoefficients;
	if (oobScores.length < 100) {
		throw new Error(
			`Insufficient OOB samples for calibration: ${oobScores.length} (need >= 100). ` +
			`This usually means the dataset is too small for the number of trees.`
		);
	}

	calibration = fitPlattScaling(oobScores, oobLabels);

	// Normalize feature importance
	const featureImportance = normalizeImportance(aggregatedImportance, config.nTrees);

	// Generate version string
	const version = config.version ?? `${formatDate(new Date())}-forest-auto`;

	// Assemble ForestModel
	const meta: ForestMeta = {
		version,
		features: [...dataset.featureNames].sort(),
		tree_count: forest.length,
		feature_importance: featureImportance,
		calibration: {
			method: 'platt',
			coef: calibration.coef,
			intercept: calibration.intercept,
			samples: oobScores.length,
		},
		config: {
			n_trees: config.nTrees,
			max_depth: config.maxDepth,
			min_samples_leaf: config.minSamplesLeaf,
			conflict_weight: config.conflictWeight,
		},
	};

	const model: ForestModel = { meta, forest };

	const meanOobAccuracy = treeOobAccuracies.length > 0
		? treeOobAccuracies.reduce((a, b) => a + b, 0) / treeOobAccuracies.length
		: 0;

	return {
		model,
		oobPredictions,
		treeOobAccuracies,
		durationMs: Date.now() - startTime,
		stats: {
			totalSamples: n,
			fraudCount,
			legitCount,
			conflictZoneSamples: conflictCount,
			oobSamplesUsed,
			meanOobAccuracy,
		},
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(d: Date): string {
	const y = d.getUTCFullYear();
	const m = String(d.getUTCMonth() + 1).padStart(2, '0');
	const day = String(d.getUTCDate()).padStart(2, '0');
	return `${y}${m}${day}`;
}

// ---------------------------------------------------------------------------
// Dataset parsing (from KV TrainingDataset JSON format)
// ---------------------------------------------------------------------------

export interface TrainingDatasetJSON {
	version: string;
	created: string;
	samples: number;
	features: string[];
	rows: {
		features: number[];
		label: 0 | 1;
		weight?: number;
	}[];
}

/**
 * Parse the KV-stored training dataset JSON into the column-major
 * typed arrays expected by the trainer.
 */
export function parseTrainingDataset(json: TrainingDatasetJSON): TrainingDataset {
	const numSamples = json.rows.length;
	const numFeatures = json.features.length;

	if (numSamples === 0) throw new Error('Training dataset has no rows');
	if (numFeatures === 0) throw new Error('Training dataset has no features');

	// Validate first row dimension
	if (json.rows[0].features.length !== numFeatures) {
		throw new Error(
			`Feature count mismatch: header says ${numFeatures} but first row has ${json.rows[0].features.length}`
		);
	}

	const featureMatrix: Float64Array[] = new Array(numFeatures);
	for (let f = 0; f < numFeatures; f++) {
		featureMatrix[f] = new Float64Array(numSamples);
	}
	const labels = new Uint8Array(numSamples);

	for (let i = 0; i < numSamples; i++) {
		const row = json.rows[i];
		labels[i] = row.label;
		for (let f = 0; f < numFeatures; f++) {
			featureMatrix[f][i] = row.features[f] ?? 0;
		}
	}

	return {
		featureMatrix,
		labels,
		featureNames: json.features,
	};
}
