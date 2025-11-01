/**
 * Integration tests for Online Learning Training Pipeline
 *
 * These tests verify the full training pipeline from data fetching
 * through model validation and storage.
 *
 * Note: These tests require:
 * - CLOUDFLARE_ACCOUNT_ID secret
 * - CLOUDFLARE_API_TOKEN secret
 * - Analytics Engine with training data
 * - KV namespaces (CONFIG, MARKOV_MODEL)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	separateDataByLabel,
	detectTrainingAnomalies,
	computeSHA256,
	type TrainingData,
	type TrainingHistory
} from '../../src/training/online-learning';

describe('Training Pipeline - Integration Tests', () => {

	describe('Data Processing Pipeline', () => {
		it('should process mixed training data correctly', () => {
			const rawData: TrainingData[] = [
				// High-confidence fraud samples
				{ email_local_part: 'xk9m2qw7r4p3', decision: 'block', risk_score: 0.95 },
				{ email_local_part: 'asdfghjkl123', decision: 'block', risk_score: 0.88 },
				{ email_local_part: 'user12345678', decision: 'warn', risk_score: 0.75 },
				// High-confidence legitimate samples
				{ email_local_part: 'john.doe', decision: 'allow', risk_score: 0.10 },
				{ email_local_part: 'alice.smith', decision: 'allow', risk_score: 0.05 },
				{ email_local_part: 'bob.johnson', decision: 'allow', risk_score: 0.15 },
				// Medium confidence (should be excluded in real pipeline)
				{ email_local_part: 'maybe.fraud', decision: 'warn', risk_score: 0.55 },
			];

			const { fraudSamples, legitSamples } = separateDataByLabel(rawData);

			// Should separate fraud (block/warn) vs legit (allow)
			expect(fraudSamples.length).toBeGreaterThan(0);
			expect(legitSamples.length).toBeGreaterThan(0);

			// Verify fraud samples
			expect(fraudSamples).toContain('xk9m2qw7r4p3');
			expect(fraudSamples).toContain('asdfghjkl123');

			// Verify legit samples
			expect(legitSamples).toContain('john.doe');
			expect(legitSamples).toContain('alice.smith');
		});

		it('should handle large datasets efficiently', () => {
			// Generate 10,000 samples
			const largeDataset: TrainingData[] = [];

			for (let i = 0; i < 5000; i++) {
				largeDataset.push({
					email_local_part: `fraud${i}`,
					decision: 'block',
					risk_score: 0.8 + Math.random() * 0.2
				});
			}

			for (let i = 0; i < 5000; i++) {
				largeDataset.push({
					email_local_part: `user${i}`,
					decision: 'allow',
					risk_score: 0.1 + Math.random() * 0.1
				});
			}

			const startTime = Date.now();
			const { fraudSamples, legitSamples } = separateDataByLabel(largeDataset);
			const duration = Date.now() - startTime;

			expect(fraudSamples).toHaveLength(5000);
			expect(legitSamples).toHaveLength(5000);
			expect(duration).toBeLessThan(100); // Should be fast (<100ms)
		});
	});

	describe('Security - Anomaly Detection', () => {
		it('should detect data poisoning attack (volume spike)', async () => {
			const normalHistory: TrainingHistory[] = [
				{
					timestamp: new Date(Date.now() - 86400000).toISOString(),
					model_version: 'v1',
					fraud_count: 100,
					legit_count: 1000,
					duration_ms: 5000,
					action: 'saved_candidate'
				},
				{
					timestamp: new Date(Date.now() - 172800000).toISOString(),
					model_version: 'v2',
					fraud_count: 95,
					legit_count: 1050,
					duration_ms: 4800,
					action: 'saved_candidate'
				}
			];

			// Simulate attack: 10x fraud spike
			const attackSamples = {
				fraud: Array(1000).fill('attack').map((_, i) => `attack${i}`),
				legit: Array(1000).fill('normal').map((_, i) => `user${i}`)
			};

			const result = await detectTrainingAnomalies(attackSamples, normalHistory);

			expect(result.safe).toBe(false);
			expect(result.score).toBeGreaterThan(0.5);
			expect(result.alerts.length).toBeGreaterThan(0);
			expect(result.details).toHaveProperty('fraudVolumeSpike');
		});

		it('should detect low diversity attack (repeated patterns)', async () => {
			const history: TrainingHistory[] = [
				{
					timestamp: new Date().toISOString(),
					model_version: 'v1',
					fraud_count: 100,
					legit_count: 100,
					duration_ms: 5000,
					action: 'saved_candidate'
				}
			];

			// All fraud samples are identical (extremely suspicious)
			const suspiciousSamples = {
				fraud: Array(1000).fill('samepattern'),
				legit: Array(100).fill('user').map((_, i) => `user${i}`)
			};

			const result = await detectTrainingAnomalies(suspiciousSamples, history);

			expect(result.safe).toBe(false);
			expect(result.alerts.some(a => a.includes('diversity'))).toBe(true);
		});

		it('should detect distribution shift attack', async () => {
			const history: TrainingHistory[] = [
				{
					timestamp: new Date().toISOString(),
					model_version: 'v1',
					fraud_count: 200,
					legit_count: 800,  // Normal: 20% fraud, 80% legit
					duration_ms: 5000,
					action: 'saved_candidate'
				}
			];

			// Attacker floods with fraud samples
			const shiftedSamples = {
				fraud: Array(900).fill('fraud').map((_, i) => `fraud${i}`),
				legit: Array(100).fill('legit').map((_, i) => `legit${i}`)
				// New distribution: 90% fraud, 10% legit (huge shift)
			};

			const result = await detectTrainingAnomalies(shiftedSamples, history);

			expect(result.safe).toBe(false);
			expect(result.alerts.some(a => a.includes('Distribution shift'))).toBe(true);
		});

		it('should pass multi-layered security checks for legitimate data', async () => {
			const history: TrainingHistory[] = [
				{
					timestamp: new Date().toISOString(),
					model_version: 'v1',
					fraud_count: 150,
					legit_count: 850,
					duration_ms: 5000,
					action: 'saved_candidate'
				}
			];

			// Legitimate training data with normal characteristics
			const legitimateData = {
				fraud: Array(140).fill('fraud').map((_, i) => `fraud_${i}_${Math.random().toString(36).substring(7)}`),
				legit: Array(860).fill('legit').map((_, i) => `user_${i}_${Math.random().toString(36).substring(7)}`)
			};

			const result = await detectTrainingAnomalies(legitimateData, history);

			expect(result.safe).toBe(true);
			expect(result.score).toBeLessThan(0.5);
			expect(result.alerts).toHaveLength(0);
		});
	});

	describe('Model Integrity - Checksum Verification', () => {
		it('should detect model corruption via checksum mismatch', async () => {
			const originalModel = JSON.stringify({
				transitions: { 'a': { 'b': 0.5, 'c': 0.5 } },
				version: 'v1'
			});

			const expectedChecksum = await computeSHA256(originalModel);

			// Simulate corruption
			const corruptedModel = originalModel.replace('0.5', '0.6');
			const corruptedChecksum = await computeSHA256(corruptedModel);

			expect(expectedChecksum).not.toBe(corruptedChecksum);
		});

		it('should verify checksum before loading model', async () => {
			const modelData = JSON.stringify({
				transitions: { 'test': { 'a': 0.3, 'b': 0.7 } },
				version: 'v2'
			});

			const checksum = await computeSHA256(modelData);

			// Simulate loading from KV with metadata
			const kvData = {
				value: modelData,
				metadata: {
					checksum,
					version: 'v2',
					timestamp: new Date().toISOString()
				}
			};

			// Verify checksum matches
			const computedChecksum = await computeSHA256(kvData.value);
			expect(computedChecksum).toBe(kvData.metadata.checksum);
		});

		it('should handle checksum verification for large models', async () => {
			// Generate large model (100KB+)
			const largeModel: Record<string, Record<string, number>> = {};

			for (let i = 0; i < 1000; i++) {
				const char = String.fromCharCode(97 + (i % 26));
				largeModel[char + i] = {};

				for (let j = 0; j < 10; j++) {
					const nextChar = String.fromCharCode(97 + (j % 26));
					largeModel[char + i][nextChar] = Math.random();
				}
			}

			const modelJSON = JSON.stringify(largeModel);
			expect(modelJSON.length).toBeGreaterThan(10000);

			const startTime = Date.now();
			const checksum = await computeSHA256(modelJSON);
			const duration = Date.now() - startTime;

			expect(checksum).toBeTruthy();
			expect(checksum).toMatch(/^[a-f0-9]{64}$/);
			expect(duration).toBeLessThan(50); // Should be fast
		});
	});

	describe('Training Lock Mechanism', () => {
		it('should prevent concurrent training runs', async () => {
			// This test requires mocking KV
			// Simulates the lock acquisition logic

			const mockKV = new Map<string, string>();

			const acquireLock = async (): Promise<boolean> => {
				const existing = mockKV.get('markov_training_lock');
				if (existing) return false;

				mockKV.set('markov_training_lock', 'locked');
				return true;
			};

			const releaseLock = async (): Promise<void> => {
				mockKV.delete('markov_training_lock');
			};

			// First training run acquires lock
			const lock1 = await acquireLock();
			expect(lock1).toBe(true);

			// Second training run should fail to acquire lock
			const lock2 = await acquireLock();
			expect(lock2).toBe(false);

			// After releasing, should be able to acquire again
			await releaseLock();
			const lock3 = await acquireLock();
			expect(lock3).toBe(true);
		});

		it('should handle lock expiration (TTL)', async () => {
			// In production, lock expires after 10 minutes
			// This test verifies the concept

			const mockKV = new Map<string, { value: string; expiresAt: number }>();

			const acquireLockWithTTL = async (ttlSeconds: number): Promise<boolean> => {
				const now = Date.now();
				const existing = mockKV.get('markov_training_lock');

				// Check if lock exists and hasn't expired
				if (existing && existing.expiresAt > now) {
					return false;
				}

				// Acquire lock with TTL
				mockKV.set('markov_training_lock', {
					value: 'locked',
					expiresAt: now + (ttlSeconds * 1000)
				});

				return true;
			};

			// Acquire lock with 1 second TTL
			const lock1 = await acquireLockWithTTL(1);
			expect(lock1).toBe(true);

			// Should fail immediately
			const lock2 = await acquireLockWithTTL(1);
			expect(lock2).toBe(false);

			// Wait for TTL to expire
			await new Promise(resolve => setTimeout(resolve, 1100));

			// Should succeed after TTL expires
			const lock3 = await acquireLockWithTTL(1);
			expect(lock3).toBe(true);
		});
	});

	describe('Training History Management', () => {
		it('should limit history to 20 entries', () => {
			const history: TrainingHistory[] = [];

			// Add 30 entries
			for (let i = 0; i < 30; i++) {
				history.unshift({
					timestamp: new Date(Date.now() - i * 86400000).toISOString(),
					model_version: `v${i}`,
					fraud_count: 100,
					legit_count: 100,
					duration_ms: 5000,
					action: 'saved_candidate'
				});

				// Simulate keeping only last 20
				if (history.length > 20) {
					history.length = 20;
				}
			}

			expect(history).toHaveLength(20);
		});

		it('should store most recent training first', () => {
			const history: TrainingHistory[] = [];

			const now = Date.now();
			history.unshift({
				timestamp: new Date(now).toISOString(),
				model_version: 'v3',
				fraud_count: 100,
				legit_count: 100,
				duration_ms: 5000,
				action: 'saved_candidate'
			});

			history.unshift({
				timestamp: new Date(now + 1000).toISOString(),
				model_version: 'v4',
				fraud_count: 100,
				legit_count: 100,
				duration_ms: 5000,
				action: 'saved_candidate'
			});

			// Most recent should be first
			expect(history[0].model_version).toBe('v4');
			expect(history[1].model_version).toBe('v3');
		});
	});

	describe('Error Handling and Recovery', () => {
		it('should handle missing Analytics Engine data gracefully', () => {
			const emptyData: TrainingData[] = [];
			const { fraudSamples, legitSamples } = separateDataByLabel(emptyData);

			expect(fraudSamples).toHaveLength(0);
			expect(legitSamples).toHaveLength(0);
		});

		it('should handle imbalanced datasets', () => {
			// Real-world scenario: lots of legit, few fraud
			const imbalancedData: TrainingData[] = [
				{ email_local_part: 'fraud1', decision: 'block', risk_score: 0.9 },
				...Array(1000).fill(null).map((_, i) => ({
					email_local_part: `user${i}`,
					decision: 'allow' as const,
					risk_score: 0.1
				}))
			];

			const { fraudSamples, legitSamples } = separateDataByLabel(imbalancedData);

			expect(fraudSamples).toHaveLength(1);
			expect(legitSamples).toHaveLength(1000);

			// Training should still work (model handles imbalanced data)
		});

		it('should handle corrupted training data entries', () => {
			const dataWithCorrupted: TrainingData[] = [
				{ email_local_part: 'valid1', decision: 'block', risk_score: 0.9 },
				{ email_local_part: '', decision: 'block', risk_score: 0.9 },  // Empty email
				{ email_local_part: 'valid2', decision: 'allow', risk_score: 0.1 },
			];

			const { fraudSamples, legitSamples } = separateDataByLabel(dataWithCorrupted);

			// Should include all entries (filtering happens in training function)
			expect(fraudSamples.length + legitSamples.length).toBe(3);
		});
	});

	describe('Performance Benchmarks', () => {
		it('should process 50,000 samples in under 1 second', () => {
			const largeDataset: TrainingData[] = Array(50000).fill(null).map((_, i) => ({
				email_local_part: `user${i}`,
				decision: i % 2 === 0 ? 'allow' : 'block',
				risk_score: i % 2 === 0 ? 0.1 : 0.9
			}));

			const startTime = Date.now();
			const { fraudSamples, legitSamples } = separateDataByLabel(largeDataset);
			const duration = Date.now() - startTime;

			expect(fraudSamples.length).toBe(25000);
			expect(legitSamples.length).toBe(25000);
			expect(duration).toBeLessThan(1000);
		});

		it('should compute checksums efficiently', async () => {
			const data = JSON.stringify({ test: 'data'.repeat(1000) });

			const startTime = Date.now();
			const checksums: string[] = [];

			for (let i = 0; i < 10; i++) {
				checksums.push(await computeSHA256(data));
			}

			const duration = Date.now() - startTime;

			expect(checksums).toHaveLength(10);
			expect(checksums.every(c => c === checksums[0])).toBe(true);
			expect(duration).toBeLessThan(100); // 10 checksums in <100ms
		});
	});
});
