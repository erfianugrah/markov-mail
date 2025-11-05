/**
 * N-Gram Markov Chain Implementation
 *
 * Generalized Markov Chain that supports different n-gram orders:
 * - 1-gram (unigram): Character frequency model
 * - 2-gram (bigram): Single character context
 * - 3-gram (trigram): Two characters of context
 *
 * Based on: Bergholz et al. (2008)
 */

interface NGramState {
	context: string; // Empty for 1-gram, 1 char for 2-gram, 2 chars for 3-gram
	nextChars: Map<string, number>; // char → count
	totalTransitions: number;
}

export interface NGramMarkovResult {
	crossEntropy: number;
	order: number; // 1, 2, or 3
}

/**
 * N-Gram Markov Chain model
 */
export class NGramMarkovChain {
	private states: Map<string, NGramState>;
	private trainingCount: number;
	private crossEntropyHistory: number[];
	private readonly smoothingFactor = 0.001;
	private readonly vocabSize = 26 + 10 + 10; // a-z, 0-9, special chars
	private readonly order: number; // 1, 2, or 3

	constructor(order: number = 2) {
		if (order < 1 || order > 3) {
			throw new Error('N-gram order must be 1, 2, or 3');
		}
		this.order = order;
		this.states = new Map();
		this.trainingCount = 0;
		this.crossEntropyHistory = [];
	}

	/**
	 * Get the order of this model (1, 2, or 3)
	 */
	getOrder(): number {
		return this.order;
	}

	/**
	 * Train the model on a text sample
	 */
	train(text: string, adaptationRate: number = 0.5): boolean {
		if (!text || text.length < this.order) return false;

		const normalized = this.normalize(text);
		if (normalized.length < this.order) return false;

		// Calculate cross-entropy before training (for adaptive selection)
		const H = this.crossEntropy(normalized);

		// Adaptive training: DISABLED for base model training
		// This should only be used for online learning after a base model is established
		// if (this.trainingCount > 10) {
		// 	const meanH = this.getMeanCrossEntropy();
		// 	const stdH = this.getStdCrossEntropy();
		//
		// 	if (H - meanH <= adaptationRate * stdH) {
		// 		return false; // Skipped - already well understood
		// 	}
		// }

		// Train based on order
		for (let i = this.order - 1; i < normalized.length; i++) {
			const context = this.getContext(normalized, i);
			const next = normalized[i];

			if (!this.states.has(context)) {
				this.states.set(context, {
					context,
					nextChars: new Map(),
					totalTransitions: 0,
				});
			}

			const state = this.states.get(context)!;
			state.nextChars.set(next, (state.nextChars.get(next) || 0) + 1);
			state.totalTransitions++;
		}

		this.trainingCount++;
		this.crossEntropyHistory.push(H);
		return true;
	}

	/**
	 * Get context for position i based on model order
	 * - Order 1: '' (no context, just character frequencies)
	 * - Order 2: normalized[i-1]
	 * - Order 3: normalized[i-2] + normalized[i-1]
	 */
	private getContext(text: string, i: number): string {
		if (this.order === 1) {
			return ''; // Unigram: no context
		} else if (this.order === 2) {
			return i > 0 ? text[i - 1] : '';
		} else {
			// Order 3: trigram
			if (i < 2) return '';
			return text[i - 2] + text[i - 1];
		}
	}

	/**
	 * Calculate cross-entropy H(x, M)
	 */
	crossEntropy(text: string): number {
		const normalized = this.normalize(text);
		if (normalized.length < this.order) return Infinity;

		let logProb = 0;
		let n = 0;

		for (let i = this.order - 1; i < normalized.length; i++) {
			const context = this.getContext(normalized, i);
			const next = normalized[i];

			const p = this.getTransitionProb(context, next);
			if (p > 0) {
				logProb += Math.log2(p);
				n++;
			}
		}

		return n > 0 ? -logProb / n : Infinity;
	}

	/**
	 * Get probability P(next | context) with Laplace smoothing
	 */
	private getTransitionProb(context: string, next: string): number {
		const state = this.states.get(context);

		if (!state || state.totalTransitions === 0) {
			return this.smoothingFactor;
		}

		const count = state.nextChars.get(next) || 0;
		return (count + 1) / (state.totalTransitions + this.vocabSize);
	}

	/**
	 * Normalize text for consistent processing
	 */
	private normalize(text: string): string {
		return text
			.toLowerCase()
			.replace(/[^a-z0-9._+-]/g, '');
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
	 * Get standard deviation of cross-entropy
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
	 * Get total number of transitions in the model
	 */
	getTransitionCount(): number {
		let totalTransitions = 0;
		for (const state of this.states.values()) {
			totalTransitions += state.nextChars.size;
		}
		return totalTransitions;
	}

	/**
	 * Get model statistics
	 */
	getStats() {
		return {
			order: this.order,
			states: this.states.size,
			transitions: this.getTransitionCount(),
			trainingExamples: this.trainingCount,
			meanCrossEntropy: this.getMeanCrossEntropy(),
			stdCrossEntropy: this.getStdCrossEntropy(),
		};
	}

	/**
	 * Serialize model to JSON for storage
	 */
	toJSON() {
		const statesArray: any[] = [];
		for (const [context, state] of this.states.entries()) {
			statesArray.push({
				context,
				nextChars: Array.from(state.nextChars.entries()),
				totalTransitions: state.totalTransitions,
			});
		}

		return {
			order: this.order,
			states: statesArray,
			trainingCount: this.trainingCount,
			crossEntropyHistory: this.crossEntropyHistory,
		};
	}

	/**
	 * Load model from JSON
	 */
	static fromJSON(data: any): NGramMarkovChain {
		const model = new NGramMarkovChain(data.order || 2);
		model.trainingCount = data.trainingCount || 0;
		model.crossEntropyHistory = data.crossEntropyHistory || [];

		for (const stateData of data.states || []) {
			model.states.set(stateData.context, {
				context: stateData.context,
				nextChars: new Map(stateData.nextChars),
				totalTransitions: stateData.totalTransitions,
			});
		}

		return model;
	}
}
