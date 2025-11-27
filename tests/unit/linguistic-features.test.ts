import { describe, it, expect } from 'vitest';
import { extractLocalPartFeatureSignals } from '../../src/detectors/linguistic-features';

describe('extractLocalPartFeatureSignals', () => {
	it('keeps pronounceable local parts high-scoring', () => {
		const signals = extractLocalPartFeatureSignals('nicholas.mitchell');

		expect(signals.linguistic.pronounceability).toBeGreaterThan(0.6);
		expect(signals.structure.hasWordBoundaries).toBe(true);
		expect(signals.structure.segmentCount).toBeGreaterThanOrEqual(2);
		expect(signals.linguistic.hasImpossibleCluster).toBe(false);
	});

	it('flags impossible clusters and low pronounceability strings', () => {
		const signals = extractLocalPartFeatureSignals('qbekzs');

		expect(signals.linguistic.vowelRatio).toBeLessThan(0.2);
		expect(signals.linguistic.hasImpossibleCluster).toBe(true);
		expect(signals.linguistic.pronounceability).toBeLessThan(0.5);
	});

	it('detects heavy repetition mixed with digits', () => {
		const signals = extractLocalPartFeatureSignals('sssssss934');

		expect(signals.linguistic.maxRepeatedCharRun).toBeGreaterThanOrEqual(5);
		expect(signals.linguistic.repeatedCharRatio).toBeGreaterThan(0.5);
		expect(signals.statistical.digitRatio).toBeGreaterThan(0.2);
	});

	it('keeps multilingual legitimate names healthy', () => {
		const signals = extractLocalPartFeatureSignals('nguyen');

		expect(signals.linguistic.pronounceability).toBeGreaterThan(0.5);
		expect(signals.linguistic.hasImpossibleCluster).toBe(false);
		expect(signals.linguistic.syllableEstimate).toBeGreaterThanOrEqual(1);
	});
});
