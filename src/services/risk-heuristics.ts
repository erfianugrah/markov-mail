import { logger } from '../logger';

export type HeuristicDecision = 'warn' | 'block';
export type HeuristicDirection = 'gte' | 'lte';

export interface HeuristicRule {
	threshold: number;
	decision: HeuristicDecision;
	reason: string;
	direction?: HeuristicDirection;
	minScoreOffset?: number;
}

export interface RiskHeuristicsConfig {
	tldRisk: HeuristicRule[];
	domainReputation: HeuristicRule[];
	sequentialConfidence: HeuristicRule[];
	digitRatio: HeuristicRule[];
	plusAddressing: HeuristicRule[];
}

const DEFAULT_RISK_HEURISTICS: RiskHeuristicsConfig = {
	tldRisk: [
		{ threshold: 0.9, decision: 'block', reason: 'heuristic_tld_extreme', minScoreOffset: 0.1 },
		{ threshold: 0.8, decision: 'warn', reason: 'heuristic_tld_high', minScoreOffset: 0.1 },
	],
	domainReputation: [
		{ threshold: 0.95, decision: 'block', reason: 'heuristic_domain_reputation_critical', minScoreOffset: 0.08 },
		{ threshold: 0.85, decision: 'warn', reason: 'heuristic_domain_reputation_watch', minScoreOffset: 0.08 },
	],
	sequentialConfidence: [
		{ threshold: 0.98, decision: 'block', reason: 'heuristic_sequence_numeric_extreme', minScoreOffset: 0.05 },
		{ threshold: 0.9, decision: 'warn', reason: 'heuristic_sequence_numeric_high', minScoreOffset: 0.05 },
	],
	digitRatio: [
		{ threshold: 0.9, decision: 'block', reason: 'heuristic_sequence_numeric_extreme', minScoreOffset: 0.05 },
		{ threshold: 0.8, decision: 'warn', reason: 'heuristic_sequence_numeric_high', minScoreOffset: 0.05 },
	],
	plusAddressing: [
		{ threshold: 0.8, decision: 'block', reason: 'heuristic_plus_tag_abuse', minScoreOffset: 0.03 },
	],
};

const CACHE_TTL_MS = 60_000;
const HEURISTICS_KV_KEY = 'risk-heuristics.json';

let cachedHeuristics: RiskHeuristicsConfig | null = null;
let lastLoadedAt = 0;
let loadingPromise: Promise<RiskHeuristicsConfig> | null = null;

function normalizeRule(rule: Partial<HeuristicRule> & { min?: number }): HeuristicRule {
	const threshold = typeof rule.threshold === 'number' ? rule.threshold : (typeof rule.min === 'number' ? rule.min : 0);
	return {
		threshold,
		decision: rule.decision ?? 'warn',
		reason: rule.reason ?? 'heuristic_custom',
		direction: rule.direction ?? 'gte',
		minScoreOffset: rule.minScoreOffset,
	};
}

function sortRules(rules: HeuristicRule[]): HeuristicRule[] {
	const gteRules = rules.filter((rule) => (rule.direction ?? 'gte') === 'gte').sort((a, b) => b.threshold - a.threshold);
	const lteRules = rules.filter((rule) => (rule.direction ?? 'gte') === 'lte').sort((a, b) => a.threshold - b.threshold);
	return [...gteRules, ...lteRules];
}

function normalizeConfig(raw?: Partial<RiskHeuristicsConfig>): RiskHeuristicsConfig {
	const normalizeList = (list?: HeuristicRule[]): HeuristicRule[] => sortRules((list ?? []).map((rule) => normalizeRule(rule)));

	return {
		tldRisk: normalizeList(raw?.tldRisk ?? DEFAULT_RISK_HEURISTICS.tldRisk),
		domainReputation: normalizeList(raw?.domainReputation ?? DEFAULT_RISK_HEURISTICS.domainReputation),
		sequentialConfidence: normalizeList(raw?.sequentialConfidence ?? DEFAULT_RISK_HEURISTICS.sequentialConfidence),
		digitRatio: normalizeList(raw?.digitRatio ?? DEFAULT_RISK_HEURISTICS.digitRatio),
		plusAddressing: normalizeList(raw?.plusAddressing ?? DEFAULT_RISK_HEURISTICS.plusAddressing),
	};
}

function isHeuristicRule(value: any): boolean {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const threshold = typeof value.threshold === 'number' ? value.threshold : (typeof value.min === 'number' ? value.min : undefined);
	return typeof threshold === 'number' && typeof value.decision === 'string' && typeof value.reason === 'string';
}

function validateHeuristics(raw: any): raw is Partial<RiskHeuristicsConfig> {
	if (!raw || typeof raw !== 'object') {
		return false;
	}

	const lists = ['tldRisk', 'domainReputation', 'sequentialConfidence', 'digitRatio', 'plusAddressing'] as const;
	for (const key of lists) {
		if (raw[key] !== undefined) {
			if (!Array.isArray(raw[key])) {
				return false;
			}
			for (const entry of raw[key]) {
				if (!isHeuristicRule(entry)) {
					return false;
				}
			}
		}
	}

	return true;
}

export async function loadRiskHeuristics(kv: KVNamespace | undefined): Promise<RiskHeuristicsConfig> {
	const now = Date.now();
	if (cachedHeuristics && now - lastLoadedAt < CACHE_TTL_MS) {
		return cachedHeuristics;
	}

	if (loadingPromise) {
		return loadingPromise;
	}

	if (!kv) {
		cachedHeuristics = DEFAULT_RISK_HEURISTICS;
		lastLoadedAt = now;
		return cachedHeuristics;
	}

	loadingPromise = (async () => {
		try {
			const remote = await kv.get<RiskHeuristicsConfig | null>(HEURISTICS_KV_KEY, 'json');
			if (remote && validateHeuristics(remote)) {
				cachedHeuristics = normalizeConfig(remote);
			} else {
				cachedHeuristics = DEFAULT_RISK_HEURISTICS;
			}
		} catch (error) {
			logger.warn({
				event: 'risk_heuristics_load_failed',
				message: error instanceof Error ? error.message : String(error),
			}, 'Failed to load risk heuristics from KV, using defaults');
			cachedHeuristics = DEFAULT_RISK_HEURISTICS;
		} finally {
			lastLoadedAt = Date.now();
			loadingPromise = null;
		}

		return cachedHeuristics!;
	})();

	return loadingPromise;
}

export function clearRiskHeuristicsCache(): void {
	cachedHeuristics = null;
	lastLoadedAt = 0;
	loadingPromise = null;
}

export { DEFAULT_RISK_HEURISTICS };
