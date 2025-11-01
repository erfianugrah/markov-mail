/**
 * Global Type Extensions
 *
 * Extends the auto-generated Env interface with optional secrets
 */

declare global {
	// Extend the Env interface to include optional Worker secrets
	interface Env {
		// Admin API Key secret (set via: wrangler secret put ADMIN_API_KEY)
		ADMIN_API_KEY?: string;

		// Origin URL secret (set via: wrangler secret put ORIGIN_URL)
		ORIGIN_URL?: string;
	}
}

export {};
