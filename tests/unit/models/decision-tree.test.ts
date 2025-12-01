import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
	loadDecisionTreeModel,
	evaluateDecisionTree,
	getDecisionTreeVersion,
	clearDecisionTreeCache,
	type DecisionTree,
} from '../../../src/models/decision-tree';

interface MockEnv extends Env {
	CONFIG: KVNamespace & {
		__getWithMetadata: ReturnType<typeof vi.fn>;
	};
}

function createMockEnv(tree: DecisionTree | null, metadata?: Record<string, any>): MockEnv {
	const getWithMetadata = vi.fn(async () => ({ value: tree, metadata }));
	const mockKV = {
		getWithMetadata,
		get: vi.fn(async () => tree),
		put: vi.fn(),
		delete: vi.fn(),
		list: vi.fn(),
	} as unknown as KVNamespace & { __getWithMetadata: typeof getWithMetadata };

	(mockKV as any).__getWithMetadata = getWithMetadata;

	return {
		CONFIG: mockKV,
	} as MockEnv;
}

describe('decision-tree model loader', () => {
	beforeEach(() => {
		clearDecisionTreeCache();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns null evaluation when no model is loaded', () => {
		const result = evaluateDecisionTree({ sequential_confidence: 0.5 });
		expect(result).toBeNull();
	});

	it('loads model from KV and exposes version metadata', async () => {
		const tree: DecisionTree = {
			t: 'n',
			f: 'sequential_confidence',
			v: 0.5,
			operator: '>=',
			l: { t: 'l', v: 0.9, reason: 'high_sequence' },
			r: { t: 'l', v: 0.1, reason: 'low_sequence' },
		};
		const env = createMockEnv(tree, { version: 'tree_v1' });

		const loaded = await loadDecisionTreeModel(env);
		expect(loaded).toBe(true);
		expect(getDecisionTreeVersion()).toBe('tree_v1');

		const result = evaluateDecisionTree({ sequential_confidence: 0.7 });
		expect(result).not.toBeNull();
		expect(result?.reason).toBe('high_sequence');
		expect(result?.score).toBeCloseTo(0.9, 5);
	});

	it('caches model until TTL expires or force reload is requested', async () => {
		const treeA: DecisionTree = {
			t: 'l',
			v: 0.2,
			reason: 'initial',
		};
		const treeB: DecisionTree = {
			t: 'l',
			v: 0.8,
			reason: 'updated',
		};

		const env = createMockEnv(treeA, { version: 'tree_a' });
		await loadDecisionTreeModel(env);
		expect((env.CONFIG as any).__getWithMetadata).toHaveBeenCalledTimes(1);

		// Update KV response but ensure cache prevents a refetch
		(env.CONFIG as any).__getWithMetadata.mockResolvedValueOnce({ value: treeB, metadata: { version: 'tree_b' } });
		await loadDecisionTreeModel(env);
		expect((env.CONFIG as any).__getWithMetadata).toHaveBeenCalledTimes(1);

		// Fast-forward past TTL to trigger refresh
		vi.useFakeTimers();
		vi.advanceTimersByTime(60_000);
		await loadDecisionTreeModel(env);
		expect((env.CONFIG as any).__getWithMetadata).toHaveBeenCalledTimes(2);
		vi.useRealTimers();
	});
});
