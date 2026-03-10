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

	// S5 fix: Hash both keys to fixed-length SHA-256 digests before comparing.
	// This prevents leaking key length via timing differences — the old code
	// short-circuited on byteLength before calling timingSafeEqual.
	const encoder = new TextEncoder();
	const [providedHash, expectedHash] = await Promise.all([
		crypto.subtle.digest('SHA-256', encoder.encode(apiKey)),
		crypto.subtle.digest('SHA-256', encoder.encode(env['X-API-KEY'])),
	]);
	const keyMatch = crypto.subtle.timingSafeEqual(providedHash, expectedHash);

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
