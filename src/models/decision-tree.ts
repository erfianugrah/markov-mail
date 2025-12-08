/**
 * JSON-backed decision tree inference helpers.
 *
 * Models are authored offline (Python/Scikit-Learn, etc.), exported into a
 * simple JSON structure, and loaded into the worker at runtime. Keeping the
 * evaluator tiny ensures the Worker stays dependency-free.
 */

import { logger } from '../logger';

type PrimitiveValue = number | string | boolean | null | undefined;

// Minified JSON types (t=type, f=feature, v=value/threshold, l=left, r=right)
export type DecisionTreeLeaf = {
	t: 'l';
	v: number;
	reason?: string;
};

export type DecisionTreeNode = {
	t: 'n';
	f: string;
	v: number | string | boolean;
	operator?: '==' | '!=' | '<' | '<=' | '>' | '>='; // Defaults handled in evaluator
	l: DecisionTree;
	r: DecisionTree;
};

export type DecisionTree = DecisionTreeLeaf | DecisionTreeNode;

export interface DecisionTreeEvaluation {
	score: number;
	reason: string;
	path: string[];
}

const KV_DECISION_TREE_KEY = 'decision_tree.json';
const TREE_VERSION_FALLBACK = 'kv:decision_tree.json';
const TREE_CACHE_TTL_MS = 60_000; // Refresh every minute to allow hot swaps

type DecisionTreeMetadata = {
	version?: string;
	updatedAt?: string;
	source?: string;
};

let cachedTree: DecisionTree | null = null;
let cachedTreeVersion = 'unavailable';
let lastLoadedAt = 0;
let loadingPromise: Promise<boolean> | null = null;

function ensureBoolean(value: PrimitiveValue): boolean {
	return value === 'true' || value === true || value === 1;
}

/**
 * Loads the decision tree model from KV. A null result means no model is
 * available; callers can fall back to safe defaults.
 */
export async function loadDecisionTreeModel(env: Env, options: { force?: boolean } = {}): Promise<boolean> {
	const now = Date.now();
	const cacheFresh = lastLoadedAt > 0 && now - lastLoadedAt < TREE_CACHE_TTL_MS;
	if (!options.force) {
		if (cacheFresh) {
			return cachedTree !== null;
		}
		if (loadingPromise) {
			return loadingPromise;
		}
	}

	lastLoadedAt = now;

	if (!env.CONFIG) {
		cachedTree = null;
		cachedTreeVersion = 'unavailable';
		return false;
	}

	loadingPromise = (async () => {
		try {
			let treeJson: any = null;
			let metadata: DecisionTreeMetadata | null | undefined;

			if (typeof env.CONFIG!.getWithMetadata === 'function') {
				const result = await env.CONFIG!.getWithMetadata<any, DecisionTreeMetadata>(
					KV_DECISION_TREE_KEY,
					'json'
				);
				treeJson = result.value ?? null;
				metadata = result.metadata;
			} else {
				treeJson = await env.CONFIG!.get<any>(KV_DECISION_TREE_KEY, 'json');
			}

			if (treeJson && typeof treeJson === 'object') {
				// Handle both forest format (with meta/forest) and raw tree format
				if (treeJson.forest && Array.isArray(treeJson.forest) && treeJson.forest.length > 0) {
					// Extract first tree from forest array (decision tree is n_trees=1)
					cachedTree = treeJson.forest[0];
					cachedTreeVersion = treeJson.meta?.version || metadata?.version || metadata?.updatedAt || TREE_VERSION_FALLBACK;
				} else if (treeJson.t) {
					// Raw tree format
					cachedTree = treeJson;
					cachedTreeVersion = metadata?.version || metadata?.updatedAt || TREE_VERSION_FALLBACK;
				} else {
					cachedTree = null;
					cachedTreeVersion = 'unavailable';
				}
			} else {
				cachedTree = null;
				cachedTreeVersion = 'unavailable';
			}
		} catch (error) {
			cachedTree = null;
			cachedTreeVersion = 'unavailable';
			logger.error({
				event: 'decision_tree_load_failed',
				message: error instanceof Error ? error.message : String(error),
			}, 'Failed to load decision tree from KV');
		} finally {
			loadingPromise = null;
		}

		return cachedTree !== null;
	})();

	return loadingPromise;
}

export function getDecisionTreeModel(): DecisionTree | null {
	return cachedTree;
}

export function getDecisionTreeVersion(): string {
	return cachedTreeVersion;
}

export function clearDecisionTreeCache(): void {
	cachedTree = null;
	cachedTreeVersion = 'unavailable';
	lastLoadedAt = 0;
	loadingPromise = null;
}

export function evaluateDecisionTree(
	features: Record<string, PrimitiveValue>
): DecisionTreeEvaluation | null {
	if (!cachedTree) {
		return null;
	}

	const path: string[] = [];
	const score = traverseNode(cachedTree, features, path);

	return {
		score,
		reason: path[path.length - 1] || 'decision_tree',
		path,
	};
}

function traverseNode(
	node: DecisionTree,
	features: Record<string, PrimitiveValue>,
	path: string[]
): number {
	if (node.t === 'l') {
		path.push(node.reason || 'leaf');
		return clampScore(node.v);
	}

	const featureValue = features[node.f];
	const conditionMet = evaluateCondition(featureValue, node.v, node.operator);
	path.push(`${node.f} ${node.operator ?? '<='} ${node.v} :: ${conditionMet ? 'left' : 'right'}`);

	return traverseNode(conditionMet ? node.l : node.r, features, path);
}

function evaluateCondition(
	value: PrimitiveValue,
	threshold: PrimitiveValue,
	operator: DecisionTreeNode['operator']
): boolean {
	switch (operator) {
		case '==':
			return value === threshold;
		case '!=':
			return value !== threshold;
		case '>':
			return typeof value === 'number' && typeof threshold === 'number' && value > threshold;
		case '>=':
			return typeof value === 'number' && typeof threshold === 'number' && value >= threshold;
		case '<':
			return typeof value === 'number' && typeof threshold === 'number' && value < threshold;
		case '<=':
		default:
			// Default behavior: numeric <=, boolean equality
			if (typeof threshold === 'boolean') {
				return ensureBoolean(value) === threshold;
			}
			if (typeof threshold === 'number') {
				return typeof value === 'number' ? value <= threshold : false;
			}
			return value === threshold;
	}
}

function clampScore(score: number): number {
	if (!Number.isFinite(score)) return 0;
	if (score < 0) return 0;
	if (score > 1) return 1;
	return score;
}
