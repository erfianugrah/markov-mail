export interface CalibrationFeatureStats {
	name: string;
	mean: number;
	std: number;
	weight: number;
}

export interface CalibrationCoefficients {
	version: string;
	createdAt: string;
	bias: number;
	features: CalibrationFeatureStats[];
	metrics?: {
		accuracy: number;
		precision: number;
		recall: number;
		f1: number;
	};
}

export interface CalibrationFeatureInput {
	markov: {
		ceLegit2?: number;
		ceFraud2?: number;
		ceLegit3?: number;
		ceFraud3?: number;
		minEntropy?: number;
		abnormalityRisk?: number;
	};
	sequentialConfidence?: number;
	plusRisk?: number;
	localPartLength?: number;
	digitRatio?: number;
	providerIsFree?: boolean;
	providerIsDisposable?: boolean;
	tldRisk?: number;
}

export type CalibrationFeatureMap = Record<string, number>;

function sanitize(value: number | undefined, fallback = 0, clamp?: { min?: number; max?: number }): number {
	if (value === undefined || Number.isNaN(value) || !Number.isFinite(value)) {
		return fallback;
	}

	let result = value;
	if (clamp?.min !== undefined && result < clamp.min) {
		result = clamp.min;
	}
	if (clamp?.max !== undefined && result > clamp.max) {
		result = clamp.max;
	}
	return result;
}

export function buildCalibrationFeatureMap(input: CalibrationFeatureInput): CalibrationFeatureMap {
	const ceLegit2 = sanitize(input.markov.ceLegit2, 0, { min: 0, max: 20 });
	const ceFraud2 = sanitize(input.markov.ceFraud2, 0, { min: 0, max: 20 });
	const ceLegit3 = sanitize(input.markov.ceLegit3, ceLegit2, { min: 0, max: 20 });
	const ceFraud3 = sanitize(input.markov.ceFraud3, ceFraud2, { min: 0, max: 20 });
	const minEntropy = sanitize(
		input.markov.minEntropy ?? Math.min(ceLegit2, ceFraud2, ceLegit3, ceFraud3),
		Math.min(ceLegit2, ceFraud2)
	);

	const features: CalibrationFeatureMap = {
		ce_legit2: ceLegit2,
		ce_fraud2: ceFraud2,
		ce_diff2: ceLegit2 - ceFraud2,
		ce_legit3: ceLegit3,
		ce_fraud3: ceFraud3,
		ce_diff3: ceLegit3 - ceFraud3,
		min_entropy: minEntropy,
		sequential_confidence: sanitize(input.sequentialConfidence, 0, { min: 0, max: 1 }),
		plus_risk: sanitize(input.plusRisk, 0, { min: 0, max: 1 }),
		local_length: sanitize(input.localPartLength, 0, { min: 0, max: 128 }),
		digit_ratio: sanitize(input.digitRatio, 0, { min: 0, max: 1 }),
		provider_is_free: input.providerIsFree ? 1 : 0,
		provider_is_disposable: input.providerIsDisposable ? 1 : 0,
		tld_risk: sanitize(input.tldRisk, 0, { min: 0, max: 1 }),
		abnormality_risk: sanitize(input.markov.abnormalityRisk, 0, { min: 0, max: 1 }),
	};

	return features;
}

export function applyCalibration(
	calibration: CalibrationCoefficients | null | undefined,
	featureMap: CalibrationFeatureMap | undefined
): number | null {
	if (!calibration || !featureMap) {
		return null;
	}

	let z = calibration.bias;

	for (const feature of calibration.features) {
		const value = featureMap[feature.name] ?? 0;
		const normalized = feature.std === 0 ? value - feature.mean : (value - feature.mean) / feature.std;
		z += feature.weight * normalized;
	}

	return 1 / (1 + Math.exp(-z));
}
