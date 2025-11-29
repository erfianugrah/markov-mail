/**
 * E2E API Endpoint Tests
 *
 * Tests API endpoints with various email scenarios and payloads
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { FraudAPIClient } from '../../src/test-utils/api-client';

const API_URL = process.env.WORKER_URL || 'http://localhost:8787';
const API_KEY = process.env.API_KEY; // For admin endpoints

describe('API Endpoints E2E', () => {
	let client: FraudAPIClient;

	beforeAll(() => {
		client = new FraudAPIClient({
			baseUrl: API_URL,
			apiKey: API_KEY,
		});
	});

	describe('POST /validate', () => {
		test('should validate legitimate business email', async () => {
			const result = await client.validate('person1.person2@company.com');

			console.log(`\n✅ Legitimate email: ${result.decision}`);
			console.log(`   Risk: ${result.riskScore.toFixed(2)}`);

			expect(result.valid).toBe(true);
			expect(result.decision).toBe('allow');
			expect(result.riskScore).toBeLessThan(0.5);
			expect(result.signals.formatValid).toBe(true);
			expect(result.signals.isDisposableDomain).toBe(false);
			expect(result.latency_ms).toBeGreaterThan(0);
		});

		test('should validate legitimate educational email', async () => {
			const result = await client.validate('professor@university.edu');

			console.log(`\n🎓 Educational email: ${result.decision}`);

			expect(result.decision).toBe('allow');
			expect(result.riskScore).toBeLessThan(0.3); // .edu is trusted
		});

		test('should validate legitimate government email', async () => {
			const result = await client.validate('admin@government.gov');

			console.log(`\n🏛️  Government email: ${result.decision}`);

			expect(result.decision).toBe('allow');
			expect(result.riskScore).toBeLessThan(0.3); // .gov is trusted
		});

		test('should warn on free email providers', async () => {
			const freeEmails = [
				'user123@gmail.com',
				'testuser@yahoo.com',
				'someone@outlook.com',
				'personA@hotmail.com',
			];

			for (const email of freeEmails) {
				const result = await client.validate(email);

				console.log(`\n📧 Free provider ${email}: ${result.decision}`);

				expect(result.signals.isFreeProvider).toBe(true);
				// Decision can be warn or allow depending on other signals
				expect(['warn', 'allow']).toContain(result.decision);
			}
		});

		test('should block disposable email domains', async () => {
			const disposableEmails = [
				'temp123@throwaway.email',
				'fake@tempmail.com',
				'test@guerrillamail.com',
			];

			for (const email of disposableEmails) {
				const result = await client.validate(email);

				console.log(`\n🗑️  Disposable ${email}: ${result.decision}`);

				expect(result.decision).toBe('block');
				expect(result.signals.isDisposableDomain).toBe(true);
				expect(result.riskScore).toBeGreaterThan(0.5);
			}
		});

		test('should detect sequential patterns', async () => {
			const sequentialEmails = [
				'user1@example.com',
				'user2@example.com',
				'test001@company.com',
				'test002@company.com',
			];

			for (const email of sequentialEmails) {
				const result = await client.validate(email);

				console.log(`\n🔢 Sequential ${email}: ${result.decision}`);

				expect(['warn', 'block']).toContain(result.decision);
				expect(result.signals.patternType).toBe('sequential');
			}
		});

		test('should detect dated patterns', async () => {
			const datedEmails = [
				'person1.2024@example.com',
				'user_2025@company.com',
				'test.doe.2023@business.com',
			];

			for (const email of datedEmails) {
				const result = await client.validate(email);

				console.log(`\n📅 Dated ${email}: ${result.decision}`);

				expect(['warn', 'block']).toContain(result.decision);
				expect(result.signals.patternType).toBe('dated');
			}
		});

		test('should detect plus-addressing', async () => {
			const plusEmails = [
				'user+1@gmail.com',
				'test+tag@yahoo.com',
				'name+spam@example.com',
			];

			for (const email of plusEmails) {
				const result = await client.validate(email);

				console.log(`\n➕ Plus-addressing ${email}: ${result.decision}`);

				expect(result.signals.hasPlusAddressing).toBe(true);
				// Plus-addressing increases risk but may not block alone
				expect(result.riskScore).toBeGreaterThan(0.2);
			}
		});

		test('should detect keyboard walks', async () => {
			const keyboardWalkEmails = [
				'qwerty@example.com',
				'asdfgh@test.com',
				'123456@example.com',
				'zxcvbn@company.com',
			];

			for (const email of keyboardWalkEmails) {
				const result = await client.validate(email);

				console.log(`\n⌨️  Keyboard walk ${email}: ${result.decision}`);

				expect(['warn', 'block']).toContain(result.decision);
				expect(result.signals.hasKeyboardWalk).toBe(true);
			}
		});

		test('should detect gibberish patterns', async () => {
			const gibberishEmails = [
				'xk9m2qw7r4p3@example.com',
				'zxkj3mq9wr@test.com',
				'qmwk9xz3r7@company.com',
			];

			for (const email of gibberishEmails) {
				const result = await client.validate(email);

				console.log(`\n🗑️  Gibberish ${email}: ${result.decision}`);

				expect(result.decision).toBe('block');
				expect(result.signals.isGibberish).toBe(true);
			}
		});

		test('should flag high-risk TLDs', async () => {
			const highRiskTLDs = [
				'user@example.tk',
				'test@service.ml',
				'spam@fake.ga',
				'temp@site.cf',
			];

			for (const email of highRiskTLDs) {
				const result = await client.validate(email);

				console.log(`\n⚠️  High-risk TLD ${email}: ${result.decision}`);

				expect(['warn', 'block']).toContain(result.decision);
				expect(result.riskScore).toBeGreaterThan(0.4);
			}
		});

		test('should block invalid email formats', async () => {
			const invalidEmails = [
				'notanemail',
				'@nodomain.com',
				'user@',
				'@example.com',
			];

			for (const email of invalidEmails) {
				const result = await client.validate(email);

				console.log(`\n❌ Invalid ${email}: ${result.decision}`);

				expect(result.decision).toBe('block');
				expect(result.signals.formatValid).toBe(false);
			}
		});

		test('should block very short email addresses', async () => {
			const shortEmails = ['a@example.com', 'ab@test.com', 'x@y.com'];

			for (const email of shortEmails) {
				const result = await client.validate(email);

				console.log(`\n📏 Short email ${email}: ${result.decision}`);

				expect(result.decision).toBe('block');
			}
		});

		test('should include proper response structure', async () => {
			const result = await client.validate('test@example.com');

			// Verify response structure
			expect(result).toHaveProperty('valid');
			expect(result).toHaveProperty('riskScore');
			expect(result).toHaveProperty('decision');
			expect(result).toHaveProperty('message');
			expect(result).toHaveProperty('signals');
			expect(result).toHaveProperty('fingerprint');
			expect(result).toHaveProperty('latency_ms');

			// Signals structure
			expect(result.signals).toHaveProperty('formatValid');
			expect(result.signals).toHaveProperty('entropyScore');
			expect(result.signals).toHaveProperty('isDisposableDomain');
			expect(result.signals).toHaveProperty('isFreeProvider');

			// Fingerprint structure
			expect(result.fingerprint).toHaveProperty('hash');
			expect(result.fingerprint.hash).toBeTruthy();

			// Value types
			expect(typeof result.valid).toBe('boolean');
			expect(typeof result.riskScore).toBe('number');
			expect(typeof result.decision).toBe('string');
			expect(typeof result.latency_ms).toBe('number');
		});

		test('should handle concurrent requests', async () => {
			const emails = [
				'test1@example.com',
				'test2@example.com',
				'test3@example.com',
				'test4@example.com',
				'test5@example.com',
			];

			const startTime = Date.now();
			const results = await client.parallelValidate(emails);
			const duration = Date.now() - startTime;

			console.log(`\n⚡ Concurrent requests: ${duration}ms for ${emails.length} emails`);

			expect(results).toHaveLength(emails.length);
			results.forEach((result) => {
				expect(result.success).toBe(true);
			});

			// Parallel should be faster than sequential
			expect(duration).toBeLessThan(emails.length * 200); // Less than 200ms per email
		});
	});

	describe('GET /admin/health', () => {
		test('should return health status', async () => {
			const health = await client.healthCheck();

			console.log(`\n💚 Health check: ${health.status}`);

			expect(health).toHaveProperty('status');
			expect(health).toHaveProperty('timestamp');
			expect(health.status).toBe('ok');
		});
	});

	describe('GET /admin/analytics', () => {
		test.skipIf(!API_KEY)('should query analytics data', async () => {
			const analytics = await client.getAnalytics('SELECT COUNT(*) as count FROM fraud_detection', 24);

			console.log(`\n📊 Analytics query result:`, analytics);

			expect(analytics).toBeDefined();
			// Analytics should return query results
			expect(analytics).toHaveProperty('data');
		});

		test.skipIf(!API_KEY)('should handle custom time ranges', async () => {
			// Query last hour
			const analytics = await client.getAnalytics('SELECT COUNT(*) as count FROM fraud_detection', 1);

			console.log(`\n📊 Analytics (1 hour):`, analytics);

			expect(analytics).toBeDefined();
		});

		test('should require API key for analytics', async () => {
			const clientNoKey = new FraudAPIClient({ baseUrl: API_URL });

			await expect(
				clientNoKey.getAnalytics('SELECT * FROM fraud_detection', 24)
			).rejects.toThrow(/API key required/);
		});
	});

	describe('Error Handling', () => {
		test('should handle network errors gracefully', async () => {
			const badClient = new FraudAPIClient({
				baseUrl: 'http://localhost:9999', // Non-existent port
				timeout: 1000,
			});

			await expect(badClient.validate('test@example.com')).rejects.toThrow();
		});

		test('should timeout on slow responses', async () => {
			const slowClient = new FraudAPIClient({
				baseUrl: API_URL,
				timeout: 1, // 1ms timeout - will always fail
			});

			await expect(slowClient.validate('test@example.com')).rejects.toThrow(/timeout/i);
		}, 10000);
	});

	describe('Rate Limiting', () => {
		test('should handle rapid sequential requests', async () => {
			const emails = Array.from({ length: 20 }, (_, i) => `test${i}@example.com`);

			const results = await client.batchValidate(emails, { delayMs: 0 });

			console.log(`\n🚀 Rapid requests: ${results.length} completed`);

			// All should succeed (no rate limiting on test server)
			const successful = results.filter((r) => r.success).length;
			expect(successful).toBe(emails.length);
		}, 15000);
	});

	describe('Response Times', () => {
		test('should respond within acceptable latency', async () => {
			const testEmails = [
				'legitimate@company.com',
				'user1@example.com', // Pattern detection
				'spam@tempmail.com', // Disposable
			];

			for (const email of testEmails) {
				const result = await client.validate(email);

				console.log(`\n⏱️  ${email}: ${result.latency_ms}ms`);

				// Should be fast (<100ms for most cases)
				expect(result.latency_ms).toBeLessThan(200);
			}
		});
	});
});
