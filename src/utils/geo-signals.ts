export interface GeoSignalInput {
	ipCountry?: string | null;
	acceptLanguage?: string | null;
	clientTimezone?: string | null;
	edgeTimezone?: string | null;
}

export interface GeoSignals {
	ipCountry?: string;
	acceptLanguage?: string | null;
	acceptLanguageCountry?: string | null;
	clientTimezone?: string | null;
	edgeTimezone?: string | null;
	languageMismatch: boolean;
	timezoneMismatch: boolean;
	anomalyScore: number;
}

function normalizeCountry(value: string | null | undefined): string | undefined {
	return value ? value.trim().toUpperCase() : undefined;
}

function extractLanguageCountry(acceptLanguage: string | null | undefined): string | null {
	if (!acceptLanguage) return null;
	const primary = acceptLanguage.split(',')[0]?.trim();
	if (!primary) return null;
	const parts = primary.split('-');
	if (parts.length < 2) {
		return null;
	}
	return parts[parts.length - 1].toUpperCase();
}

export function computeGeoSignals(input: GeoSignalInput): GeoSignals {
	const ipCountry = normalizeCountry(input.ipCountry ?? undefined);
	const acceptLanguageCountry = extractLanguageCountry(input.acceptLanguage);
	const edgeTimezone = input.edgeTimezone ?? undefined;
	const clientTimezone = input.clientTimezone ?? undefined;

	const languageMismatch =
		Boolean(ipCountry && acceptLanguageCountry) && ipCountry !== acceptLanguageCountry;

	const timezoneMismatch =
		Boolean(edgeTimezone && clientTimezone) && edgeTimezone !== clientTimezone;

	const anomalyScore = Math.min(
		1,
		(languageMismatch ? 0.6 : 0) + (timezoneMismatch ? 0.4 : 0)
	);

	return {
		ipCountry,
		acceptLanguage: input.acceptLanguage ?? null,
		acceptLanguageCountry,
		clientTimezone: clientTimezone ?? null,
		edgeTimezone: edgeTimezone ?? null,
		languageMismatch,
		timezoneMismatch,
		anomalyScore,
	};
}
