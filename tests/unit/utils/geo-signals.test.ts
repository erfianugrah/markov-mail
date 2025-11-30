import { describe, it, expect } from 'vitest';
import { computeGeoSignals } from '../../../src/utils/geo-signals';

describe('computeGeoSignals', () => {
	it('flags language mismatches', () => {
		const signals = computeGeoSignals({
			ipCountry: 'US',
			acceptLanguage: 'fr-FR,fr;q=0.9',
		});

		expect(signals.languageMismatch).toBe(true);
		expect(signals.anomalyScore).toBeGreaterThan(0);
	});

	it('flags timezone mismatches when client hint differs', () => {
		const signals = computeGeoSignals({
			ipCountry: 'US',
			clientTimezone: 'Asia/Tokyo',
			edgeTimezone: 'America/New_York',
		});

		expect(signals.timezoneMismatch).toBe(true);
		expect(signals.anomalyScore).toBeGreaterThan(0);
	});

	it('returns quiet signals when inputs align', () => {
		const signals = computeGeoSignals({
			ipCountry: 'DE',
			acceptLanguage: 'de-DE,de;q=0.8',
			clientTimezone: 'Europe/Berlin',
			edgeTimezone: 'Europe/Berlin',
		});

		expect(signals.languageMismatch).toBe(false);
		expect(signals.timezoneMismatch).toBe(false);
		expect(signals.anomalyScore).toBe(0);
	});
});
