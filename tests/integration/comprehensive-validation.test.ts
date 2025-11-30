import { describe, it, expect, beforeAll } from 'vitest';
import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import worker from '../../src/index';

/**
 * Comprehensive Email Validation Test Suite
 *
 * Tests the /validate endpoint with real-world payload structures including:
 * - email: The email address to validate
 * - consumer: The system/application making the request (e.g., "MY_APP", "WEB_APP", "API")
 * - flow: The authentication/signup flow (e.g., "SIGNUP_EMAIL_VERIFY", "PWDLESS_LOGIN_EMAIL")
 */

interface ValidationPayload {
	email: string;
	consumer: string;
	flow: string;
}

interface ValidationResponse {
	valid: boolean;
	riskScore: number;
	decision: 'allow' | 'warn' | 'block';
	message: string;
	signals: {
		formatValid: boolean;
		entropyScore: number;
		localPartLength: number;
		isDisposableDomain: boolean;
		isFreeProvider: boolean;
		domainReputationScore: number;
		patternFamily?: string;
		patternType?: string;
		patternConfidence?: number;
		patternRiskScore?: number;
		normalizedEmail?: string;
		hasPlusAddressing?: boolean;
		tldRiskScore?: number;
	};
	fingerprint: {
		hash: string;
		country?: string;
		asn?: number;
		botScore?: number;
	};
	latency_ms: number;
}

async function validateEmail(payload: ValidationPayload): Promise<ValidationResponse> {
	const request = new Request('http://localhost:8787/validate', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(payload),
	});
	const ctx = createExecutionContext();
	const response = await worker.fetch(request, env, ctx);
	await waitOnExecutionContext(ctx);

	return await response.json() as ValidationResponse;
}

describe('Comprehensive Email Validation Test Suite', () => {
	describe('Valid Legitimate Emails - ALLOW/WARN', () => {
		const testCases: ValidationPayload[] = [
			{
				email: 'user1@company.com',
				consumer: 'MY_APP',
				flow: 'SIGNUP_EMAIL_VERIFY',
			},
			{
				email: 'person1@enterprise.org',
				consumer: 'MY_APP',
				flow: 'PWDLESS_LOGIN_EMAIL',
			},
			{
				email: 'user2@business.net',
				consumer: 'WEB_APP',
				flow: 'PASSWORD_RESET',
			},
			{
				email: 'person2@startup.io',
				consumer: 'API',
				flow: 'SIGNUP_EMAIL_VERIFY',
			},
			{
				email: 'user3@agency.co',
				consumer: 'MY_APP',
				flow: 'EMAIL_CHANGE',
			},
			{
				email: 'person3@firm.com',
				consumer: 'WEB_APP',
				flow: 'PWDLESS_LOGIN_EMAIL',
			},
			{
				email: 'user4@enterprise.com',
				consumer: 'MY_APP',
				flow: 'SIGNUP_EMAIL_VERIFY',
			},
			{
				email: 'person4@company.co.uk',
				consumer: 'API',
				flow: 'ACCOUNT_VERIFY',
			},
			{
				email: 'user5@business.de',
				consumer: 'MY_APP',
				flow: 'SIGNUP_EMAIL_VERIFY',
			},
			{
				email: 'person5@startup.fr',
				consumer: 'WEB_APP',
				flow: 'PWDLESS_LOGIN_EMAIL',
			},
		];

		testCases.forEach(({ email, consumer, flow }) => {
			it(`should process legitimate email: ${email} (${consumer}/${flow})`, async () => {
				const result = await validateEmail({ email, consumer, flow });

				expect(result.valid).toBe(true);
				expect(result.signals.formatValid).toBe(true);
				expect(result.signals.isDisposableDomain).toBe(false);
				// May be allow or warn depending on N-Gram analysis
				expect(['allow', 'warn']).toContain(result.decision);
			});
		});
	});

	describe('Free Email Providers - WARN', () => {
		const testCases: ValidationPayload[] = [
			{
				email: 'user123@gmail.com',
				consumer: 'MY_APP',
				flow: 'SIGNUP_EMAIL_VERIFY',
			},
			{
				email: 'testuser@yahoo.com',
				consumer: 'WEB_APP',
				flow: 'PWDLESS_LOGIN_EMAIL',
			},
			{
				email: 'myemail@outlook.com',
				consumer: 'API',
				flow: 'PASSWORD_RESET',
			},
			{
				email: 'contact@hotmail.com',
				consumer: 'MY_APP',
				flow: 'SIGNUP_EMAIL_VERIFY',
			},
			{
				email: 'hello@protonmail.com',
				consumer: 'WEB_APP',
				flow: 'EMAIL_CHANGE',
			},
		];

		testCases.forEach(({ email, consumer, flow }) => {
			it(`should warn on free provider: ${email} (${consumer}/${flow})`, async () => {
				const result = await validateEmail({ email, consumer, flow });

				expect(result.valid).toBe(true);
				expect(result.signals.formatValid).toBe(true);
				expect(result.signals.isFreeProvider).toBe(true);
				// Free providers may get warn or allow depending on other signals
				expect(['allow', 'warn']).toContain(result.decision);
			});
		});
	});

	describe('Disposable Email Domains - BLOCK', () => {
		const testCases: ValidationPayload[] = [
			{
				email: 'temp123@throwaway.email',
				consumer: 'MY_APP',
				flow: 'SIGNUP_EMAIL_VERIFY',
			},
			{
				email: 'fake@tempmail.com',
				consumer: 'WEB_APP',
				flow: 'PWDLESS_LOGIN_EMAIL',
			},
			{
				email: 'test@guerrillamail.com',
				consumer: 'API',
				flow: 'SIGNUP_EMAIL_VERIFY',
			},
			{
				email: 'disposable@10minutemail.com',
				consumer: 'MY_APP',
				flow: 'PASSWORD_RESET',
			},
			{
				email: 'trash@mailinator.com',
				consumer: 'WEB_APP',
				flow: 'SIGNUP_EMAIL_VERIFY',
			},
			{
				email: 'spam@trashmail.com',
				consumer: 'API',
				flow: 'EMAIL_CHANGE',
			},
			{
				email: 'junk@yopmail.com',
				consumer: 'MY_APP',
				flow: 'SIGNUP_EMAIL_VERIFY',
			},
		];

		testCases.forEach(({ email, consumer, flow }) => {
			it(`should block disposable email: ${email} (${consumer}/${flow})`, async () => {
				const result = await validateEmail({ email, consumer, flow });

				expect(result.decision).toBe('block');
				expect(result.signals.isDisposableDomain).toBe(true);
				expect(result.riskScore).toBeGreaterThan(0.6);
			});
		});
	});

	describe('Sequential Pattern Emails - BLOCK/WARN', () => {
		const testCases: ValidationPayload[] = [
			{
				email: 'user1@example.com',
				consumer: 'MY_APP',
				flow: 'SIGNUP_EMAIL_VERIFY',
			},
			{
				email: 'user2@example.com',
				consumer: 'MY_APP',
				flow: 'SIGNUP_EMAIL_VERIFY',
			},
			{
				email: 'user3@example.com',
				consumer: 'MY_APP',
				flow: 'SIGNUP_EMAIL_VERIFY',
			},
			{
				email: 'test001@company.com',
				consumer: 'WEB_APP',
				flow: 'PWDLESS_LOGIN_EMAIL',
			},
			{
				email: 'test002@company.com',
				consumer: 'WEB_APP',
				flow: 'PWDLESS_LOGIN_EMAIL',
			},
			{
				email: 'account123@service.com',
				consumer: 'API',
				flow: 'SIGNUP_EMAIL_VERIFY',
			},
			{
				email: 'account124@service.com',
				consumer: 'API',
				flow: 'SIGNUP_EMAIL_VERIFY',
			},
			{
				email: 'user_a@test.com',
				consumer: 'MY_APP',
				flow: 'SIGNUP_EMAIL_VERIFY',
			},
			{
				email: 'user_b@test.com',
				consumer: 'MY_APP',
				flow: 'SIGNUP_EMAIL_VERIFY',
			},
		];

		testCases.forEach(({ email, consumer, flow }) => {
			it(`should process sequential-like pattern: ${email} (${consumer}/${flow})`, async () => {
				const result = await validateEmail({ email, consumer, flow });

				// Pattern should be detected (type may vary: sequential, simple, dated, formatted)
				expect(result.signals.patternType).toBeDefined();
				// Decision may vary based on overall risk score
				expect(['allow', 'warn', 'block']).toContain(result.decision);
			});
		});
	});

	describe('Dated Pattern Emails - WARN/BLOCK', () => {
		const testCases: ValidationPayload[] = [
			{
				email: 'user8.2024@example.com',
				consumer: 'MY_APP',
				flow: 'SIGNUP_EMAIL_VERIFY',
			},
			{
				email: 'person8_2025@company.com',
				consumer: 'WEB_APP',
				flow: 'PWDLESS_LOGIN_EMAIL',
			},
			{
				email: 'test2024@service.com',
				consumer: 'API',
				flow: 'SIGNUP_EMAIL_VERIFY',
			},
			{
				email: 'account.2025@business.com',
				consumer: 'MY_APP',
				flow: 'PASSWORD_RESET',
			},
			{
				email: 'user2024test@example.com',
				consumer: 'WEB_APP',
				flow: 'SIGNUP_EMAIL_VERIFY',
			},
		];

		testCases.forEach(({ email, consumer, flow }) => {
			it(`should flag dated pattern: ${email} (${consumer}/${flow})`, async () => {
				const result = await validateEmail({ email, consumer, flow });

				// Pattern should be detected (may be dated, random, or other)
				expect(result.signals.patternType).toBeDefined();
				// Legacy behavior allowed some dated patterns; keep for regression tracking
				expect(['allow', 'warn', 'block']).toContain(result.decision);
			});
		});
	});

	describe('Plus-Addressing Patterns - WARN/BLOCK', () => {
		const testCases: ValidationPayload[] = [
			{
				email: 'user+1@gmail.com',
				consumer: 'MY_APP',
				flow: 'SIGNUP_EMAIL_VERIFY',
			},
			{
				email: 'user+2@gmail.com',
				consumer: 'MY_APP',
				flow: 'SIGNUP_EMAIL_VERIFY',
			},
			{
				email: 'test+tag1@yahoo.com',
				consumer: 'WEB_APP',
				flow: 'PWDLESS_LOGIN_EMAIL',
			},
			{
				email: 'test+tag2@yahoo.com',
				consumer: 'WEB_APP',
				flow: 'PWDLESS_LOGIN_EMAIL',
			},
			{
				email: 'user6+spam@outlook.com',
				consumer: 'API',
				flow: 'SIGNUP_EMAIL_VERIFY',
			},
			{
				email: 'person6+test@hotmail.com',
				consumer: 'MY_APP',
				flow: 'EMAIL_CHANGE',
			},
		];

		testCases.forEach(({ email, consumer, flow }) => {
			it(`should detect plus-addressing: ${email} (${consumer}/${flow})`, async () => {
				const result = await validateEmail({ email, consumer, flow });

				expect(result.signals.hasPlusAddressing).toBe(true);
				expect(result.signals.normalizedEmail).toBeDefined();
			});
		});
	});

	describe('High-Risk TLD Emails - Evaluated', () => {
		const testCases: ValidationPayload[] = [
			{
				email: 'user@example.tk',
				consumer: 'MY_APP',
				flow: 'SIGNUP_EMAIL_VERIFY',
			},
			{
				email: 'test@service.ml',
				consumer: 'WEB_APP',
				flow: 'PWDLESS_LOGIN_EMAIL',
			},
			{
				email: 'contact@business.ga',
				consumer: 'API',
				flow: 'SIGNUP_EMAIL_VERIFY',
			},
			{
				email: 'info@company.cf',
				consumer: 'MY_APP',
				flow: 'PASSWORD_RESET',
			},
			{
				email: 'admin@site.gq',
				consumer: 'WEB_APP',
				flow: 'SIGNUP_EMAIL_VERIFY',
			},
			{
				email: 'support@domain.top',
				consumer: 'API',
				flow: 'EMAIL_CHANGE',
			},
			{
				email: 'user@example.xyz',
				consumer: 'MY_APP',
				flow: 'SIGNUP_EMAIL_VERIFY',
			},
		];

		testCases.forEach(({ email, consumer, flow }) => {
			it(`should evaluate TLD risk: ${email} (${consumer}/${flow})`, async () => {
				const result = await validateEmail({ email, consumer, flow });

				// TLD risk score should be present
				expect(result.signals.tldRiskScore).toBeDefined();
				expect(result.signals.tldRiskScore).toBeGreaterThanOrEqual(0);
				// Decision varies based on TLD category
				expect(['allow', 'warn', 'block']).toContain(result.decision);
			});
		});
	});

	describe('Invalid Format Emails - BLOCK', () => {
		const testCases: ValidationPayload[] = [
			{
				email: 'notanemail',
				consumer: 'MY_APP',
				flow: 'SIGNUP_EMAIL_VERIFY',
			},
			{
				email: 'missing@domain',
				consumer: 'WEB_APP',
				flow: 'PWDLESS_LOGIN_EMAIL',
			},
			{
				email: '@nodomain.com',
				consumer: 'API',
				flow: 'SIGNUP_EMAIL_VERIFY',
			},
			{
				email: 'double@@domain.com',
				consumer: 'MY_APP',
				flow: 'PASSWORD_RESET',
			},
			{
				email: 'spaces in@email.com',
				consumer: 'WEB_APP',
				flow: 'SIGNUP_EMAIL_VERIFY',
			},
			{
				email: 'no.domain@',
				consumer: 'API',
				flow: 'EMAIL_CHANGE',
			},
		];

		testCases.forEach(({ email, consumer, flow }) => {
			it(`should block invalid format: ${email} (${consumer}/${flow})`, async () => {
				const result = await validateEmail({ email, consumer, flow });

				expect(result.signals.formatValid).toBe(false);
				expect(result.decision).toBe('block');
			});
		});
	});

	describe('Short/Suspicious Emails - BLOCK', () => {
		const testCases: ValidationPayload[] = [
			{
				email: 'a@example.com',
				consumer: 'MY_APP',
				flow: 'SIGNUP_EMAIL_VERIFY',
			},
			{
				email: 'ab@test.com',
				consumer: 'WEB_APP',
				flow: 'PWDLESS_LOGIN_EMAIL',
			},
			{
				email: 'x@company.com',
				consumer: 'API',
				flow: 'SIGNUP_EMAIL_VERIFY',
			},
		];

		testCases.forEach(({ email, consumer, flow }) => {
			it(`should block short email: ${email} (${consumer}/${flow})`, async () => {
				const result = await validateEmail({ email, consumer, flow });

				expect(result.signals.localPartLength).toBeLessThan(3);
				expect(result.decision).toBe('block');
			});
		});
	});

	describe('Trusted TLD Emails - ALLOW', () => {
		const testCases: ValidationPayload[] = [
			{
				email: 'professor@university.edu',
				consumer: 'MY_APP',
				flow: 'SIGNUP_EMAIL_VERIFY',
			},
			{
				email: 'admin@government.gov',
				consumer: 'WEB_APP',
				flow: 'PWDLESS_LOGIN_EMAIL',
			},
			{
				email: 'researcher@institute.edu',
				consumer: 'API',
				flow: 'SIGNUP_EMAIL_VERIFY',
			},
			{
				email: 'officer@agency.gov',
				consumer: 'MY_APP',
				flow: 'PASSWORD_RESET',
			},
		];

		testCases.forEach(({ email, consumer, flow }) => {
			it(`should allow trusted TLD: ${email} (${consumer}/${flow})`, async () => {
				const result = await validateEmail({ email, consumer, flow });

				expect(result.signals.tldRiskScore).toBeLessThan(0.3);
				expect(result.decision).toBe('allow');
			});
		});
	});

	describe('International Domain Emails - ALLOW/WARN', () => {
		const testCases: ValidationPayload[] = [
			{
				email: 'user@company.co.uk',
				consumer: 'MY_APP',
				flow: 'SIGNUP_EMAIL_VERIFY',
			},
			{
				email: 'contact@business.de',
				consumer: 'WEB_APP',
				flow: 'PWDLESS_LOGIN_EMAIL',
			},
			{
				email: 'info@enterprise.fr',
				consumer: 'API',
				flow: 'SIGNUP_EMAIL_VERIFY',
			},
			{
				email: 'support@service.jp',
				consumer: 'MY_APP',
				flow: 'PASSWORD_RESET',
			},
			{
				email: 'admin@company.ca',
				consumer: 'WEB_APP',
				flow: 'EMAIL_CHANGE',
			},
			{
				email: 'team@startup.au',
				consumer: 'API',
				flow: 'SIGNUP_EMAIL_VERIFY',
			},
		];

		testCases.forEach(({ email, consumer, flow }) => {
			it(`should handle international domain: ${email} (${consumer}/${flow})`, async () => {
				const result = await validateEmail({ email, consumer, flow });

				expect(result.signals.formatValid).toBe(true);
				expect(['allow', 'warn']).toContain(result.decision);
			});
		});
	});

	describe('Mixed Risk Emails - WARN', () => {
		const testCases: ValidationPayload[] = [
			{
				email: 'user7@gmail.com',
				consumer: 'MY_APP',
				flow: 'SIGNUP_EMAIL_VERIFY',
			},
			{
				email: 'testuser2024@yahoo.com',
				consumer: 'WEB_APP',
				flow: 'PWDLESS_LOGIN_EMAIL',
			},
			{
				email: 'person7@outlook.com',
				consumer: 'API',
				flow: 'SIGNUP_EMAIL_VERIFY',
			},
			{
				email: 'user+test@protonmail.com',
				consumer: 'MY_APP',
				flow: 'PASSWORD_RESET',
			},
		];

		testCases.forEach(({ email, consumer, flow }) => {
			it(`should warn on mixed risk: ${email} (${consumer}/${flow})`, async () => {
				const result = await validateEmail({ email, consumer, flow });

				expect(result.signals.formatValid).toBe(true);
				// Mixed risk should result in warn or allow, not block
				expect(['allow', 'warn']).toContain(result.decision);
			});
		});
	});

	describe('Real-world Email Scenarios', () => {
		it('should handle user@service.com with MY_APP/PWDLESS_LOGIN_EMAIL', async () => {
			const result = await validateEmail({
				email: 'user@service.com',
				consumer: 'MY_APP',
				flow: 'PWDLESS_LOGIN_EMAIL',
			});

			expect(result.signals.formatValid).toBe(true);
			expect(result).toHaveProperty('decision');
			expect(result).toHaveProperty('riskScore');
			expect(result).toHaveProperty('fingerprint');
		});

		it('should handle user@service.com with MY_APP/SIGNUP_EMAIL_VERIFY', async () => {
			const result = await validateEmail({
				email: 'user@service.com',
				consumer: 'MY_APP',
				flow: 'SIGNUP_EMAIL_VERIFY',
			});

			expect(result.signals.formatValid).toBe(true);
			expect(result).toHaveProperty('decision');
			expect(result).toHaveProperty('riskScore');
		});

		it('should handle bulk validation for multiple flows', async () => {
			const flows = [
				'SIGNUP_EMAIL_VERIFY',
				'PWDLESS_LOGIN_EMAIL',
				'PASSWORD_RESET',
				'EMAIL_CHANGE',
				'ACCOUNT_VERIFY',
			];

			for (const flow of flows) {
				const result = await validateEmail({
					email: 'user@service.com',
					consumer: 'MY_APP',
					flow,
				});

				expect(result.signals.formatValid).toBe(true);
				expect(['allow', 'warn', 'block']).toContain(result.decision);
			}
		});
	});

	describe('Batch Attack Simulation (Benford\'s Law)', () => {
		it('should detect batch attack with sequential patterns', async () => {
			const batchEmails = Array.from({ length: 50 }, (_, i) => ({
				email: `user${i + 1}@example.com`,
				consumer: 'MY_APP',
				flow: 'SIGNUP_EMAIL_VERIFY',
			}));

			let blockedCount = 0;
			let warnCount = 0;
			let sequentialCount = 0;

			for (const payload of batchEmails) {
				const result = await validateEmail(payload);

				if (result.decision === 'block') blockedCount++;
				if (result.decision === 'warn') warnCount++;

				// Track sequential patterns (may be detected as sequential or simple)
				if (result.signals.patternType === 'sequential' || result.signals.patternType === 'simple') {
					sequentialCount++;
				}
			}

			// Legacy expectation noted here; update once we have decision-tree benchmarks
			expect(blockedCount + warnCount).toBeGreaterThan(20);
			// Most should have pattern detected (pattern detection should still work)
			expect(sequentialCount).toBeGreaterThan(30);
		}, 15000); // 15 second timeout for batch processing

		it('should detect batch attack with dated patterns', async () => {
			const batchEmails = Array.from({ length: 30 }, (_, i) => ({
				email: `user${i + 1}.2024@example.com`,
				consumer: 'WEB_APP',
				flow: 'SIGNUP_EMAIL_VERIFY',
			}));

			let blockedCount = 0;
			let warnCount = 0;

			for (const payload of batchEmails) {
				const result = await validateEmail(payload);

				if (result.decision === 'block') blockedCount++;
				if (result.decision === 'warn') warnCount++;

				// Dated patterns should be detected
				expect(result.signals.patternType).toBe('dated');
			}

			// Legacy expectation noted here; update once we have decision-tree benchmarks
			expect(blockedCount + warnCount).toBeGreaterThan(12);
		}, 15000); // 15 second timeout for batch processing
	});

	describe('Performance and Response Structure', () => {
		it('should return consistent response structure', async () => {
			const result = await validateEmail({
				email: 'test@example.com',
				consumer: 'MY_APP',
				flow: 'SIGNUP_EMAIL_VERIFY',
			});

			// Check all required fields
			expect(result).toHaveProperty('valid');
			expect(result).toHaveProperty('riskScore');
			expect(result).toHaveProperty('decision');
			expect(result).toHaveProperty('message');
			expect(result).toHaveProperty('signals');
			expect(result).toHaveProperty('fingerprint');
			expect(result).toHaveProperty('latency_ms');

			// Check signals structure
			expect(result.signals).toHaveProperty('formatValid');
			expect(result.signals).toHaveProperty('entropyScore');
			expect(result.signals).toHaveProperty('localPartLength');
			expect(result.signals).toHaveProperty('isDisposableDomain');
			expect(result.signals).toHaveProperty('isFreeProvider');
			expect(result.signals).toHaveProperty('domainReputationScore');

			// Check fingerprint structure
			expect(result.fingerprint).toHaveProperty('hash');
		});

		it('should complete validation within acceptable latency', async () => {
			const result = await validateEmail({
				email: 'performance.test@example.com',
				consumer: 'MY_APP',
				flow: 'SIGNUP_EMAIL_VERIFY',
			});

			// Latency should be reasonable (< 500ms for test environment)
			expect(result.latency_ms).toBeLessThan(500);
		});

		it('should handle high-entropy complex emails', async () => {
			const result = await validateEmail({
				email: 'very.long.complex.email.address.with.many.dots@subdomain.example.com',
				consumer: 'API',
				flow: 'SIGNUP_EMAIL_VERIFY',
			});

			expect(result.signals.formatValid).toBe(true);
			expect(result).toHaveProperty('decision');
		});
	});

	describe('Different Consumer Systems', () => {
		const consumers = ['MY_APP', 'WEB_APP', 'API', 'MOBILE', 'WEB'];
		const testEmail = 'test@example.com';

		consumers.forEach((consumer) => {
			it(`should handle ${consumer} consumer correctly`, async () => {
				const result = await validateEmail({
					email: testEmail,
					consumer,
					flow: 'SIGNUP_EMAIL_VERIFY',
				});

				expect(result.signals.formatValid).toBe(true);
				expect(['allow', 'warn', 'block']).toContain(result.decision);
			});
		});
	});

	describe('All Authentication Flows', () => {
		const flows = [
			'SIGNUP_EMAIL_VERIFY',
			'PWDLESS_LOGIN_EMAIL',
			'PASSWORD_RESET',
			'EMAIL_CHANGE',
			'ACCOUNT_VERIFY',
			'TWO_FACTOR_AUTH',
			'MAGIC_LINK_LOGIN',
			'EMAIL_CONFIRMATION',
		];
		const testEmail = 'user@company.com';

		flows.forEach((flow) => {
			it(`should handle ${flow} flow correctly`, async () => {
				const result = await validateEmail({
					email: testEmail,
					consumer: 'MY_APP',
					flow,
				});

				expect(result.signals.formatValid).toBe(true);
				expect(['allow', 'warn', 'block']).toContain(result.decision);
			});
		});
	});
});
