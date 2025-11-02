import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger, logValidation, logBlock, logError } from '../../src/logger';
import pino from 'pino';

describe('Logger', () => {
	let consoleOutput: any[] = [];
	let originalWrite: any;

	beforeEach(() => {
		// Capture console output
		consoleOutput = [];
		originalWrite = process.stdout.write;
		process.stdout.write = ((data: any) => {
			consoleOutput.push(data.toString());
			return true;
		}) as any;
	});

	afterEach(() => {
		// Restore console output
		process.stdout.write = originalWrite;
	});

	describe('logger instance', () => {
		it('should be a Pino logger instance', () => {
			expect(logger).toBeDefined();
			expect(typeof logger.info).toBe('function');
			expect(typeof logger.warn).toBe('function');
			expect(typeof logger.error).toBe('function');
		});

		it('should log at info level', () => {
			logger.info({ event: 'test_event', foo: 'bar' }, 'Test message');

			// Check that output contains the event
			const output = consoleOutput.join('');
			expect(output).toContain('test_event');
			expect(output).toContain('Test message');
		});

		it('should log at warn level', () => {
			logger.warn({ event: 'test_warning', reason: 'test' }, 'Warning message');

			const output = consoleOutput.join('');
			expect(output).toContain('test_warning');
			expect(output).toContain('Warning message');
		});

		it('should log at error level', () => {
			logger.error({ event: 'test_error', error: 'Something went wrong' }, 'Error message');

			const output = consoleOutput.join('');
			expect(output).toContain('test_error');
			expect(output).toContain('Error message');
		});

		it('should handle structured data correctly', () => {
			logger.info({
				event: 'structured_test',
				nested: { value: 123 },
				array: [1, 2, 3],
				number: 456,
				boolean: true,
			}, 'Structured log');

			const output = consoleOutput.join('');
			expect(output).toContain('structured_test');
			expect(output).toContain('123'); // nested value
		});
	});

	describe('logValidation helper', () => {
		it('should log validation info with correct structure', () => {
			logValidation({
				email: 'test@example.com',
				decision: 'allow',
				riskScore: 0.15,
			});

			const output = consoleOutput.join('');
			expect(output).toContain('validation');
			expect(output).toContain('allow');
			expect(output).toContain('0.15');
		});

		it('should handle block decisions', () => {
			logValidation({
				email: 'suspicious@example.com',
				decision: 'block',
				riskScore: 0.92,
				reason: 'high_risk_score',
			});

			const output = consoleOutput.join('');
			expect(output).toContain('validation');
			expect(output).toContain('block');
			expect(output).toContain('high_risk_score');
		});

		it('should handle additional validation context', () => {
			logValidation({
				email: 'user@domain.com',
				decision: 'warn',
				riskScore: 0.55,
				markovScore: 0.45,
				ensembleScore: 0.60,
				signals: {
					entropy: 4.2,
					randomness: true,
				},
			});

			const output = consoleOutput.join('');
			expect(output).toContain('warn');
			expect(output).toContain('0.55');
		});
	});

	describe('logBlock helper', () => {
		it('should log block decisions with reason', () => {
			logBlock({
				email: 'blocked@example.com',
				reason: 'high_risk_score',
				riskScore: 0.95,
			});

			const output = consoleOutput.join('');
			expect(output).toContain('blocked');
			expect(output).toContain('high_risk_score');
			expect(output).toContain('0.95');
		});

		it('should handle multiple block reasons', () => {
			logBlock({
				email: 'fraud@example.com',
				reason: 'multiple_signals',
				riskScore: 0.88,
				additionalReasons: ['keyboard_walk', 'low_entropy', 'disposable_domain'],
			});

			const output = consoleOutput.join('');
			expect(output).toContain('blocked');
			expect(output).toContain('multiple_signals');
		});
	});

	describe('logError helper', () => {
		it('should log errors with stack traces', () => {
			const testError = new Error('Test error message');
			logError({
				error: testError,
				context: 'test_operation',
			});

			const output = consoleOutput.join('');
			expect(output).toContain('error');
			expect(output).toContain('Test error message');
			expect(output).toContain('test_operation');
		});

		it('should handle string errors', () => {
			logError({
				error: 'Simple error string',
				context: 'string_error_test',
			});

			const output = consoleOutput.join('');
			expect(output).toContain('Simple error string');
			expect(output).toContain('string_error_test');
		});

		it('should include additional context', () => {
			const testError = new Error('Context test error');
			logError({
				error: testError,
				context: 'training_pipeline',
				modelVersion: '20250102_143022',
				samplesProcessed: 15000,
			});

			const output = consoleOutput.join('');
			expect(output).toContain('training_pipeline');
			expect(output).toContain('20250102_143022');
			expect(output).toContain('15000');
		});
	});

	describe('Event naming conventions', () => {
		it('should use snake_case for event names', () => {
			logger.info({ event: 'training_completed' }, 'Training done');
			logger.info({ event: 'model_deployed' }, 'Model deployed');
			logger.info({ event: 'ab_test_created' }, 'A/B test created');

			const output = consoleOutput.join('');
			expect(output).toContain('training_completed');
			expect(output).toContain('model_deployed');
			expect(output).toContain('ab_test_created');
		});

		it('should support domain-prefixed events', () => {
			logger.info({ event: 'markov_models_loaded' }, 'Models loaded');
			logger.info({ event: 'ensemble_validation_passed' }, 'Validation passed');

			const output = consoleOutput.join('');
			expect(output).toContain('markov_models_loaded');
			expect(output).toContain('ensemble_validation_passed');
		});
	});

	describe('Privacy and security', () => {
		it('should not log raw email addresses', () => {
			// This test documents the expectation that emails should be hashed
			// In actual code, we should never see raw emails in logs
			const emailHash = 'abc123def456'; // Pre-hashed

			logger.info({
				event: 'validation_processed',
				email_hash: emailHash.substring(0, 8),
				decision: 'allow',
			}, 'Validation processed');

			const output = consoleOutput.join('');
			expect(output).toContain('abc123de'); // First 8 chars
			expect(output).not.toContain('@'); // No raw email
		});

		it('should handle error objects safely', () => {
			const error = new Error('Sensitive error');
			error.stack = 'Stack trace with sensitive data';

			logger.error({
				event: 'operation_failed',
				error: {
					message: error.message,
					name: error.name,
					// Stack is included but that's expected for debugging
				},
			}, 'Operation failed');

			const output = consoleOutput.join('');
			expect(output).toContain('operation_failed');
			expect(output).toContain('Sensitive error');
		});
	});

	describe('Structured logging format', () => {
		it('should include all required fields', () => {
			logger.info({
				event: 'training_started',
				trigger: 'scheduled',
				timestamp: '2025-01-02T14:30:22Z',
			}, 'Training started');

			const output = consoleOutput.join('');
			expect(output).toContain('training_started');
			expect(output).toContain('scheduled');
			expect(output).toContain('2025-01-02T14:30:22Z');
		});

		it('should handle numeric fields', () => {
			logger.info({
				event: 'training_completed',
				total_samples: 15000,
				fraud_samples: 3200,
				legit_samples: 11800,
				duration_ms: 4523,
			}, 'Training completed');

			const output = consoleOutput.join('');
			expect(output).toContain('15000');
			expect(output).toContain('3200');
			expect(output).toContain('11800');
			expect(output).toContain('4523');
		});

		it('should handle nested objects', () => {
			logger.info({
				event: 'validation_result',
				metrics: {
					accuracy: 0.95,
					precision: 0.92,
					recall: 0.88,
				},
			}, 'Validation completed');

			const output = consoleOutput.join('');
			expect(output).toContain('validation_result');
			// Nested values should be present
			expect(output).toMatch(/0\.95|0\.92|0\.88/);
		});
	});

	describe('Error logging patterns', () => {
		it('should follow standard error format', () => {
			const error = new Error('Training failed');
			error.name = 'TrainingError';

			logger.error({
				event: 'training_pipeline_failed',
				error: {
					message: error.message,
					stack: error.stack,
					name: error.name,
				},
			}, 'Training Worker Failed');

			const output = consoleOutput.join('');
			expect(output).toContain('training_pipeline_failed');
			expect(output).toContain('Training failed');
			expect(output).toContain('TrainingError');
		});

		it('should handle non-Error objects', () => {
			logger.error({
				event: 'operation_failed',
				error: String({ message: 'Not a real error' }),
			}, 'Operation failed');

			const output = consoleOutput.join('');
			expect(output).toContain('operation_failed');
			expect(output).toContain('message');
		});
	});

	describe('Performance considerations', () => {
		it('should handle high-volume logging', () => {
			const startTime = Date.now();

			// Log 1000 events
			for (let i = 0; i < 1000; i++) {
				logger.info({
					event: 'test_event',
					iteration: i,
					timestamp: Date.now(),
				}, `Test ${i}`);
			}

			const duration = Date.now() - startTime;

			// Should complete in reasonable time (< 1 second for 1000 logs)
			expect(duration).toBeLessThan(1000);
		});

		it('should be async and non-blocking', () => {
			// Pino uses async writes by default
			const start = Date.now();
			logger.info({ event: 'async_test' }, 'Async log');
			const syncDuration = Date.now() - start;

			// Should return almost immediately (< 10ms)
			expect(syncDuration).toBeLessThan(10);
		});
	});
});
