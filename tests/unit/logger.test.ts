import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { logger, logValidation, logBlock, logError } from '../../src/logger';

describe('Logger', () => {
	let infoSpy: MockInstance;
	let warnSpy: MockInstance;
	let errorSpy: MockInstance;
	let logOutput: any[];

	const captureCall = (level: 'info' | 'warn' | 'error') => {
		return (...args: any[]) => {
			let metadata: Record<string, any> = {};
			let message: string | undefined;
			if (typeof args[0] === 'object' && args[0] !== null) {
				metadata = args[0];
				message = args[1];
			} else {
				message = args[0];
			}

			logOutput.push({
				level,
				msg: message,
				...metadata,
			});
			return logger;
		};
	};

	const getConsoleOutput = () => logOutput;

	beforeEach(() => {
		logOutput = [];
		infoSpy = vi.spyOn(logger, 'info').mockImplementation(captureCall('info'));
		warnSpy = vi.spyOn(logger, 'warn').mockImplementation(captureCall('warn'));
		errorSpy = vi.spyOn(logger, 'error').mockImplementation(captureCall('error'));
	});

	afterEach(() => {
		infoSpy.mockRestore();
		warnSpy.mockRestore();
		errorSpy.mockRestore();
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
			const output = getConsoleOutput()[0];
			expect(output.event).toBe('test_event');
			expect(output.msg).toBe('Test message');
			expect(output.foo).toBe('bar');
		});

		it('should log at warn level', () => {
			logger.warn({ event: 'test_warning', reason: 'test' }, 'Warning message');
			const output = getConsoleOutput()[0];
			expect(output.event).toBe('test_warning');
			expect(output.msg).toBe('Warning message');
			expect(output.reason).toBe('test');
		});

		it('should log at error level', () => {
			logger.error({ event: 'test_error', error: 'Something went wrong' }, 'Error message');
			const output = getConsoleOutput()[0];
			expect(output.event).toBe('test_error');
			expect(output.msg).toBe('Error message');
			expect(output.error).toBe('Something went wrong');
		});

		it('should handle structured data correctly', () => {
			logger.info({
				event: 'structured_test',
				nested: { value: 123 },
				array: [1, 2, 3],
			}, 'Structured log');
			const output = getConsoleOutput()[0];
			expect(output.event).toBe('structured_test');
			expect(output.nested.value).toBe(123);
		});
	});

	describe('logValidation helper', () => {
		it('should log validation info with correct structure', async () => {
			await logValidation({
				email: 'test@example.com',
				fingerprint: 'test-fingerprint',
				decision: 'allow',
				riskScore: 0.15,
				signals: {},
			});
			const output = getConsoleOutput()[0];
			expect(output.event).toBe('email_validation');
			expect(output.decision).toBe('allow');
			expect(output.risk_score).toBe(0.15);
		});
	});

	describe('logBlock helper', () => {
		it('should log block decisions with reason', async () => {
			await logBlock({
				email: 'blocked@example.com',
				fingerprint: 'test-fingerprint',
				reason: 'high_risk_score',
				riskScore: 0.95,
				signals: {},
			});
			const output = getConsoleOutput()[0];
			expect(output.event).toBe('email_blocked');
			expect(output.reason).toBe('high_risk_score');
			expect(output.risk_score).toBe(0.95);
		});
	});

	describe('logError helper', () => {
		it('should log errors with stack traces', () => {
			const testError = new Error('Test error message');
			logError(testError, 'test_operation');
			const output = getConsoleOutput()[0];
			expect(output.event).toBe('error');
			expect(output.error.message).toBe('Test error message');
			expect(output.context).toBe('test_operation');
		});
	});

	describe('Performance considerations', () => {
		it('should handle high-volume logging', () => {
			for (let i = 0; i < 1000; i++) {
				logger.info({ event: 'test_event', iteration: i });
			}
			const output = getConsoleOutput();
			expect(output.length).toBe(1000);
			expect(output[999].iteration).toBe(999);
		});
	});
});
