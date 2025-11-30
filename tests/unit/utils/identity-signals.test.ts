import { describe, it, expect } from 'vitest';
import { computeIdentitySignals } from '../../../src/utils/identity-signals';

describe('computeIdentitySignals', () => {
	it('returns zeros when no name provided', () => {
		const signals = computeIdentitySignals(undefined, 'person123');
		expect(signals.similarityScore).toBe(0);
		expect(signals.tokenOverlap).toBe(0);
		expect(signals.nameInEmail).toBe(false);
	});

	it('detects overlap between name tokens and email local part', () => {
		const signals = computeIdentitySignals('Sarah Jones', 's.jones');
		expect(signals.nameInEmail).toBe(true);
		expect(signals.tokenOverlap).toBeGreaterThan(0);
		expect(signals.similarityScore).toBeGreaterThan(0);
	});

	it('handles complex names gracefully', () => {
		const signals = computeIdentitySignals('Jean-Luc Picard', 'capt_picard01');
		expect(signals.tokenOverlap).toBeGreaterThan(0);
		expect(signals.tokens).toContain('jean');
		expect(signals.tokens).toContain('luc');
	});
});
