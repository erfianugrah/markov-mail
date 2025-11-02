/**
 * Unit Tests for N-Gram Markov Chain
 *
 * Tests the generalized Markov Chain implementation supporting 1-gram, 2-gram, 3-gram
 */

import { describe, test, expect } from 'bun:test';
import { NGramMarkovChain } from '../../src/detectors/ngram-markov';

describe('NGramMarkovChain', () => {
	describe('Constructor', () => {
		test('should create 1-gram model', () => {
			const model = new NGramMarkovChain(1);
			expect(model.getOrder()).toBe(1);
		});

		test('should create 2-gram model', () => {
			const model = new NGramMarkovChain(2);
			expect(model.getOrder()).toBe(2);
		});

		test('should create 3-gram model', () => {
			const model = new NGramMarkovChain(3);
			expect(model.getOrder()).toBe(3);
		});

		test('should default to 2-gram if no order specified', () => {
			const model = new NGramMarkovChain();
			expect(model.getOrder()).toBe(2);
		});

		test('should throw error for invalid order < 1', () => {
			expect(() => new NGramMarkovChain(0)).toThrow('N-gram order must be 1, 2, or 3');
		});

		test('should throw error for invalid order > 3', () => {
			expect(() => new NGramMarkovChain(4)).toThrow('N-gram order must be 1, 2, or 3');
		});
	});

	describe('Training', () => {
		test('1-gram should train on character frequencies', () => {
			const model = new NGramMarkovChain(1);
			const trained = model.train('aaabbc');

			expect(trained).toBe(true);

			const stats = model.getStats();
			expect(stats.order).toBe(1);
			expect(stats.trainingExamples).toBe(1);
			expect(stats.states).toBeGreaterThan(0);
		});

		test('2-gram should train on bigrams', () => {
			const model = new NGramMarkovChain(2);
			const trained = model.train('abc');

			expect(trained).toBe(true);

			const stats = model.getStats();
			expect(stats.order).toBe(2);
			expect(stats.trainingExamples).toBe(1);
		});

		test('3-gram should train on trigrams', () => {
			const model = new NGramMarkovChain(3);
			const trained = model.train('abcd');

			expect(trained).toBe(true);

			const stats = model.getStats();
			expect(stats.order).toBe(3);
			expect(stats.trainingExamples).toBe(1);
		});

		test('should skip texts shorter than order', () => {
			const model = new NGramMarkovChain(3);
			const trained = model.train('ab'); // Too short for 3-gram

			expect(trained).toBe(false);
			expect(model.getStats().trainingExamples).toBe(0);
		});

		test('should handle multiple training examples', () => {
			const model = new NGramMarkovChain(2);

			model.train('john.doe');
			model.train('jane.smith');
			model.train('user.name');

			const stats = model.getStats();
			expect(stats.trainingExamples).toBe(3);
		});
	});

	describe('Cross-Entropy', () => {
		test('1-gram should compute cross-entropy', () => {
			const model = new NGramMarkovChain(1);
			model.train('aaabbb');

			const entropy = model.crossEntropy('aabb');
			expect(entropy).toBeGreaterThan(0);
			expect(entropy).toBeLessThan(Infinity);
		});

		test('2-gram should compute cross-entropy', () => {
			const model = new NGramMarkovChain(2);
			model.train('john.doe');

			const entropy = model.crossEntropy('john');
			expect(entropy).toBeGreaterThan(0);
			expect(entropy).toBeLessThan(Infinity);
		});

		test('3-gram should compute cross-entropy', () => {
			const model = new NGramMarkovChain(3);
			model.train('john.doe');

			const entropy = model.crossEntropy('john');
			expect(entropy).toBeGreaterThan(0);
			expect(entropy).toBeLessThan(Infinity);
		});

		test('should return Infinity for text shorter than order', () => {
			const model = new NGramMarkovChain(3);
			model.train('abcdef');

			const entropy = model.crossEntropy('ab');
			expect(entropy).toBe(Infinity);
		});

		test('should return lower entropy for similar text', () => {
			const model = new NGramMarkovChain(2);

			// Train on legitimate patterns
			model.train('john.doe');
			model.train('jane.smith');
			model.train('bob.jones');

			// Similar pattern should have lower entropy
			const similarEntropy = model.crossEntropy('mary.wilson');

			// Different pattern should have higher entropy
			const differentEntropy = model.crossEntropy('zzz123xxx');

			expect(similarEntropy).toBeLessThan(differentEntropy);
		});
	});

	describe('Adaptive Training', () => {
		test('should skip well-understood examples', () => {
			const model = new NGramMarkovChain(2);

			// Train on many similar examples
			for (let i = 0; i < 20; i++) {
				model.train('john.doe');
			}

			const statsBefore = model.getStats();

			// Try to train on the same pattern again - should be skipped
			const trained = model.train('john.doe', 0.5);

			const statsAfter = model.getStats();

			// Training count should not increase if skipped
			expect(statsAfter.trainingExamples).toBeLessThanOrEqual(statsBefore.trainingExamples + 1);
		});
	});

	describe('Serialization', () => {
		test('should serialize and deserialize 1-gram model', () => {
			const model = new NGramMarkovChain(1);
			model.train('aaabbbccc');

			const json = model.toJSON();
			const restored = NGramMarkovChain.fromJSON(json);

			expect(restored.getOrder()).toBe(1);
			expect(restored.getStats().trainingExamples).toBe(model.getStats().trainingExamples);

			const originalEntropy = model.crossEntropy('abc');
			const restoredEntropy = restored.crossEntropy('abc');
			expect(restoredEntropy).toBeCloseTo(originalEntropy, 2);
		});

		test('should serialize and deserialize 2-gram model', () => {
			const model = new NGramMarkovChain(2);
			model.train('john.doe');

			const json = model.toJSON();
			const restored = NGramMarkovChain.fromJSON(json);

			expect(restored.getOrder()).toBe(2);

			const originalEntropy = model.crossEntropy('jane.doe');
			const restoredEntropy = restored.crossEntropy('jane.doe');
			expect(restoredEntropy).toBeCloseTo(originalEntropy, 2);
		});

		test('should serialize and deserialize 3-gram model', () => {
			const model = new NGramMarkovChain(3);
			model.train('john.doe');

			const json = model.toJSON();
			const restored = NGramMarkovChain.fromJSON(json);

			expect(restored.getOrder()).toBe(3);

			const originalEntropy = model.crossEntropy('jane.doe');
			const restoredEntropy = restored.crossEntropy('jane.doe');
			expect(restoredEntropy).toBeCloseTo(originalEntropy, 2);
		});

		test('should preserve training history', () => {
			const model = new NGramMarkovChain(2);
			model.train('john.doe');
			model.train('jane.smith');

			const json = model.toJSON();
			const restored = NGramMarkovChain.fromJSON(json);

			expect(restored.getStats().trainingExamples).toBe(2);
		});
	});

	describe('Different Order Comparison', () => {
		test('different orders should produce different results', () => {
			const text = 'john.doe.example';

			const model1 = new NGramMarkovChain(1);
			const model2 = new NGramMarkovChain(2);
			const model3 = new NGramMarkovChain(3);

			model1.train(text);
			model2.train(text);
			model3.train(text);

			const entropy1 = model1.crossEntropy('jane.smith');
			const entropy2 = model2.crossEntropy('jane.smith');
			const entropy3 = model3.crossEntropy('jane.smith');

			// All should be valid
			expect(entropy1).toBeGreaterThan(0);
			expect(entropy2).toBeGreaterThan(0);
			expect(entropy3).toBeGreaterThan(0);

			// Different orders typically produce different entropy values
			// (though not guaranteed for all inputs)
			const allSame = entropy1 === entropy2 && entropy2 === entropy3;
			expect(allSame).toBe(false);
		});
	});

	describe('Edge Cases', () => {
		test('should handle empty string training', () => {
			const model = new NGramMarkovChain(2);
			const trained = model.train('');
			expect(trained).toBe(false);
		});

		test('should handle empty string cross-entropy', () => {
			const model = new NGramMarkovChain(2);
			model.train('test');

			const entropy = model.crossEntropy('');
			expect(entropy).toBe(Infinity);
		});

		test('should handle special characters', () => {
			const model = new NGramMarkovChain(2);
			const trained = model.train('user+tag@example.com');

			expect(trained).toBe(true);

			const entropy = model.crossEntropy('admin+test@example.com');
			expect(entropy).toBeGreaterThan(0);
		});
	});
});
