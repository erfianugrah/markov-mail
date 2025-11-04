/**
 * Unit Tests for Heuristic Labeling
 */

import { describe, test, expect } from 'vitest';
import { applyHeuristicLabel, batchLabel, validateDatasetQuality } from '../../src/training/heuristic-labeling';
import type { ValidationRecord } from '../../src/training/types';

describe('Heuristic Labeling', () => {
	describe('applyHeuristicLabel', () => {
		test('should label as fraud when blocked with high risk', () => {
			const record: ValidationRecord = {
				email: 'user123@test.com',
				decision: 'block',
				riskScore: 0.85,
				confidence: 0.9,
				timestamp: '2025-11-02T12:00:00Z',
			};

			const result = applyHeuristicLabel(record, 0.8);

			expect(result.label).toBe('fraud');
			expect(result.confidence).toBeGreaterThanOrEqual(0.8);
			expect(result.reasons.length).toBeGreaterThan(0);
		});

		test('should label as legit when allowed with low risk', () => {
			const record: ValidationRecord = {
				email: 'john.doe@company.com',
				decision: 'allow',
				riskScore: 0.15,
				confidence: 0.95,
				timestamp: '2025-11-02T12:00:00Z',
			};

			const result = applyHeuristicLabel(record, 0.8);

			expect(result.label).toBe('legit');
			expect(result.confidence).toBeGreaterThanOrEqual(0.8);
		});

		test('should label as fraud with high Markov confidence', () => {
			const record: ValidationRecord = {
				email: 'test456@example.com',
				decision: 'warn',
				riskScore: 0.6,
				confidence: 0.7,
				markovDetected: true,
				markovConfidence: 0.9,
				timestamp: '2025-11-02T12:00:00Z',
			};

			const result = applyHeuristicLabel(record, 0.8);

			expect(result.label).toBe('fraud');
			expect(result.confidence).toBeGreaterThanOrEqual(0.8);
			expect(result.reasons.some(r => r.includes('Markov'))).toBe(true);
		});

		test('should label as ambiguous for mid-range risk', () => {
			const record: ValidationRecord = {
				email: 'maybe@test.com',
				decision: 'warn',
				riskScore: 0.5,
				confidence: 0.6,
				timestamp: '2025-11-02T12:00:00Z',
			};

			const result = applyHeuristicLabel(record, 0.8);

			expect(result.label).toBe('ambiguous');
		});

		test('should handle conflicting signals correctly', () => {
			const record: ValidationRecord = {
				email: 'conflict@test.com',
				decision: 'block', // Strong fraud signal
				riskScore: 0.75, // High risk (fraud indicator)
				confidence: 0.8,
				markovDetected: false, // Low Markov confidence (legit indicator)
				markovConfidence: 0.2,
				timestamp: '2025-11-02T12:00:00Z',
			};

			const result = applyHeuristicLabel(record, 0.8);

			// Should be ambiguous when both fraud and legit indicators present
			expect(result.label).toBe('ambiguous');
			expect(result.reasons.some(r => r.includes('Conflict') || r.includes('conflict'))).toBe(true);
		});

		test('should label as fraud with known fraud pattern', () => {
			const record: ValidationRecord = {
				email: 'user001@test.com',
				decision: 'block',
				riskScore: 0.75,
				confidence: 0.85,
				patternFamily: 'sequential',
				timestamp: '2025-11-02T12:00:00Z',
			};

			const result = applyHeuristicLabel(record, 0.8);

			expect(result.label).toBe('fraud');
			expect(result.reasons.some(r => r.includes('sequential'))).toBe(true);
		});

		test('should respect minimum confidence threshold', () => {
			const record: ValidationRecord = {
				email: 'low@test.com',
				decision: 'block',
				riskScore: 0.65, // Below 0.7 threshold
				confidence: 0.7,
				timestamp: '2025-11-02T12:00:00Z',
			};

			const result = applyHeuristicLabel(record, 0.9); // High threshold

			// Should be ambiguous because confidence doesn't meet 0.9 threshold
			expect(result.label).toBe('ambiguous');
		});
	});

	describe('batchLabel', () => {
		test('should correctly batch label multiple records', () => {
			const records: ValidationRecord[] = [
				{
					email: 'legit1@company.com',
					decision: 'allow',
					riskScore: 0.1,
					confidence: 0.95,
					timestamp: '2025-11-02T12:00:00Z',
				},
				{
					email: 'legit2@company.com',
					decision: 'allow',
					riskScore: 0.15,
					confidence: 0.9,
					timestamp: '2025-11-02T12:01:00Z',
				},
				{
					email: 'fraud1@test.com',
					decision: 'block',
					riskScore: 0.85,
					confidence: 0.9,
					timestamp: '2025-11-02T12:02:00Z',
				},
				{
					email: 'fraud2@test.com',
					decision: 'block',
					riskScore: 0.9,
					confidence: 0.95,
					timestamp: '2025-11-02T12:03:00Z',
				},
				{
					email: 'ambiguous@test.com',
					decision: 'warn',
					riskScore: 0.5,
					confidence: 0.6,
					timestamp: '2025-11-02T12:04:00Z',
				},
			];

			const result = batchLabel(records, 0.8);

			expect(result.stats.total).toBe(5);
			expect(result.stats.legit).toBe(2);
			expect(result.stats.fraud).toBe(2);
			expect(result.stats.ambiguous).toBe(1);

			expect(result.legit.length).toBe(2);
			expect(result.fraud.length).toBe(2);
			expect(result.ambiguous.length).toBe(1);
		});

		test('should return empty arrays for no data', () => {
			const result = batchLabel([], 0.8);

			expect(result.stats.total).toBe(0);
			expect(result.legit.length).toBe(0);
			expect(result.fraud.length).toBe(0);
			expect(result.ambiguous.length).toBe(0);
		});

		test('should handle all ambiguous records', () => {
			const records: ValidationRecord[] = [
				{
					email: 'ambig1@test.com',
					decision: 'warn',
					riskScore: 0.5,
					confidence: 0.6,
					timestamp: '2025-11-02T12:00:00Z',
				},
				{
					email: 'ambig2@test.com',
					decision: 'warn',
					riskScore: 0.45,
					confidence: 0.55,
					timestamp: '2025-11-02T12:01:00Z',
				},
			];

			const result = batchLabel(records, 0.8);

			expect(result.stats.total).toBe(2);
			expect(result.stats.legit).toBe(0);
			expect(result.stats.fraud).toBe(0);
			expect(result.stats.ambiguous).toBe(2);
		});
	});

	describe('validateDatasetQuality', () => {
		test('should pass validation for sufficient balanced data', () => {
			const legit: ValidationRecord[] = Array(150).fill(null).map((_, i) => ({
				email: `legit${i}@test.com`,
				decision: 'allow' as const,
				riskScore: 0.1,
				confidence: 0.9,
				timestamp: '2025-11-02T12:00:00Z',
			}));

			const fraud: ValidationRecord[] = Array(120).fill(null).map((_, i) => ({
				email: `fraud${i}@test.com`,
				decision: 'block' as const,
				riskScore: 0.9,
				confidence: 0.9,
				timestamp: '2025-11-02T12:00:00Z',
			}));

			const result = validateDatasetQuality(legit, fraud, 100);

			expect(result.valid).toBe(true);
			expect(result.issues.length).toBe(0);
		});

		test('should fail validation for insufficient legit samples', () => {
			const legit: ValidationRecord[] = Array(50).fill(null).map((_, i) => ({
				email: `legit${i}@test.com`,
				decision: 'allow' as const,
				riskScore: 0.1,
				confidence: 0.9,
				timestamp: '2025-11-02T12:00:00Z',
			}));

			const fraud: ValidationRecord[] = Array(200).fill(null).map((_, i) => ({
				email: `fraud${i}@test.com`,
				decision: 'block' as const,
				riskScore: 0.9,
				confidence: 0.9,
				timestamp: '2025-11-02T12:00:00Z',
			}));

			const result = validateDatasetQuality(legit, fraud, 100);

			expect(result.valid).toBe(false);
			expect(result.issues.some(i => i.includes('Insufficient legit'))).toBe(true);
		});

		test('should fail validation for severe class imbalance', () => {
			const legit: ValidationRecord[] = Array(1000).fill(null).map((_, i) => ({
				email: `legit${i}@test.com`,
				decision: 'allow' as const,
				riskScore: 0.1,
				confidence: 0.9,
				timestamp: '2025-11-02T12:00:00Z',
			}));

			const fraud: ValidationRecord[] = Array(50).fill(null).map((_, i) => ({
				email: `fraud${i}@test.com`,
				decision: 'block' as const,
				riskScore: 0.9,
				confidence: 0.9,
				timestamp: '2025-11-02T12:00:00Z',
			}));

			const result = validateDatasetQuality(legit, fraud, 50);

			expect(result.valid).toBe(false);
			expect(result.issues.some(i => i.includes('imbalance'))).toBe(true);
		});

		test('should fail validation for duplicate emails across classes', () => {
			const legit: ValidationRecord[] = [
				{
					email: 'duplicate@test.com',
					decision: 'allow',
					riskScore: 0.1,
					confidence: 0.9,
					timestamp: '2025-11-02T12:00:00Z',
				},
				...Array(149).fill(null).map((_, i) => ({
					email: `legit${i}@test.com`,
					decision: 'allow' as const,
					riskScore: 0.1,
					confidence: 0.9,
					timestamp: '2025-11-02T12:00:00Z',
				})),
			];

			const fraud: ValidationRecord[] = [
				{
					email: 'duplicate@test.com', // Same as in legit
					decision: 'block',
					riskScore: 0.9,
					confidence: 0.9,
					timestamp: '2025-11-02T12:01:00Z',
				},
				...Array(119).fill(null).map((_, i) => ({
					email: `fraud${i}@test.com`,
					decision: 'block' as const,
					riskScore: 0.9,
					confidence: 0.9,
					timestamp: '2025-11-02T12:00:00Z',
				})),
			];

			const result = validateDatasetQuality(legit, fraud, 100);

			expect(result.valid).toBe(false);
			expect(result.issues.some(i => i.includes('appear in both classes'))).toBe(true);
		});
	});
});
