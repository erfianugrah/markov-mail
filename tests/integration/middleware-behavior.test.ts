import { describe, it, expect, beforeAll } from 'vitest';

const hasCfPool = process.env.VITEST_CLOUDFLARE_POOL === 'on';
let env: any;
let createExecutionContext: any;
let app: any;

beforeAll(async () => {
	if (!hasCfPool) return;
	({ env, createExecutionContext } = await import('cloudflare:test'));
	app = (await import('../../src/index')).default;
});

describe.skipIf(!hasCfPool)('Middleware body parsing and pass-through behavior', () => {
	it('allows non-email POST routes to proceed without 400', async () => {
		const request = new Request('http://localhost/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username: 'user1' }),
		});

		const ctx = createExecutionContext();
		const response = await app.fetch(request, env, ctx);

		expect(response.status).toBe(200);
		const json = await response.json() as any;
		expect(json.success).toBe(true);
		expect(json.riskScore).toBeUndefined();
	});

	it('parses form-data emails and validates', async () => {
		const form = new FormData();
		form.set('email', 'formuser@example.com');

		const request = new Request('http://localhost/validate', {
			method: 'POST',
			body: form,
		});

		const response = await app.fetch(request, env);
		expect(response.status).toBe(200);
		const result = await response.json() as any;
		expect(result.valid).toBe(true);
	});

	it('returns 400 for malformed JSON on /validate', async () => {
		const request = new Request('http://localhost/validate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: '{bad json',
		});

		const response = await app.fetch(request, env);
		expect(response.status).toBe(400);
		const result = await response.json() as any;
		expect(result.code).toBe('invalid_request_body');
	});

	it('does not 400 on malformed JSON for non-validate routes', async () => {
		const request = new Request('http://localhost/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: '{bad json',
		});

		const response = await app.fetch(request, env);
		expect(response.status).toBe(200);
	});
});
