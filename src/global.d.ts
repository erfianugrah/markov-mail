/**
 * Global Type Extensions
 *
 * Extends the auto-generated Env interface with optional secrets
 */

declare global {
	// Extend the Env interface to include optional Worker secrets and bindings
	interface Env {
		// Secrets (set via wrangler secret put)
		ADMIN_API_KEY?: string;
		ORIGIN_URL?: string;
		CLOUDFLARE_ACCOUNT_ID?: string;  // For Analytics Engine API access
		CLOUDFLARE_API_TOKEN?: string;   // For Analytics Engine API access

		// KV Namespaces (defined in wrangler.jsonc)
		MARKOV_MODEL?: KVNamespace;  // Separate namespace for model storage

		// Feature flags (optional, for Phase 2)
		AUTO_PROMOTE_TO_CANARY?: string;  // Set to "true" to enable auto-promotion
	}
}

export {};
