/**
 * Unit tests for Online Learning helper functions
 */

import { describe, it, expect } from 'vitest';
import {
	separateDataByLabel,
	detectTrainingAnomalies,
	computeSHA256,
	generateVersionId,
	type TrainingData,
	type TrainingHistory
} from '../../../src/training/online-learning';

describe('Online Learning - Unit Tests', () => {

	describe('separateDataByLabel', () => {
		it('should separate fraud and legitimate samples correctly', () => {
			const data: TrainingData[] = [
				{ email_local_part: 'fraud1', decision: 'block', risk_score: 0.9 },
				{ email_local_part: 'fraud2', decision: 'warn', risk_score: 0.8 },
				{ email_local_part: 'legit1', decision: 'allow', risk_score: 0.1 },
				{ email_local_part: 'legit2', decision: 'allow', risk_score: 0.05 },
			];

			const { fraudSamples, legitSamples } = separateDataByLabel(data);

			expect(fraudSamples).toHaveLength(2);
			expect(legitSamples).toHaveLength(2);
			expect(fraudSamples).toContain('fraud1');
			expect(fraudSamples).toContain('fraud2');
			expect(legitSamples).toContain('legit1');
			expect(legitSamples).toContain('legit2');
		});

		it('should handle empty data', () => {
			const { fraudSamples, legitSamples } = separateDataByLabel([]);

			expect(fraudSamples).toHaveLength(0);
			expect(legitSamples).toHaveLength(0);
		});

		it('should handle only fraud samples', () => {
			const data: TrainingData[] = [
				{ email_local_part: 'fraud1', decision: 'block', risk_score: 0.9 },
				{ email_local_part: 'fraud2', decision: 'block', risk_score: 0.85 },
			];

			const { fraudSamples, legitSamples } = separateDataByLabel(data);

			expect(fraudSamples).toHaveLength(2);
			expect(legitSamples).toHaveLength(0);
		});

		it('should handle only legitimate samples', () => {
			const data: TrainingData[] = [
				{ email_local_part: 'legit1', decision: 'allow', risk_score: 0.1 },
				{ email_local_part: 'legit2', decision: 'allow', risk_score: 0.15 },
			];

			const { fraudSamples, legitSamples } = separateDataByLabel(data);

			expect(fraudSamples).toHaveLength(0);
			expect(legitSamples).toHaveLength(2);
		});

		it('should handle duplicate email local parts', () => {
			const data: TrainingData[] = [
				{ email_local_part: 'test', decision: 'block', risk_score: 0.9 },
				{ email_local_part: 'test', decision: 'block', risk_score: 0.85 },
			];

			const { fraudSamples, legitSamples } = separateDataByLabel(data);

			// Should include duplicates (they're separate validation events)
			expect(fraudSamples).toHaveLength(2);
			expect(legitSamples).toHaveLength(0);
		});
	});

	describe('detectTrainingAnomalies', () => {
		it('should pass normal training data', async () => {
			const newSamples = {
				fraud: ['user1', 'user2', 'user3', 'user4', 'user5'],
				legit: ['john', 'jane', 'alice', 'bob', 'charlie', 'david', 'eve', 'frank', 'grace', 'henry']
			};

			const history: TrainingHistory[] = [
				{
					timestamp: new Date().toISOString(),
					model_version: 'v1',
					fraud_count: 5,
					legit_count: 10,
					duration_ms: 1000,
					action: 'saved_candidate'
				}
			];

			const result = await detectTrainingAnomalies(newSamples, history);

			expect(result.safe).toBe(true);
			expect(result.score).toBeLessThan(0.5);
			// May have minor alerts but should still be safe
			expect(result.alerts.length).toBeLessThanOrEqual(1);
		});

		it('should detect fraud sample volume spike', async () => {
			const newSamples = {
				fraud: Array(500).fill('fraud').map((_, i) => `fraud${i}`),
				legit: Array(100).fill('legit').map((_, i) => `legit${i}`)
			};

			const history: TrainingHistory[] = [
				{
					timestamp: new Date().toISOString(),
					model_version: 'v1',
					fraud_count: 100,  // Normal: 100 fraud samples
					legit_count: 100,
					duration_ms: 1000,
					action: 'saved_candidate'
				}
			];

			const result = await detectTrainingAnomalies(newSamples, history);

			// 500 fraud samples vs average of 100 = 5x spike (> 3.0 threshold)
			expect(result.safe).toBe(false);
			expect(result.score).toBeGreaterThanOrEqual(0.5);
			expect(result.alerts.length).toBeGreaterThan(0);
			expect(result.alerts.some(a => a.includes('Fraud sample spike'))).toBe(true);
		});

		it('should detect low pattern diversity', async () => {
			// Create samples with very low diversity (same pattern repeated)
			const newSamples = {
				fraud: Array(100).fill('samepattern'),
				legit: ['john', 'jane']
			};

			const history: TrainingHistory[] = [
				{
					timestamp: new Date().toISOString(),
					model_version: 'v1',
					fraud_count: 100,
					legit_count: 100,
					duration_ms: 1000,
					action: 'saved_candidate'
				}
			];

			const result = await detectTrainingAnomalies(newSamples, history);

			expect(result.safe).toBe(false);
			expect(result.alerts.some(a => a.includes('diversity'))).toBe(true);
		});

		it('should detect distribution shift', async () => {
			const newSamples = {
				fraud: Array(90).fill('fraud').map((_, i) => `fraud${i}`),
				legit: Array(10).fill('legit').map((_, i) => `legit${i}`)
			};

			const history: TrainingHistory[] = [
				{
					timestamp: new Date().toISOString(),
					model_version: 'v1',
					fraud_count: 30,
					legit_count: 70,  // Normal: 30% fraud, 70% legit
					duration_ms: 1000,
					action: 'saved_candidate'
				}
			];

			const result = await detectTrainingAnomalies(newSamples, history);

			// New data: 90% fraud, 10% legit (huge shift)
			expect(result.safe).toBe(false);
			expect(result.alerts.some(a => a.includes('Distribution shift'))).toBe(true);
		});

		it('should handle empty history gracefully', async () => {
			const newSamples = {
				fraud: ['user1', 'user2'],
				legit: ['john', 'jane']
			};

			const result = await detectTrainingAnomalies(newSamples, []);

			// Should pass when no history (first training run)
			expect(result.safe).toBe(true);
		});
	});

	describe('computeSHA256', () => {
		it('should compute consistent hashes', async () => {
			const data = 'test data';
			const hash1 = await computeSHA256(data);
			const hash2 = await computeSHA256(data);

			expect(hash1).toBe(hash2);
		});

		it('should produce different hashes for different data', async () => {
			const hash1 = await computeSHA256('data1');
			const hash2 = await computeSHA256('data2');

			expect(hash1).not.toBe(hash2);
		});

		it('should produce 64-character hex string', async () => {
			const hash = await computeSHA256('test');

			expect(hash).toMatch(/^[a-f0-9]{64}$/);
		});

		it('should handle empty string', async () => {
			const hash = await computeSHA256('');

			expect(hash).toBeTruthy();
			expect(hash).toMatch(/^[a-f0-9]{64}$/);
		});

		it('should handle unicode characters', async () => {
			const hash = await computeSHA256('Hello 世界 🌍');

			expect(hash).toBeTruthy();
			expect(hash).toMatch(/^[a-f0-9]{64}$/);
		});

		it('should match known SHA-256 hash', async () => {
			// SHA-256 of "hello" = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
			const hash = await computeSHA256('hello');

			expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
		});
	});

	describe('generateVersionId', () => {
		it('should generate version ID with correct format', () => {
			const versionId = generateVersionId();

			expect(versionId).toMatch(/^v\d+_\d+$/);
		});

		it('should generate unique version IDs', () => {
			const ids = new Set<string>();

			for (let i = 0; i < 100; i++) {
				ids.add(generateVersionId());
			}

			// Should have at least 90% unique IDs (accounting for random collisions)
			expect(ids.size).toBeGreaterThan(90);
		});

		it('should include timestamp in version ID', () => {
			const beforeTimestamp = Date.now();
			const versionId = generateVersionId();
			const afterTimestamp = Date.now();

			// Extract timestamp from version ID
			const match = versionId.match(/^v(\d+)_\d+$/);
			expect(match).toBeTruthy();

			if (match) {
				const timestamp = parseInt(match[1], 10);
				expect(timestamp).toBeGreaterThanOrEqual(beforeTimestamp);
				expect(timestamp).toBeLessThanOrEqual(afterTimestamp);
			}
		});

		it('should generate version IDs in increasing order', () => {
			const id1 = generateVersionId();

			// Wait 1ms to ensure different timestamp
			const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
			return wait(2).then(() => {
				const id2 = generateVersionId();

				// Extract timestamps
				const timestamp1 = parseInt(id1.match(/^v(\d+)_\d+$/)?.[1] || '0', 10);
				const timestamp2 = parseInt(id2.match(/^v(\d+)_\d+$/)?.[1] || '0', 10);

				expect(timestamp2).toBeGreaterThanOrEqual(timestamp1);
			});
		});
	});
});
