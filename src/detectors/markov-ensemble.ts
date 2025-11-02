/**
 * Ensemble Markov Chain Detector
 *
 * Combines 1-gram, 2-gram, and 3-gram Markov models with weighted voting
 * for improved accuracy and robustness.
 *
 * Based on: Bergholz et al. (2008) - "Improved Phishing Detection using Model-Based Features"
 */

import { NGramMarkovChain, type NGramMarkovResult } from './ngram-markov';

export interface EnsembleWeights {
	unigram: number; // 1-gram weight (default: 0.20)
	bigram: number; // 2-gram weight (default: 0.50)
	trigram: number; // 3-gram weight (default: 0.30)
}

export interface EnsembleResult {
	// Combined risk assessment
	combinedEntropy: number; // Weighted average cross-entropy
	prediction: 'legit' | 'fraud'; // Final prediction
	confidence: number; // 0.0-1.0, based on model agreement

	// Individual model results
	models: {
		unigram: NGramMarkovResult & { prediction: 'legit' | 'fraud' };
		bigram: NGramMarkovResult & { prediction: 'legit' | 'fraud' };
		trigram: NGramMarkovResult & { prediction: 'legit' | 'fraud' };
	};

	// Model agreement metrics
	agreement: {
		unanimous: boolean; // All models agree
		majority: boolean; // At least 2 models agree
		disagreementScore: number; // 0.0-1.0, lower is better
	};
}

export interface EnsembleModels {
	unigram: { legit: NGramMarkovChain; fraud: NGramMarkovChain };
	bigram: { legit: NGramMarkovChain; fraud: NGramMarkovChain };
	trigram: { legit: NGramMarkovChain; fraud: NGramMarkovChain };
}

/**
 * Default weights based on empirical performance:
 * - Unigram (20%): Character frequency baseline
 * - Bigram (50%): Primary model, best balance of context vs generalization
 * - Trigram (30%): Additional context for complex patterns
 */
export const DEFAULT_ENSEMBLE_WEIGHTS: EnsembleWeights = {
	unigram: 0.2,
	bigram: 0.5,
	trigram: 0.3,
};

/**
 * Ensemble Markov Chain Detector
 */
export class MarkovEnsembleDetector {
	private models: EnsembleModels;
	private weights: EnsembleWeights;

	constructor(models: EnsembleModels, weights: EnsembleWeights = DEFAULT_ENSEMBLE_WEIGHTS) {
		// Validate weights sum to 1.0
		const sum = weights.unigram + weights.bigram + weights.trigram;
		if (Math.abs(sum - 1.0) > 0.001) {
			throw new Error(
				`Ensemble weights must sum to 1.0, got ${sum.toFixed(3)}`
			);
		}

		this.models = models;
		this.weights = weights;
	}

	/**
	 * Detect if email local part is fraudulent using ensemble approach
	 */
	detect(localPart: string): EnsembleResult {
		// Get predictions from each model
		const unigramResult = this.detectWithOrder(localPart, 1);
		const bigramResult = this.detectWithOrder(localPart, 2);
		const trigramResult = this.detectWithOrder(localPart, 3);

		// Calculate weighted combined entropy
		// Lower entropy = more confident in pattern
		const combinedEntropy =
			unigramResult.crossEntropy * this.weights.unigram +
			bigramResult.crossEntropy * this.weights.bigram +
			trigramResult.crossEntropy * this.weights.trigram;

		// Determine final prediction based on weighted vote
		const predictions = [
			{ order: 1, prediction: unigramResult.prediction, weight: this.weights.unigram },
			{ order: 2, prediction: bigramResult.prediction, weight: this.weights.bigram },
			{ order: 3, prediction: trigramResult.prediction, weight: this.weights.trigram },
		];

		let legitScore = 0;
		let fraudScore = 0;

		for (const { prediction, weight } of predictions) {
			if (prediction === 'legit') {
				legitScore += weight;
			} else {
				fraudScore += weight;
			}
		}

		const prediction: 'legit' | 'fraud' = fraudScore > legitScore ? 'fraud' : 'legit';

		// Calculate agreement metrics
		const agreement = this.calculateAgreement(
			unigramResult.prediction,
			bigramResult.prediction,
			trigramResult.prediction
		);

		// Calculate confidence based on:
		// 1. Model agreement (unanimous > majority > split)
		// 2. Margin between legit and fraud scores
		const scoreMargin = Math.abs(fraudScore - legitScore);
		let confidence = 0.0;

		if (agreement.unanimous) {
			confidence = 0.9 + scoreMargin * 0.1; // 0.9-1.0
		} else if (agreement.majority) {
			confidence = 0.7 + scoreMargin * 0.2; // 0.7-0.9
		} else {
			confidence = 0.5 + scoreMargin * 0.2; // 0.5-0.7
		}

		confidence = Math.min(1.0, Math.max(0.0, confidence));

		return {
			combinedEntropy,
			prediction,
			confidence,
			models: {
				unigram: unigramResult,
				bigram: bigramResult,
				trigram: trigramResult,
			},
			agreement,
		};
	}

	/**
	 * Detect with a specific n-gram order
	 */
	private detectWithOrder(
		localPart: string,
		order: 1 | 2 | 3
	): NGramMarkovResult & { prediction: 'legit' | 'fraud' } {
		let legitModel: NGramMarkovChain;
		let fraudModel: NGramMarkovChain;

		if (order === 1) {
			legitModel = this.models.unigram.legit;
			fraudModel = this.models.unigram.fraud;
		} else if (order === 2) {
			legitModel = this.models.bigram.legit;
			fraudModel = this.models.bigram.fraud;
		} else {
			legitModel = this.models.trigram.legit;
			fraudModel = this.models.trigram.fraud;
		}

		const legitEntropy = legitModel.crossEntropy(localPart);
		const fraudEntropy = fraudModel.crossEntropy(localPart);

		// Lower cross-entropy = better fit to that model
		const prediction: 'legit' | 'fraud' = legitEntropy < fraudEntropy ? 'legit' : 'fraud';

		// Use the minimum entropy as the "score" for this order
		const crossEntropy = Math.min(legitEntropy, fraudEntropy);

		return {
			crossEntropy,
			order,
			prediction,
		};
	}

	/**
	 * Calculate agreement between models
	 */
	private calculateAgreement(
		pred1: 'legit' | 'fraud',
		pred2: 'legit' | 'fraud',
		pred3: 'legit' | 'fraud'
	): {
		unanimous: boolean;
		majority: boolean;
		disagreementScore: number;
	} {
		const predictions = [pred1, pred2, pred3];
		const fraudCount = predictions.filter((p) => p === 'fraud').length;
		const legitCount = predictions.filter((p) => p === 'legit').length;

		const unanimous = fraudCount === 3 || legitCount === 3;
		const majority = fraudCount >= 2 || legitCount >= 2;

		// Disagreement score: 0.0 (unanimous) to 1.0 (split)
		const disagreementScore = unanimous ? 0.0 : majority ? 0.33 : 1.0;

		return {
			unanimous,
			majority,
			disagreementScore,
		};
	}

	/**
	 * Get ensemble statistics
	 */
	getStats() {
		return {
			weights: this.weights,
			models: {
				unigram: {
					legit: this.models.unigram.legit.getStats(),
					fraud: this.models.unigram.fraud.getStats(),
				},
				bigram: {
					legit: this.models.bigram.legit.getStats(),
					fraud: this.models.bigram.fraud.getStats(),
				},
				trigram: {
					legit: this.models.trigram.legit.getStats(),
					fraud: this.models.trigram.fraud.getStats(),
				},
			},
		};
	}

	/**
	 * Load ensemble models from KV namespace
	 */
	static async loadFromKV(kv: KVNamespace, weights?: EnsembleWeights): Promise<MarkovEnsembleDetector> {
		// Load all 6 models from KV
		const [
			unigramLegitJson,
			unigramFraudJson,
			bigramLegitJson,
			bigramFraudJson,
			trigramLegitJson,
			trigramFraudJson,
		] = await Promise.all([
			kv.get('MM_legit_1gram', 'text'),
			kv.get('MM_fraud_1gram', 'text'),
			kv.get('MM_legit_2gram', 'text'),
			kv.get('MM_fraud_2gram', 'text'),
			kv.get('MM_legit_3gram', 'text'),
			kv.get('MM_fraud_3gram', 'text'),
		]);

		if (
			!unigramLegitJson ||
			!unigramFraudJson ||
			!bigramLegitJson ||
			!bigramFraudJson ||
			!trigramLegitJson ||
			!trigramFraudJson
		) {
			throw new Error('Missing required ensemble models in KV');
		}

		const models: EnsembleModels = {
			unigram: {
				legit: NGramMarkovChain.fromJSON(JSON.parse(unigramLegitJson)),
				fraud: NGramMarkovChain.fromJSON(JSON.parse(unigramFraudJson)),
			},
			bigram: {
				legit: NGramMarkovChain.fromJSON(JSON.parse(bigramLegitJson)),
				fraud: NGramMarkovChain.fromJSON(JSON.parse(bigramFraudJson)),
			},
			trigram: {
				legit: NGramMarkovChain.fromJSON(JSON.parse(trigramLegitJson)),
				fraud: NGramMarkovChain.fromJSON(JSON.parse(trigramFraudJson)),
			},
		};

		return new MarkovEnsembleDetector(models, weights);
	}

	/**
	 * Load ensemble models from JSON files (for testing/development)
	 */
	static loadFromJSON(
		unigramLegit: any,
		unigramFraud: any,
		bigramLegit: any,
		bigramFraud: any,
		trigramLegit: any,
		trigramFraud: any,
		weights?: EnsembleWeights
	): MarkovEnsembleDetector {
		const models: EnsembleModels = {
			unigram: {
				legit: NGramMarkovChain.fromJSON(unigramLegit),
				fraud: NGramMarkovChain.fromJSON(unigramFraud),
			},
			bigram: {
				legit: NGramMarkovChain.fromJSON(bigramLegit),
				fraud: NGramMarkovChain.fromJSON(bigramFraud),
			},
			trigram: {
				legit: NGramMarkovChain.fromJSON(trigramLegit),
				fraud: NGramMarkovChain.fromJSON(trigramFraud),
			},
		};

		return new MarkovEnsembleDetector(models, weights);
	}
}
