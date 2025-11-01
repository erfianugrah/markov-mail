/**
 * Integration tests for Admin Training Endpoints
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unstable_dev } from 'wrangler';
import type { Unstable_DevWorker } from 'wrangler';

describe('Admin Training Endpoints', () => {
	let worker: Unstable_DevWorker;

	beforeAll(async () => {
		worker = await unstable_dev('src/index.ts', {
			experimental: { disableExperimentalWarning: true },
		});
	});

	afterAll(async () => {
		await worker.stop();
	});

	const ADMIN_API_KEY = 'test-api-key';

	describe('POST /admin/markov/train', () => {
		it('should require API key authentication', async () => {
			const response = await worker.fetch('/admin/markov/train', {
				method: 'POST',
			});

			expect(response.status).toBe(401);
			const data = await response.json();
			expect(data).toHaveProperty('error');
		});

		it('should return 503 if Analytics Engine not configured', async () => {
			const response = await worker.fetch('/admin/markov/train', {
				method: 'POST',
				headers: {
					'X-API-Key': ADMIN_API_KEY,
				},
			});

			// Without CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN secrets
			expect(response.status).toBe(503);
			const data = await response.json();
			expect(data.error).toContain('Analytics Engine not configured');
		});

		it('should accept training request with valid API key', async () => {
			const response = await worker.fetch('/admin/markov/train', {
				method: 'POST',
				headers: {
					'X-API-Key': ADMIN_API_KEY,
					'Content-Type': 'application/json',
				},
			});

			// Will fail without secrets, but should accept the request
			expect([200, 500, 503]).toContain(response.status);
		});

		it('should return JSON response', async () => {
			const response = await worker.fetch('/admin/markov/train', {
				method: 'POST',
				headers: {
					'X-API-Key': ADMIN_API_KEY,
				},
			});

			expect(response.headers.get('content-type')).toContain('application/json');
			const data = await response.json();
			expect(data).toBeDefined();
		});
	});

	describe('GET /admin/markov/status', () => {
		it('should require API key authentication', async () => {
			const response = await worker.fetch('/admin/markov/status');

			expect(response.status).toBe(401);
		});

		it('should return training status with valid API key', async () => {
			const response = await worker.fetch('/admin/markov/status', {
				headers: {
					'X-API-Key': ADMIN_API_KEY,
				},
			});

			expect(response.status).toBe(200);
			const data = await response.json();

			// Should have these properties
			expect(data).toHaveProperty('production');
			expect(data).toHaveProperty('candidate');
			expect(data).toHaveProperty('trainingStatus');
			expect(data).toHaveProperty('recentTraining');
		});

		it('should show training lock status', async () => {
			const response = await worker.fetch('/admin/markov/status', {
				headers: {
					'X-API-Key': ADMIN_API_KEY,
				},
			});

			expect(response.status).toBe(200);
			const data = await response.json();

			expect(data.trainingStatus).toHaveProperty('locked');
			expect(data.trainingStatus).toHaveProperty('lockInfo');
			expect(typeof data.trainingStatus.locked).toBe('boolean');
		});

		it('should show KV namespace information', async () => {
			const response = await worker.fetch('/admin/markov/status', {
				headers: {
					'X-API-Key': ADMIN_API_KEY,
				},
			});

			expect(response.status).toBe(200);
			const data = await response.json();

			expect(data).toHaveProperty('kvNamespaces');
			expect(data.kvNamespaces).toHaveProperty('CONFIG');
			expect(data.kvNamespaces).toHaveProperty('MARKOV_MODEL');
		});

		it('should handle missing training history gracefully', async () => {
			const response = await worker.fetch('/admin/markov/status', {
				headers: {
					'X-API-Key': ADMIN_API_KEY,
				},
			});

			expect(response.status).toBe(200);
			const data = await response.json();

			// Should return empty array if no history
			expect(Array.isArray(data.recentTraining)).toBe(true);
		});
	});

	describe('GET /admin/markov/history', () => {
		it('should require API key authentication', async () => {
			const response = await worker.fetch('/admin/markov/history');

			expect(response.status).toBe(401);
		});

		it('should return training history with valid API key', async () => {
			const response = await worker.fetch('/admin/markov/history', {
				headers: {
					'X-API-Key': ADMIN_API_KEY,
				},
			});

			expect(response.status).toBe(200);
			const data = await response.json();

			expect(data).toHaveProperty('success');
			expect(data).toHaveProperty('history');
			expect(Array.isArray(data.history)).toBe(true);
		});

		it('should include cron schedule in response', async () => {
			const response = await worker.fetch('/admin/markov/history', {
				headers: {
					'X-API-Key': ADMIN_API_KEY,
				},
			});

			expect(response.status).toBe(200);
			const data = await response.json();

			expect(data).toHaveProperty('cronSchedule');
			expect(data.cronSchedule).toContain('6 hours');
		});

		it('should handle empty history gracefully', async () => {
			const response = await worker.fetch('/admin/markov/history', {
				headers: {
					'X-API-Key': ADMIN_API_KEY,
				},
			});

			expect(response.status).toBe(200);
			const data = await response.json();

			// Should provide helpful note if empty
			if (data.history.length === 0) {
				expect(data).toHaveProperty('note');
				expect(data.note).toContain('trigger training');
			}
		});

		it('should limit history to 20 runs', async () => {
			const response = await worker.fetch('/admin/markov/history', {
				headers: {
					'X-API-Key': ADMIN_API_KEY,
				},
			});

			expect(response.status).toBe(200);
			const data = await response.json();

			// History should never exceed 20
			expect(data.history.length).toBeLessThanOrEqual(20);
		});

		it('should return count of history entries', async () => {
			const response = await worker.fetch('/admin/markov/history', {
				headers: {
					'X-API-Key': ADMIN_API_KEY,
				},
			});

			expect(response.status).toBe(200);
			const data = await response.json();

			expect(data).toHaveProperty('count');
			expect(data.count).toBe(data.history.length);
		});
	});

	describe('API Key Validation', () => {
		it('should reject requests without X-API-Key header', async () => {
			const endpoints = [
				{ method: 'POST', path: '/admin/markov/train' },
				{ method: 'GET', path: '/admin/markov/status' },
				{ method: 'GET', path: '/admin/markov/history' },
			];

			for (const endpoint of endpoints) {
				const response = await worker.fetch(endpoint.path, {
					method: endpoint.method,
				});

				expect(response.status).toBe(401);
			}
		});

		it('should reject requests with invalid API key', async () => {
			const response = await worker.fetch('/admin/markov/status', {
				headers: {
					'X-API-Key': 'invalid-key',
				},
			});

			expect(response.status).toBe(401);
		});

		it('should accept requests with valid API key', async () => {
			const response = await worker.fetch('/admin/markov/status', {
				headers: {
					'X-API-Key': ADMIN_API_KEY,
				},
			});

			expect(response.status).toBe(200);
		});
	});

	describe('Error Handling', () => {
		it('should return JSON error responses', async () => {
			const response = await worker.fetch('/admin/markov/train', {
				method: 'POST',
			});

			expect(response.headers.get('content-type')).toContain('application/json');
			const data = await response.json();
			expect(data).toHaveProperty('error');
		});

		it('should include helpful error messages', async () => {
			const response = await worker.fetch('/admin/markov/train', {
				method: 'POST',
				headers: {
					'X-API-Key': ADMIN_API_KEY,
				},
			});

			const data = await response.json();
			if (data.error) {
				expect(typeof data.message).toBe('string');
				expect(data.message.length).toBeGreaterThan(0);
			}
		});
	});

	describe('CORS Headers', () => {
		it('should include CORS headers in responses', async () => {
			const response = await worker.fetch('/admin/markov/status', {
				headers: {
					'X-API-Key': ADMIN_API_KEY,
					'Origin': 'https://example.com',
				},
			});

			// CORS is enabled globally in index.ts
			expect(response.headers.has('access-control-allow-origin')).toBe(true);
		});
	});
});
