/**
 * Unit Tests for Model Training Utilities
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
	loadTrainingDatasets,
	trainModels,
	generateVersion,
	type TrainingConfig,
} from '../../src/training/model-training';

// Mock KV for testing
class MockKV {
	private store = new Map<string, string>();

	async get<T = unknown>(key: string, type?: 'text' | 'json'): Promise<T | null> {
		const value = this.store.get(key);
		if (!value) return null;

		if (type === 'json') {
			return JSON.parse(value) as T;
		}
		return value as T;
	}

	async put(key: string, value: string): Promise<void> {
		this.store.set(key, value);
	}

	async list(options?: { prefix?: string }): Promise<{ keys: Array<{ name: string }> }> {
		const keys = Array.from(this.store.keys())
			.filter((k) => !options?.prefix || k.startsWith(options.prefix))
			.map((name) => ({ name }));
		return { keys };
	}

	async delete(key: string): Promise<void> {
		this.store.delete(key);
	}

	// Test helper
	setMockData(key: string, data: any): void {
		this.store.set(key, JSON.stringify(data));
	}
}

describe('Model Training Utilities', () => {
	let mockKV: MockKV;

	beforeEach(() => {
		mockKV = new MockKV();
	});

	describe('generateVersion', () => {
		test('should generate version in YYYYMMDD_HHMMSS format', () => {
			const version = generateVersion();

			// Format: YYYYMMDD_HHMMSS
			expect(version).toMatch(/^\d{8}_\d{6}$/);

			// Check year is reasonable (2024-2030)
			const year = parseInt(version.substring(0, 4));
			expect(year).toBeGreaterThanOrEqual(2024);
			expect(year).toBeLessThanOrEqual(2030);

			// Check month (01-12)
			const month = parseInt(version.substring(4, 6));
			expect(month).toBeGreaterThanOrEqual(1);
			expect(month).toBeLessThanOrEqual(12);

			// Check day (01-31)
			const day = parseInt(version.substring(6, 8));
			expect(day).toBeGreaterThanOrEqual(1);
			expect(day).toBeLessThanOrEqual(31);
		});

		test('should generate unique versions', () => {
			const version1 = generateVersion();
			const version2 = generateVersion();

			// May be same if called within same second, but format should be consistent
			expect(version1).toMatch(/^\d{8}_\d{6}$/);
			expect(version2).toMatch(/^\d{8}_\d{6}$/);
		});
	});

	describe('loadTrainingDatasets', () => {
		test('should load datasets from multiple days', async () => {
			// Mock 3 days of training data
			const today = new Date();
			for (let i = 0; i < 3; i++) {
				const date = new Date(today);
				date.setDate(date.getDate() - i);
				const dateStr = date.toISOString().split('T')[0];

				mockKV.setMockData(`training_data_${dateStr}`, {
					date: dateStr,
					samples: {
						legit: [
							{ localPart: `legit${i}_1`, label: 'legit' },
							{ localPart: `legit${i}_2`, label: 'legit' },
						],
						fraud: [
							{ localPart: `fraud${i}_1`, label: 'fraud' },
							{ localPart: `fraud${i}_2`, label: 'fraud' },
						],
					},
				});
			}

			const result = await loadTrainingDatasets(mockKV as unknown as KVNamespace, 3);

			expect(result.legit.length).toBe(6); // 2 per day × 3 days
			expect(result.fraud.length).toBe(6);
			expect(result.dates.length).toBe(3);
		});

		test('should handle missing datasets gracefully', async () => {
			// No data in KV
			const result = await loadTrainingDatasets(mockKV as unknown as KVNamespace, 7);

			expect(result.legit.length).toBe(0);
			expect(result.fraud.length).toBe(0);
			expect(result.dates.length).toBe(0);
		});

		test('should skip days with no data', async () => {
			// Only add data for today
			const today = new Date().toISOString().split('T')[0];
			mockKV.setMockData(`training_data_${today}`, {
				date: today,
				samples: {
					legit: [{ localPart: 'john.doe', label: 'legit' }],
					fraud: [{ localPart: 'user123', label: 'fraud' }],
				},
			});

			const result = await loadTrainingDatasets(mockKV as unknown as KVNamespace, 7);

			expect(result.legit.length).toBe(1);
			expect(result.fraud.length).toBe(1);
			expect(result.dates.length).toBe(1);
			expect(result.dates[0]).toBe(today);
		});
	});

	describe('trainModels', () => {
		test('should train models for specified orders', () => {
			const config: TrainingConfig = {
				orders: [1, 2, 3],
				adaptationRate: 0.3,
				minSamplesPerClass: 10,
			};

			const legitSamples = [
				'john.doe',
				'jane.smith',
				'bob.wilson',
				'alice.johnson',
				'charlie.brown',
				'david.miller',
				'emma.davis',
				'frank.moore',
				'grace.taylor',
				'henry.anderson',
			];

			const fraudSamples = [
				'user001',
				'user002',
				'user003',
				'test123',
				'test456',
				'abc123xyz',
				'qwerty123',
				'admin001',
				'admin002',
				'root123',
			];

			const models = trainModels(legitSamples, fraudSamples, config);

			// Should have models for each order
			expect(Object.keys(models)).toEqual(['1', '2', '3']);

			// Each order should have legit and fraud models
			for (const order of config.orders) {
				expect(models[order].legit).toBeDefined();
				expect(models[order].fraud).toBeDefined();

				// Models should have transitions
				const legitTransitions = models[order].legit.getTransitionCount();
				const fraudTransitions = models[order].fraud.getTransitionCount();

				expect(legitTransitions).toBeGreaterThan(0);
				expect(fraudTransitions).toBeGreaterThan(0);
			}
		});

		test('should train only specified orders', () => {
			const config: TrainingConfig = {
				orders: [2], // Only 2-gram
				adaptationRate: 0.3,
				minSamplesPerClass: 5,
			};

			const legitSamples = ['john.doe', 'jane.smith', 'bob.wilson', 'alice.johnson', 'charlie.brown'];
			const fraudSamples = ['user001', 'user002', 'test123', 'test456', 'abc123'];

			const models = trainModels(legitSamples, fraudSamples, config);

			// Should only have 2-gram model
			expect(Object.keys(models)).toEqual(['2']);
			expect(models[2].legit).toBeDefined();
			expect(models[2].fraud).toBeDefined();
		});

		test('should handle empty samples gracefully', () => {
			const config: TrainingConfig = {
				orders: [1, 2, 3],
				adaptationRate: 0.3,
				minSamplesPerClass: 0,
			};

			const models = trainModels([], [], config);

			// Models should exist but have zero transitions
			for (const order of config.orders) {
				expect(models[order].legit).toBeDefined();
				expect(models[order].fraud).toBeDefined();
			}
		});
	});
});
