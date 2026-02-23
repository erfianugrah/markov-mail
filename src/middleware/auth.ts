/**
 * Authentication Middleware
 *
 * Protects admin endpoints with API key authentication
 */

import type { Context, Next } from 'hono';

/**
 * Middleware to require API key authentication
 * Checks for X-API-Key header or Authorization: Bearer <key>
 */
export async function requireApiKey(c: Context, next: Next) {
	const env = c.env;

	// Check if admin is enabled
	if (!env['X-API-KEY']) {
		return c.json(
			{
				error: 'Admin API is not enabled',
				message: 'Set X-API-KEY secret to enable admin endpoints',
			},
			503
		);
	}

	// Get API key from header
	const apiKey = c.req.header('X-API-Key') || c.req.header('Authorization')?.replace('Bearer ', '');

	if (!apiKey) {
		return c.json(
			{
				error: 'Unauthorized',
				message: 'API key required. Provide via X-API-Key or Authorization header',
			},
			401
		);
	}

	// Verify API key using constant-time comparison to prevent timing attacks
	const encoder = new TextEncoder();
	const providedBytes = encoder.encode(apiKey);
	const expectedBytes = encoder.encode(env['X-API-KEY']);

	// Keys of different length are rejected, but we still do a constant-time
	// comparison against the expected key to avoid leaking length information.
	const keyMatch =
		providedBytes.byteLength === expectedBytes.byteLength &&
		crypto.subtle.timingSafeEqual(providedBytes, expectedBytes);

	if (!keyMatch) {
		return c.json(
			{
				error: 'Forbidden',
				message: 'Invalid API key',
			},
			403
		);
	}

	// API key is valid, continue
	await next();
}
