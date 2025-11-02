/**
 * Unit Tests for Ensemble Markov Chain Detector
 */

import { describe, test, expect } from 'bun:test';
import { NGramMarkovChain } from '../../src/detectors/ngram-markov';
import {
	MarkovEnsembleDetector,
	DEFAULT_ENSEMBLE_WEIGHTS,
	type EnsembleModels,
} from '../../src/detectors/markov-ensemble';

// Helper to create simple test models
function createTestModels(): EnsembleModels {
	// Train on typical legitimate patterns
	const legitSamples = [
		'john.doe',
		'jane.smith',
		'bob.jones',
		'alice.wilson',
		'mike.brown',
		'sarah.davis',
		'admin',
		'support',
		'info',
		'contact',
	];

	// Train on typical fraud patterns
	const fraudSamples = [
		'user123',
		'test456',
		'abc789',
		'zzzzqqq',
		'xxx111',
		'random123xyz',
		'aaaaaa',
		'qqqqqq',
		'zzz999',
		'temp123',
	];

	// Create and train models for each order
	const unigramLegit = new NGramMarkovChain(1);
	const unigramFraud = new NGramMarkovChain(1);
	const bigramLegit = new NGramMarkovChain(2);
	const bigramFraud = new NGramMarkovChain(2);
	const trigramLegit = new NGramMarkovChain(3);
	const trigramFraud = new NGramMarkovChain(3);

	// Train all models
	for (const sample of legitSamples) {
		unigramLegit.train(sample);
		bigramLegit.train(sample);
		trigramLegit.train(sample);
	}

	for (const sample of fraudSamples) {
		unigramFraud.train(sample);
		bigramFraud.train(sample);
		trigramFraud.train(sample);
	}

	return {
		unigram: { legit: unigramLegit, fraud: unigramFraud },
		bigram: { legit: bigramLegit, fraud: bigramFraud },
		trigram: { legit: trigramLegit, fraud: trigramFraud },
	};
}

describe('MarkovEnsembleDetector', () => {
	describe('Constructor', () => {
		test('should create ensemble with default weights', () => {
			const models = createTestModels();
			const detector = new MarkovEnsembleDetector(models);

			const stats = detector.getStats();
			expect(stats.weights).toEqual(DEFAULT_ENSEMBLE_WEIGHTS);
		});

		test('should create ensemble with custom weights', () => {
			const models = createTestModels();
			const customWeights = {
				unigram: 0.1,
				bigram: 0.6,
				trigram: 0.3,
			};
			const detector = new MarkovEnsembleDetector(models, customWeights);

			const stats = detector.getStats();
			expect(stats.weights).toEqual(customWeights);
		});

		test('should throw error if weights do not sum to 1.0', () => {
			const models = createTestModels();
			const invalidWeights = {
				unigram: 0.2,
				bigram: 0.3,
				trigram: 0.3, // Sum = 0.8
			};

			expect(() => new MarkovEnsembleDetector(models, invalidWeights)).toThrow(
				'Ensemble weights must sum to 1.0'
			);
		});
	});

	describe('Detection', () => {
		test('should detect legitimate email patterns', () => {
			const models = createTestModels();
			const detector = new MarkovEnsembleDetector(models);

			// Test with patterns similar to training data
			const result1 = detector.detect('john.smith');
			expect(result1.prediction).toBe('legit');

			const result2 = detector.detect('mary.jones');
			expect(result2.prediction).toBe('legit');

			const result3 = detector.detect('admin');
			expect(result3.prediction).toBe('legit');
		});

		test('should detect fraudulent email patterns', () => {
			const models = createTestModels();
			const detector = new MarkovEnsembleDetector(models);

			// Test with patterns similar to fraud training data
			const result1 = detector.detect('user999');
			expect(result1.prediction).toBe('fraud');

			const result2 = detector.detect('test123');
			expect(result2.prediction).toBe('fraud');

			const result3 = detector.detect('zzzzqqq');
			expect(result3.prediction).toBe('fraud');
		});

		test('should return results from all three models', () => {
			const models = createTestModels();
			const detector = new MarkovEnsembleDetector(models);

			const result = detector.detect('john.doe');

			expect(result.models.unigram).toBeDefined();
			expect(result.models.unigram.order).toBe(1);

			expect(result.models.bigram).toBeDefined();
			expect(result.models.bigram.order).toBe(2);

			expect(result.models.trigram).toBeDefined();
			expect(result.models.trigram.order).toBe(3);
		});

		test('should calculate combined entropy', () => {
			const models = createTestModels();
			const detector = new MarkovEnsembleDetector(models);

			const result = detector.detect('john.doe');

			expect(result.combinedEntropy).toBeGreaterThan(0);
			expect(result.combinedEntropy).toBeLessThan(Infinity);

			// Combined entropy should be weighted average
			const expectedCombined =
				result.models.unigram.crossEntropy * 0.2 +
				result.models.bigram.crossEntropy * 0.5 +
				result.models.trigram.crossEntropy * 0.3;

			expect(result.combinedEntropy).toBeCloseTo(expectedCombined, 2);
		});
	});

	describe('Model Agreement', () => {
		test('should detect unanimous agreement', () => {
			const models = createTestModels();
			const detector = new MarkovEnsembleDetector(models);

			// Use a clear legit pattern
			const result = detector.detect('john.smith');

			// If all models agree, unanimous should be true
			if (
				result.models.unigram.prediction === result.models.bigram.prediction &&
				result.models.bigram.prediction === result.models.trigram.prediction
			) {
				expect(result.agreement.unanimous).toBe(true);
				expect(result.agreement.majority).toBe(true);
				expect(result.agreement.disagreementScore).toBe(0.0);
			}
		});

		test('should detect majority agreement', () => {
			const models = createTestModels();
			const detector = new MarkovEnsembleDetector(models);

			// Test multiple emails to find majority case
			const testEmails = [
				'john.doe',
				'test123',
				'support',
				'random456',
				'alice.wilson',
			];

			for (const email of testEmails) {
				const result = detector.detect(email);

				// At least majority should always be true (2 out of 3)
				expect(result.agreement.majority).toBe(true);
			}
		});

		test('should calculate disagreement score', () => {
			const models = createTestModels();
			const detector = new MarkovEnsembleDetector(models);

			const result = detector.detect('john.doe');

			expect(result.agreement.disagreementScore).toBeGreaterThanOrEqual(0.0);
			expect(result.agreement.disagreementScore).toBeLessThanOrEqual(1.0);
		});
	});

	describe('Confidence Calculation', () => {
		test('should return confidence between 0 and 1', () => {
			const models = createTestModels();
			const detector = new MarkovEnsembleDetector(models);

			const testEmails = ['john.doe', 'test123', 'support', 'user999'];

			for (const email of testEmails) {
				const result = detector.detect(email);
				expect(result.confidence).toBeGreaterThanOrEqual(0.0);
				expect(result.confidence).toBeLessThanOrEqual(1.0);
			}
		});

		test('should have higher confidence for unanimous agreement', () => {
			const models = createTestModels();
			const detector = new MarkovEnsembleDetector(models);

			const testEmails = [
				'john.smith',
				'mary.jones',
				'bob.davis',
				'test123',
				'user456',
			];

			for (const email of testEmails) {
				const result = detector.detect(email);

				if (result.agreement.unanimous) {
					expect(result.confidence).toBeGreaterThanOrEqual(0.9);
				}
			}
		});

		test('should have moderate confidence for majority agreement', () => {
			const models = createTestModels();
			const detector = new MarkovEnsembleDetector(models);

			const testEmails = ['john.doe', 'test123', 'support'];

			for (const email of testEmails) {
				const result = detector.detect(email);

				if (result.agreement.majority && !result.agreement.unanimous) {
					expect(result.confidence).toBeGreaterThanOrEqual(0.7);
					expect(result.confidence).toBeLessThan(0.9);
				}
			}
		});
	});

	describe('Weighted Voting', () => {
		test('should respect custom weights in voting', () => {
			const models = createTestModels();

			// Create detector with heavily biased toward bigram
			const bigramHeavy = new MarkovEnsembleDetector(models, {
				unigram: 0.1,
				bigram: 0.8,
				trigram: 0.1,
			});

			// Create detector with equal weights
			const equalWeights = new MarkovEnsembleDetector(models, {
				unigram: 0.33,
				bigram: 0.34,
				trigram: 0.33,
			});

			const testEmail = 'test.email';

			const result1 = bigramHeavy.detect(testEmail);
			const result2 = equalWeights.detect(testEmail);

			// Combined entropies should be different due to different weights
			// (unless all model entropies are identical, which is unlikely)
			const entropiesDifferent =
				Math.abs(result1.combinedEntropy - result2.combinedEntropy) > 0.001;

			// Should be different for most test cases
			expect(entropiesDifferent).toBe(true);
		});
	});

	describe('Edge Cases', () => {
		test('should handle empty string', () => {
			const models = createTestModels();
			const detector = new MarkovEnsembleDetector(models);

			const result = detector.detect('');

			// Should still return valid result structure
			expect(result.prediction).toBeDefined();
			expect(result.confidence).toBeGreaterThanOrEqual(0.0);
			expect(result.models.unigram).toBeDefined();
		});

		test('should handle single character', () => {
			const models = createTestModels();
			const detector = new MarkovEnsembleDetector(models);

			const result = detector.detect('a');

			expect(result.prediction).toBeDefined();
			expect(result.confidence).toBeGreaterThanOrEqual(0.0);
		});

		test('should handle special characters', () => {
			const models = createTestModels();
			const detector = new MarkovEnsembleDetector(models);

			const result = detector.detect('user+tag');

			expect(result.prediction).toBeDefined();
			expect(result.confidence).toBeGreaterThanOrEqual(0.0);
		});

		test('should handle very long emails', () => {
			const models = createTestModels();
			const detector = new MarkovEnsembleDetector(models);

			const longEmail = 'a'.repeat(100);
			const result = detector.detect(longEmail);

			expect(result.prediction).toBeDefined();
			expect(result.confidence).toBeGreaterThanOrEqual(0.0);
		});
	});

	describe('Serialization', () => {
		test('should load from JSON format', () => {
			const models = createTestModels();

			// Get JSON representations
			const unigramLegitJson = models.unigram.legit.toJSON();
			const unigramFraudJson = models.unigram.fraud.toJSON();
			const bigramLegitJson = models.bigram.legit.toJSON();
			const bigramFraudJson = models.bigram.fraud.toJSON();
			const trigramLegitJson = models.trigram.legit.toJSON();
			const trigramFraudJson = models.trigram.fraud.toJSON();

			// Load from JSON
			const detector = MarkovEnsembleDetector.loadFromJSON(
				unigramLegitJson,
				unigramFraudJson,
				bigramLegitJson,
				bigramFraudJson,
				trigramLegitJson,
				trigramFraudJson
			);

			// Should produce same results
			const result = detector.detect('john.doe');
			expect(result.prediction).toBeDefined();
			expect(result.models.unigram.order).toBe(1);
			expect(result.models.bigram.order).toBe(2);
			expect(result.models.trigram.order).toBe(3);
		});
	});

	describe('Statistics', () => {
		test('should return complete statistics', () => {
			const models = createTestModels();
			const detector = new MarkovEnsembleDetector(models);

			const stats = detector.getStats();

			expect(stats.weights).toBeDefined();
			expect(stats.models.unigram).toBeDefined();
			expect(stats.models.bigram).toBeDefined();
			expect(stats.models.trigram).toBeDefined();

			expect(stats.models.unigram.legit.order).toBe(1);
			expect(stats.models.bigram.legit.order).toBe(2);
			expect(stats.models.trigram.legit.order).toBe(3);
		});
	});
});
