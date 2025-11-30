import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolveMXRecords, __resetMXCacheForTests } from '../../../src/services/mx-resolver';

describe('resolveMXRecords', () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		vi.resetAllMocks();
		__resetMXCacheForTests();
	});

	afterEach(() => {
		if (originalFetch) {
			globalThis.fetch = originalFetch;
		} else {
			delete (globalThis as any).fetch;
		}
	});

	it('classifies Google-hosted MX records', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({
				Status: 0,
				Answer: [
					{ data: '1 aspmx.l.google.com.', name: 'example.com', TTL: 300 },
					{ data: '5 alt1.aspmx.l.google.com.', name: 'example.com', TTL: 300 },
				],
			}),
		}) as unknown as typeof fetch;
		globalThis.fetch = mockFetch;

		const result = await resolveMXRecords('example.com');
		expect(result.hasRecords).toBe(true);
		expect(result.primaryProvider).toBe('google');
		expect(result.providerHits.google).toBeGreaterThan(0);
		expect(result.providerHits.self_hosted).toBe(0);
	});

	it('handles missing records gracefully', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ Status: 0 }),
		}) as unknown as typeof fetch;
		globalThis.fetch = mockFetch;

		const result = await resolveMXRecords('unknown.test');
		expect(result.hasRecords).toBe(false);
		expect(result.primaryProvider).toBeNull();
	});

	it('flags self-hosted domains', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({
				Status: 0,
				Answer: [{ data: '10 mail.example.com.', name: 'example.com', TTL: 120 }],
			}),
		}) as unknown as typeof fetch;
		globalThis.fetch = mockFetch;

		const result = await resolveMXRecords('example.com');
		expect(result.primaryProvider).toBe('self_hosted');
		expect(result.providerHits.self_hosted).toBe(1);
	});
});
