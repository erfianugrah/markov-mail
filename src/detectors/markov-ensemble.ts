import { NGramMarkovChain } from './ngram-markov';

export interface MarkovResult {
	isLikelyFraudulent: boolean;
	crossEntropyLegit: number;
	crossEntropyFraud: number;
	crossEntropyLegit2?: number;
	crossEntropyFraud2?: number;
	crossEntropyLegit3?: number;
	crossEntropyFraud3?: number;
	confidence: number;
	differenceRatio: number;
	ensembleReasoning?: string;
	model2gramPrediction?: string;
	model3gramPrediction?: string;
	minEntropy?: number;
	abnormalityScore?: number;
	abnormalityRisk?: number;
}

export const ENSEMBLE_THRESHOLDS = {
	both_agree_min: 0.3,
	override_3gram_min: 0.5,
	override_ratio: 1.5,
	gibberish_entropy: 6.0,
	gibberish_2gram_min: 0.2,
};

export const OOD_CONSTANTS = {
	BASELINE_ENTROPY: 0.69,
	OOD_WARN_THRESHOLD: 3.8,
	OOD_BLOCK_THRESHOLD: 5.5,
};

export function ensemblePredict(
	localPart: string,
	legit2: NGramMarkovChain,
	fraud2: NGramMarkovChain,
	legit3: NGramMarkovChain | null,
	fraud3: NGramMarkovChain | null,
	config: {
		ood: { warnZoneMin: number; maxRisk: number };
	}
): MarkovResult {
	const H_legit2 = legit2.crossEntropy(localPart);
	const H_fraud2 = fraud2.crossEntropy(localPart);

	// Validate 2-gram entropy values (critical - cannot proceed without these)
	if (!Number.isFinite(H_legit2) || !Number.isFinite(H_fraud2)) {
		// Return safe default result if models produce invalid values
		return {
			isLikelyFraudulent: false,
			crossEntropyLegit: 0,
			crossEntropyFraud: 0,
			crossEntropyLegit2: 0,
			crossEntropyFraud2: 0,
			confidence: 0,
			differenceRatio: 0,
			ensembleReasoning: 'invalid_entropy_fallback',
			model2gramPrediction: 'error',
			minEntropy: 0,
			abnormalityScore: 0,
			abnormalityRisk: 0,
		};
	}

	const isLikelyFraud2 = H_fraud2 < H_legit2;
	const diff2 = Math.abs(H_legit2 - H_fraud2);
	const maxH2 = Math.max(H_legit2, H_fraud2);
	const diffRatio2 = maxH2 > 0 ? diff2 / maxH2 : 0;
	const confidence2 = Math.min(diffRatio2 * 2, 1.0);
	const prediction2 = isLikelyFraud2 ? 'fraud' : 'legit';

	if (!legit3 || !fraud3) {
		const minEntropy = Math.min(H_legit2, H_fraud2);
		const { abnormalityScore, abnormalityRisk } = calculateAbnormality(minEntropy, config);

		return {
			isLikelyFraudulent: isLikelyFraud2,
			crossEntropyLegit: H_legit2,
			crossEntropyFraud: H_fraud2,
			crossEntropyLegit2: H_legit2,
			crossEntropyFraud2: H_fraud2,
			confidence: confidence2,
			differenceRatio: diffRatio2,
			ensembleReasoning: '2gram_only',
			model2gramPrediction: prediction2,
			minEntropy,
			abnormalityScore,
			abnormalityRisk,
		};
	}

	const H_legit3 = legit3.crossEntropy(localPart);
	const H_fraud3 = fraud3.crossEntropy(localPart);

	// Validate 3-gram entropy values (if invalid, fall back to 2-gram only)
	if (!Number.isFinite(H_legit3) || !Number.isFinite(H_fraud3)) {
		const minEntropy = Math.min(H_legit2, H_fraud2);
		const { abnormalityScore, abnormalityRisk } = calculateAbnormality(minEntropy, config);

		return {
			isLikelyFraudulent: isLikelyFraud2,
			crossEntropyLegit: H_legit2,
			crossEntropyFraud: H_fraud2,
			crossEntropyLegit2: H_legit2,
			crossEntropyFraud2: H_fraud2,
			confidence: confidence2,
			differenceRatio: diffRatio2,
			ensembleReasoning: '3gram_invalid_fallback_to_2gram',
			model2gramPrediction: prediction2,
			minEntropy,
			abnormalityScore,
			abnormalityRisk,
		};
	}

	const isLikelyFraud3 = H_fraud3 < H_legit3;
	const diff3 = Math.abs(H_legit3 - H_fraud3);
	const maxH3 = Math.max(H_legit3, H_fraud3);
	const diffRatio3 = maxH3 > 0 ? diff3 / maxH3 : 0;
	const confidence3 = Math.min(diffRatio3 * 2, 1.0);
	const prediction3 = isLikelyFraud3 ? 'fraud' : 'legit';

	let finalPrediction: 'fraud' | 'legit';
	let finalConfidence: number;
	let finalCrossEntropyLegit: number;
	let finalCrossEntropyFraud: number;
	let reasoning: string;

	if (prediction2 === prediction3 && Math.min(confidence2, confidence3) > ENSEMBLE_THRESHOLDS.both_agree_min) {
		finalPrediction = prediction2;
		finalConfidence = Math.max(confidence2, confidence3);
		finalCrossEntropyLegit = confidence2 >= confidence3 ? H_legit2 : H_legit3;
		finalCrossEntropyFraud = confidence2 >= confidence3 ? H_fraud2 : H_fraud3;
		reasoning = 'both_agree_high_confidence';
	} else if (
		confidence3 > ENSEMBLE_THRESHOLDS.override_3gram_min &&
		confidence3 > confidence2 * ENSEMBLE_THRESHOLDS.override_ratio
	) {
		finalPrediction = prediction3;
		finalConfidence = confidence3;
		finalCrossEntropyLegit = H_legit3;
		finalCrossEntropyFraud = H_fraud3;
		reasoning = '3gram_high_confidence_override';
	} else if (
		prediction2 === 'fraud' &&
		confidence2 > ENSEMBLE_THRESHOLDS.gibberish_2gram_min &&
		H_fraud2 > ENSEMBLE_THRESHOLDS.gibberish_entropy
	) {
		finalPrediction = 'fraud';
		finalConfidence = confidence2;
		finalCrossEntropyLegit = H_legit2;
		finalCrossEntropyFraud = H_fraud2;
		reasoning = '2gram_gibberish_detection';
	} else if (prediction2 !== prediction3) {
		finalPrediction = prediction2;
		finalConfidence = confidence2;
		finalCrossEntropyLegit = H_legit2;
		finalCrossEntropyFraud = H_fraud2;
		reasoning = 'disagree_default_to_2gram';
	} else {
		if (confidence2 >= confidence3) {
			finalPrediction = prediction2;
			finalConfidence = confidence2;
			finalCrossEntropyLegit = H_legit2;
			finalCrossEntropyFraud = H_fraud2;
			reasoning = '2gram_higher_confidence';
		} else {
			finalPrediction = prediction3;
			finalConfidence = confidence3;
			finalCrossEntropyLegit = H_legit3;
			finalCrossEntropyFraud = H_fraud3;
			reasoning = '3gram_higher_confidence';
		}
	}

	const minEntropy = Math.min(finalCrossEntropyLegit, finalCrossEntropyFraud);
	const { abnormalityScore, abnormalityRisk } = calculateAbnormality(minEntropy, config);

	return {
		isLikelyFraudulent: finalPrediction === 'fraud',
		crossEntropyLegit: finalCrossEntropyLegit,
		crossEntropyFraud: finalCrossEntropyFraud,
		crossEntropyLegit2: H_legit2,
		crossEntropyFraud2: H_fraud2,
		crossEntropyLegit3: legit3 ? H_legit3 : undefined,
		crossEntropyFraud3: fraud3 ? H_fraud3 : undefined,
		confidence: finalConfidence,
		differenceRatio: Math.max(confidence2, confidence3),
		ensembleReasoning: reasoning,
		model2gramPrediction: prediction2,
		model3gramPrediction: prediction3,
		minEntropy,
		abnormalityScore,
		abnormalityRisk,
	};
}

export function calculateAbnormality(minEntropy: number, config: { ood: { warnZoneMin: number; maxRisk: number } }) {
	let abnormalityScore = 0;
	let abnormalityRisk = 0;

	if (minEntropy < OOD_CONSTANTS.OOD_WARN_THRESHOLD) {
		return { abnormalityScore, abnormalityRisk };
	}

	if (minEntropy < OOD_CONSTANTS.OOD_BLOCK_THRESHOLD) {
		abnormalityScore = minEntropy - OOD_CONSTANTS.OOD_WARN_THRESHOLD;
		const range = OOD_CONSTANTS.OOD_BLOCK_THRESHOLD - OOD_CONSTANTS.OOD_WARN_THRESHOLD;
		const progress = abnormalityScore / range;
		abnormalityRisk =
			config.ood.warnZoneMin + progress * (config.ood.maxRisk - config.ood.warnZoneMin);
	} else {
		abnormalityScore = minEntropy - OOD_CONSTANTS.OOD_WARN_THRESHOLD;
		abnormalityRisk = config.ood.maxRisk;
	}

	return { abnormalityScore, abnormalityRisk };
}
