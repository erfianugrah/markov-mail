/**
 * Dynamic Markov Chain Pattern Detector
 *
 * Based on: Bergholz et al. (2008) "Improved Phishing Detection using Model-Based Features"
 * CEAS 2008, Conference on Email and Anti-Spam
 *
 * Learns character transition probabilities from training data to distinguish
 * legitimate email patterns from fraudulent ones using cross-entropy.
 */

interface MarkovState {
	char: string;
	nextChars: Map<string, number>; // char -> count
	totalTransitions: number;
}

export interface MarkovResult {
	isLikelyFraudulent: boolean;
	crossEntropyLegit: number;
	crossEntropyFraud: number;
	confidence: number;
	differenceRatio: number;
}

/**
 * Dynamic Markov Chain model with adaptive training
 */
export class DynamicMarkovChain {
	private states: Map<string, MarkovState>;
	private trainingCount: number;
	private crossEntropyHistory: number[];
	private readonly smoothingFactor = 0.001;
	private readonly vocabSize = 26 + 10 + 10; // a-z, 0-9, special chars

	constructor() {
		this.states = new Map();
		this.trainingCount = 0;
		this.crossEntropyHistory = [];
	}

	/**
	 * Train the model on a text sample with adaptive training
	 *
	 * @param text Text to train on (email local part)
	 * @param adaptationRate Threshold for skipping easy examples (0.5 = skip if within 0.5 std dev)
	 * @returns true if trained, false if skipped (example was too easy)
	 */
	train(text: string, adaptationRate: number = 0.5): boolean {
		if (!text || text.length < 2) return false;

		const normalized = this.normalize(text);

		// Calculate cross-entropy before training (for adaptive selection)
		const H = this.crossEntropy(normalized);

		// Adaptive training: skip examples the model already handles well
		if (this.trainingCount > 10) {
			const meanH = this.getMeanCrossEntropy();
			const stdH = this.getStdCrossEntropy();

			// Skip if example is within adaptationRate standard deviations
			// (meaning it's "typical" and won't add much information)
			if (H - meanH <= adaptationRate * stdH) {
				return false; // Skipped - already well understood
			}
		}

		// Train on this example - update transition probabilities
		for (let i = 0; i < normalized.length - 1; i++) {
			const current = normalized[i];
			const next = normalized[i + 1];

			if (!this.states.has(current)) {
				this.states.set(current, {
					char: current,
					nextChars: new Map(),
					totalTransitions: 0,
				});
			}

			const state = this.states.get(current)!;
			state.nextChars.set(next, (state.nextChars.get(next) || 0) + 1);
			state.totalTransitions++;
		}

		this.trainingCount++;
		this.crossEntropyHistory.push(H);
		return true; // Trained
	}

	/**
	 * Calculate cross-entropy H(x, M)
	 *
	 * Cross-entropy measures how well model M predicts sequence x.
	 * Lower cross-entropy = x is more likely to have come from this model.
	 *
	 * Formula: H(x, M) = -1/n * Σ log₂ P(bᵢ | b₁...bᵢ₋₁, M)
	 */
	crossEntropy(text: string): number {
		const normalized = this.normalize(text);
		if (normalized.length < 2) return Infinity;

		let logProb = 0;
		let n = 0;

		for (let i = 0; i < normalized.length - 1; i++) {
			const current = normalized[i];
			const next = normalized[i + 1];

			const p = this.getTransitionProb(current, next);
			if (p > 0) {
				logProb += Math.log2(p);
				n++;
			}
		}

		// Cross-entropy: -1/n * log₂ P(x|M)
		return n > 0 ? -logProb / n : Infinity;
	}

	/**
	 * Get probability P(next | current) with Laplace smoothing
	 */
	private getTransitionProb(current: string, next: string): number {
		const state = this.states.get(current);

		// Unseen state - use smoothing
		if (!state || state.totalTransitions === 0) {
			return this.smoothingFactor;
		}

		const count = state.nextChars.get(next) || 0;

		// Laplace smoothing: (count + 1) / (total + vocab_size)
		return (count + 1) / (state.totalTransitions + this.vocabSize);
	}

	/**
	 * Normalize text for consistent processing
	 */
	private normalize(text: string): string {
		return text
			.toLowerCase()
			.replace(/[^a-z0-9._+-]/g, ''); // Keep common email chars
	}

	/**
	 * Get mean cross-entropy from training history
	 */
	private getMeanCrossEntropy(): number {
		if (this.crossEntropyHistory.length === 0) return 0;
		return (
			this.crossEntropyHistory.reduce((a, b) => a + b, 0) /
			this.crossEntropyHistory.length
		);
	}

	/**
	 * Get standard deviation of cross-entropy from training history
	 */
	private getStdCrossEntropy(): number {
		if (this.crossEntropyHistory.length < 2) return 1;

		const mean = this.getMeanCrossEntropy();
		const squaredDiffs = this.crossEntropyHistory.map((h) => (h - mean) ** 2);
		const variance =
			squaredDiffs.reduce((a, b) => a + b, 0) / this.crossEntropyHistory.length;
		return Math.sqrt(variance);
	}

	/**
	 * Get model statistics
	 */
	getStats() {
		let totalStates = this.states.size;
		let totalTransitions = 0;

		for (const state of this.states.values()) {
			totalTransitions += state.nextChars.size;
		}

		return {
			states: totalStates,
			transitions: totalTransitions,
			trainingExamples: this.trainingCount,
			meanCrossEntropy: this.getMeanCrossEntropy(),
			stdCrossEntropy: this.getStdCrossEntropy(),
		};
	}

	/**
	 * Get total number of transitions in the model
	 * @returns Total number of character transitions
	 */
	getTransitionCount(): number {
		let count = 0;
		for (const state of this.states.values()) {
			count += state.nextChars.size;
		}
		return count;
	}

	/**
	 * Serialize model to JSON for storage
	 */
	toJSON() {
		const statesArray: any[] = [];
		for (const [char, state] of this.states.entries()) {
			statesArray.push({
				char,
				nextChars: Array.from(state.nextChars.entries()),
				totalTransitions: state.totalTransitions,
			});
		}

		return {
			states: statesArray,
			trainingCount: this.trainingCount,
			crossEntropyHistory: this.crossEntropyHistory,
		};
	}

	/**
	 * Load model from JSON
	 */
	static fromJSON(data: any): DynamicMarkovChain {
		const model = new DynamicMarkovChain();
		model.trainingCount = data.trainingCount || 0;
		model.crossEntropyHistory = data.crossEntropyHistory || [];

		for (const stateData of data.states || []) {
			model.states.set(stateData.char, {
				char: stateData.char,
				nextChars: new Map(stateData.nextChars),
				totalTransitions: stateData.totalTransitions,
			});
		}

		return model;
	}
}

/**
 * Detect fraudulent email patterns using Markov Chain models
 */
export function detectMarkovPattern(
	email: string,
	legitimateModel: DynamicMarkovChain,
	fraudulentModel: DynamicMarkovChain
): MarkovResult {
	const localPart = email.split('@')[0];

	if (!localPart || localPart.length < 2) {
		return {
			isLikelyFraudulent: false,
			crossEntropyLegit: Infinity,
			crossEntropyFraud: Infinity,
			confidence: 0,
			differenceRatio: 0,
		};
	}

	// Calculate cross-entropy for both models
	const H_legit = legitimateModel.crossEntropy(localPart);
	const H_fraud = fraudulentModel.crossEntropy(localPart);

	// Lower cross-entropy = better fit to that model
	const isLikelyFraudulent = H_fraud < H_legit;

	// Calculate confidence based on difference
	// Larger difference = more confident
	const diff = Math.abs(H_legit - H_fraud);
	const maxH = Math.max(H_legit, H_fraud);
	const differenceRatio = maxH > 0 ? diff / maxH : 0;

	// Confidence: 0-1 scale
	// High difference ratio = high confidence
	const confidence = Math.min(differenceRatio, 1);

	return {
		isLikelyFraudulent,
		crossEntropyLegit: H_legit,
		crossEntropyFraud: H_fraud,
		confidence,
		differenceRatio,
	};
}

/**
 * Train models on example data
 */
export function trainMarkovModels(
	legitimateEmails: string[],
	fraudulentEmails: string[],
	adaptationRate: number = 0.5
): {
	legitimateModel: DynamicMarkovChain;
	fraudulentModel: DynamicMarkovChain;
	stats: any;
} {
	const legitimateModel = new DynamicMarkovChain();
	const fraudulentModel = new DynamicMarkovChain();

	let legitTrained = 0;
	let legitSkipped = 0;
	let fraudTrained = 0;
	let fraudSkipped = 0;

	// Train legitimate model
	for (const email of legitimateEmails) {
		const localPart = email.split('@')[0];
		if (legitimateModel.train(localPart, adaptationRate)) {
			legitTrained++;
		} else {
			legitSkipped++;
		}
	}

	// Train fraudulent model
	for (const email of fraudulentEmails) {
		const localPart = email.split('@')[0];
		if (fraudulentModel.train(localPart, adaptationRate)) {
			fraudTrained++;
		} else {
			fraudSkipped++;
		}
	}

	return {
		legitimateModel,
		fraudulentModel,
		stats: {
			legitimate: {
				trained: legitTrained,
				skipped: legitSkipped,
				total: legitimateEmails.length,
				skipRate: legitSkipped / legitimateEmails.length,
				...legitimateModel.getStats(),
			},
			fraudulent: {
				trained: fraudTrained,
				skipped: fraudSkipped,
				total: fraudulentEmails.length,
				skipRate: fraudSkipped / fraudulentEmails.length,
				...fraudulentModel.getStats(),
			},
		},
	};
}
