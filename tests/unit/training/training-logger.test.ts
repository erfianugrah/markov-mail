/**
 * Tests for the training metrics logger.
 *
 * Uses a mock D1Database to verify correct SQL statements are prepared
 * and bound with the right parameters.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	logTrainingEvent,
	logTrainingStarted,
	logTrainingCompleted,
	logTrainingFailed,
	logValidationResult,
	type TrainingMetricsEntry,
} from '../../../src/services/training-logger';

// ---------------------------------------------------------------------------
// Mock D1
// ---------------------------------------------------------------------------

function createMockD1() {
	const runFn = vi.fn().mockResolvedValue({ success: true });
	const bindFn = vi.fn().mockReturnValue({ run: runFn });
	const prepareFn = vi.fn().mockReturnValue({ bind: bindFn, all: vi.fn() });

	const db = {
		prepare: prepareFn,
	} as unknown as D1Database;

	return { db, prepareFn, bindFn, runFn };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Training Logger', () => {
	let mock: ReturnType<typeof createMockD1>;

	beforeEach(() => {
		mock = createMockD1();
	});

	describe('logTrainingEvent', () => {
		it('should insert a training event with all fields', async () => {
			const entry: TrainingMetricsEntry = {
				event: 'training_completed',
				model_version: 'test-v1',
				trigger_type: 'manual',
				fraud_count: 100,
				legit_count: 400,
				total_samples: 500,
				training_duration: 5.2,
				accuracy: 0.95,
				precision_metric: 0.92,
				recall: 0.98,
				f1_score: 0.95,
				false_positive_rate: 0.03,
			};

			await logTrainingEvent(mock.db, entry);

			expect(mock.prepareFn).toHaveBeenCalledOnce();
			expect(mock.prepareFn.mock.calls[0][0]).toContain('INSERT INTO training_metrics');
			expect(mock.bindFn).toHaveBeenCalledWith(
				'training_completed',
				'test-v1',
				'manual',
				100,
				400,
				500,
				5.2,
				0.95,
				0.92,
				0.98,
				0.95,
				0.03,
				null, // anomaly_score
				null, // anomaly_type
				null, // error_message
				null, // error_type
			);
			expect(mock.runFn).toHaveBeenCalledOnce();
		});

		it('should fill missing fields with null', async () => {
			const entry: TrainingMetricsEntry = {
				event: 'training_started',
			};

			await logTrainingEvent(mock.db, entry);

			expect(mock.bindFn).toHaveBeenCalledWith(
				'training_started',
				null, // model_version
				null, // trigger_type
				null, // fraud_count
				null, // legit_count
				null, // total_samples
				null, // training_duration
				null, // accuracy
				null, // precision_metric
				null, // recall
				null, // f1_score
				null, // false_positive_rate
				null, // anomaly_score
				null, // anomaly_type
				null, // error_message
				null, // error_type
			);
		});

		it('should not throw on D1 failure', async () => {
			mock.runFn.mockRejectedValueOnce(new Error('D1 unavailable'));

			// Should not throw
			await expect(
				logTrainingEvent(mock.db, { event: 'training_started' })
			).resolves.not.toThrow();
		});
	});

	describe('logTrainingStarted', () => {
		it('should log a training_started event', async () => {
			await logTrainingStarted(mock.db, 'scheduled', 'v1.0');

			expect(mock.bindFn).toHaveBeenCalledWith(
				'training_started',
				'v1.0',
				'scheduled',
				null, null, null, null, null, null, null, null, null, null, null, null, null,
			);
		});
	});

	describe('logTrainingCompleted', () => {
		it('should log a training_completed event with stats', async () => {
			await logTrainingCompleted(mock.db, {
				modelVersion: 'v2.0',
				triggerType: 'manual',
				fraudCount: 50,
				legitCount: 200,
				totalSamples: 250,
				trainingDurationSecs: 3.5,
				accuracy: 0.96,
				precision: 0.94,
				recall: 0.97,
				f1Score: 0.955,
				fpr: 0.02,
			});

			expect(mock.bindFn).toHaveBeenCalledWith(
				'training_completed',
				'v2.0',
				'manual',
				50,
				200,
				250,
				3.5,
				0.96,
				0.94,
				0.97,
				0.955,
				0.02,
				null, null, null, null,
			);
		});
	});

	describe('logTrainingFailed', () => {
		it('should log a training_failed event with error details', async () => {
			await logTrainingFailed(mock.db, {
				triggerType: 'scheduled',
				errorMessage: 'Guardrails failed: recall below minimum',
				errorType: 'GUARDRAIL_FAILURE',
				modelVersion: 'v3.0-candidate',
			});

			expect(mock.bindFn).toHaveBeenCalledWith(
				'training_failed',
				'v3.0-candidate',
				'scheduled',
				null, null, null, null, null, null, null, null, null, null, null,
				'Guardrails failed: recall below minimum',
				'GUARDRAIL_FAILURE',
			);
		});
	});

	describe('logValidationResult', () => {
		it('should log validation_passed when passed=true', async () => {
			await logValidationResult(mock.db, {
				passed: true,
				modelVersion: 'v4.0',
				accuracy: 0.97,
				recall: 0.99,
				fpr: 0.01,
			});

			expect(mock.bindFn.mock.calls[0][0]).toBe('validation_passed');
			expect(mock.bindFn.mock.calls[0][1]).toBe('v4.0');
		});

		it('should log validation_failed when passed=false', async () => {
			await logValidationResult(mock.db, {
				passed: false,
				modelVersion: 'v4.0-bad',
				errorMessage: 'FPR too high',
			});

			expect(mock.bindFn.mock.calls[0][0]).toBe('validation_failed');
			expect(mock.bindFn.mock.calls[0][1]).toBe('v4.0-bad');
		});
	});
});
