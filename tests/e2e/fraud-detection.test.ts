/**
 * E2E Fraud Detection Tests
 *
 * Tests pattern detection against live API with generated fraudulent emails
 * Migrated from scripts/test-fraudulent-emails.js
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { EmailGenerator, type PatternType } from '../../src/test-utils/email-generator';
import { FraudAPIClient, analyzeBatchResults } from '../../src/test-utils/api-client';

const API_URL = process.env.WORKER_URL || 'http://localhost:8787';
const TEST_EMAIL_COUNT = 100; // Reduced for faster CI/CD
const MIN_DETECTION_RATE = 80; // 80% minimum detection rate

describe('Fraud Pattern Detection E2E', () => {
	let client: FraudAPIClient;
	let generator: EmailGenerator;

	beforeAll(() => {
		client = new FraudAPIClient({ baseUrl: API_URL });
		generator = new EmailGenerator();
	});

	test('should detect fraudulent email patterns above threshold', async () => {
		console.log(`\n🧪 Testing ${TEST_EMAIL_COUNT} fraudulent emails against ${API_URL}`);

		// Generate fraudulent emails across all patterns
		const generatedEmails = generator.generate({
			count: TEST_EMAIL_COUNT,
		});

		console.log(`📧 Generated ${generatedEmails.length} emails`);

		// Validate all emails
		const results = await client.batchValidate(
			generatedEmails.map((e) => e.email),
			{
				delayMs: 10, // Small delay to avoid overwhelming local server
				onProgress: (completed, total) => {
					if (completed % 10 === 0) {
						console.log(`  Progress: ${completed}/${total}`);
					}
				},
			}
		);

		// Analyze results
		const analysis = analyzeBatchResults(results);
		const detectionRate = analysis.detectionRate * 100;

		console.log(`\n📊 Results:`);
		console.log(`  Total: ${analysis.total}`);
		console.log(`  Successful: ${analysis.successful}`);
		console.log(`  Decisions: Allow=${analysis.decisions.allow}, Warn=${analysis.decisions.warn}, Block=${analysis.decisions.block}`);
		console.log(`  Detection Rate: ${detectionRate.toFixed(1)}% (warn + block)`);
		console.log(`  Avg Risk Score: ${analysis.averageRiskScore.toFixed(3)}`);
		console.log(`  Avg Latency: ${analysis.averageLatency.toFixed(1)}ms`);

		// Assertions
		expect(analysis.successful).toBe(analysis.total);
		expect(detectionRate).toBeGreaterThanOrEqual(MIN_DETECTION_RATE);
		expect(analysis.averageRiskScore).toBeGreaterThan(0.3); // Should be flagging as risky
		expect(analysis.averageLatency).toBeLessThan(200); // Should be fast
	}, 60000); // 60s timeout

	test.each<PatternType>([
		'sequential',
		'sequential_padded',
		'dated',
		'gibberish',
		'keyboard_walk',
		'plus_addressing',
		'name_sequential',
		'random_suffix',
		'underscore_sequential',
		'simple',
		'dictionary_numbers',
	])('should detect %s pattern', async (pattern) => {
		console.log(`\n🔍 Testing pattern: ${pattern}`);

		// Generate emails for specific pattern
		const generatedEmails = generator.generate({
			count: 10,
			patterns: [pattern],
		});

		// Validate
		const results = await client.batchValidate(
			generatedEmails.map((e) => e.email),
			{ delayMs: 10 }
		);

		const analysis = analyzeBatchResults(results);
		const detectionRate = analysis.detectionRate * 100;

		console.log(`  Detection Rate: ${detectionRate.toFixed(1)}%`);

		// All patterns should have reasonable detection
		// Some patterns are harder to detect, so we use lower thresholds for specific ones
		const minRate = ['simple', 'random_suffix', 'dictionary_numbers'].includes(pattern) ? 40 : 70;

		expect(analysis.successful).toBe(analysis.total);
		expect(detectionRate).toBeGreaterThanOrEqual(minRate);
	}, 30000);

	test('should provide detailed signals for detected patterns', async () => {
		// Test specific high-risk patterns
		const testCases = [
			{ email: 'user1@example.com', expectedPattern: 'sequential' },
			{ email: 'test001@company.com', expectedPattern: 'sequential' },
			{ email: 'john.doe.2024@example.com', expectedPattern: 'dated' },
			{ email: 'qwerty123@test.com', expectedSignal: 'hasKeyboardWalk' },
			{ email: 'user+spam@gmail.com', expectedSignal: 'hasPlusAddressing' },
		];

		for (const testCase of testCases) {
			const result = await client.validate(testCase.email);

			console.log(`\n📧 ${testCase.email}`);
			console.log(`  Decision: ${result.decision}`);
			console.log(`  Risk: ${result.riskScore.toFixed(2)}`);
			console.log(`  Signals: ${JSON.stringify(result.signals)}`);

			// Should be flagged
			expect(['warn', 'block']).toContain(result.decision);
			expect(result.riskScore).toBeGreaterThan(0.3);

			// Check expected detection
			if ('expectedPattern' in testCase) {
				expect(result.signals.patternType).toBe(testCase.expectedPattern);
			}
			if ('expectedSignal' in testCase && testCase.expectedSignal) {
				expect((result.signals as any)[testCase.expectedSignal]).toBe(true);
			}
		}
	});

	test('should correctly identify legitimate emails', async () => {
		const legitimateEmails = [
			'john.smith@company.com',
			'sarah.jones@enterprise.org',
			'mike.williams@business.net',
			'professor@university.edu',
			'admin@government.gov',
		];

		const results = await client.batchValidate(legitimateEmails);
		const analysis = analyzeBatchResults(results);

		console.log(`\n✅ Legitimate email results:`);
		console.log(`  Allow: ${analysis.decisions.allow}`);
		console.log(`  Warn: ${analysis.decisions.warn}`);
		console.log(`  Block: ${analysis.decisions.block}`);

		// Most should be allowed (though some free providers might warn)
		expect(analysis.decisions.allow).toBeGreaterThan(0);
		expect(analysis.decisions.block).toBe(0); // Should not block legitimate emails
	});

	test('should handle invalid email formats', async () => {
		const invalidEmails = [
			'notanemail',
			'@nodomain.com',
			'user@',
			'@',
			'',
		];

		for (const email of invalidEmails) {
			const result = await client.validate(email);

			console.log(`\n❌ ${email || '(empty)'}: ${result.decision}`);

			// Invalid formats should be blocked
			expect(result.decision).toBe('block');
			expect(result.signals.formatValid).toBe(false);
		}
	});

	test('should detect disposable domains', async () => {
		const disposableEmails = [
			'test@tempmail.com',
			'fake@throwaway.email',
			'spam@guerrillamail.com',
		];

		const results = await client.batchValidate(disposableEmails);

		for (let i = 0; i < results.length; i++) {
			const result = results[i];
			if (result.success && result.result) {
				console.log(`\n🗑️  ${disposableEmails[i]}: ${result.result.decision}`);

				expect(result.result.decision).toBe('block');
				expect(result.result.signals.isDisposableDomain).toBe(true);
			}
		}
	});

	test('should flag free email providers', async () => {
		const freeProviderEmails = [
			'user123@gmail.com',
			'testuser@yahoo.com',
			'someone@outlook.com',
		];

		const results = await client.batchValidate(freeProviderEmails);

		for (let i = 0; i < results.length; i++) {
			const result = results[i];
			if (result.success && result.result) {
				console.log(`\n📧 ${freeProviderEmails[i]}: ${result.result.decision}`);

				// Free providers should be detected
				expect(result.result.signals.isFreeProvider).toBe(true);

				// Decision depends on other factors, but should at least warn
				expect(['warn', 'allow']).toContain(result.result.decision);
			}
		}
	});

	test('should detect high-risk TLDs', async () => {
		const highRiskTLDEmails = [
			'user@example.tk',
			'test@service.ml',
			'spam@fake.ga',
		];

		const results = await client.batchValidate(highRiskTLDEmails);

		for (let i = 0; i < results.length; i++) {
			const result = results[i];
			if (result.success && result.result) {
				console.log(`\n⚠️  ${highRiskTLDEmails[i]}: ${result.result.decision}`);

				// High-risk TLDs should increase risk score
				expect(result.result.riskScore).toBeGreaterThan(0.4);
				expect(['warn', 'block']).toContain(result.result.decision);
			}
		}
	});

	test('should maintain acceptable performance under load', async () => {
		const generatedEmails = generator.generate({ count: 50 });

		const startTime = Date.now();
		const results = await client.parallelValidate(
			generatedEmails.map((e) => e.email)
		);
		const duration = Date.now() - startTime;

		const analysis = analyzeBatchResults(results);

		console.log(`\n⚡ Performance test:`);
		console.log(`  Emails: ${results.length}`);
		console.log(`  Duration: ${duration}ms`);
		console.log(`  Avg per email: ${(duration / results.length).toFixed(1)}ms`);
		console.log(`  Successful: ${analysis.successful}/${analysis.total}`);

		// All should succeed
		expect(analysis.successful).toBe(analysis.total);

		// Average latency should be reasonable (parallel requests)
		const avgLatency = duration / results.length;
		expect(avgLatency).toBeLessThan(500); // 500ms average is acceptable for parallel
	}, 30000);
});
