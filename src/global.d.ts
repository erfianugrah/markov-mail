/**
 * Global Type Extensions
 *
 * Extends the auto-generated Env interface with optional secrets
 */

declare global {
	// Extend the Env interface to include optional Worker secrets and bindings
	interface Env {
		// Secrets (set via wrangler secret put)
		'X-API-KEY'?: string;
		ORIGIN_URL?: string;
		CLOUDFLARE_ACCOUNT_ID?: string;  // For Cloudflare API access
		CLOUDFLARE_API_TOKEN?: string;   // For Cloudflare API access

		// KV Namespaces (defined in wrangler.jsonc)
		CONFIG?: KVNamespace;  // Main configuration namespace
		MARKOV_MODEL?: KVNamespace;  // Separate namespace for model storage
		DISPOSABLE_DOMAINS_LIST?: KVNamespace;  // Namespace for disposable domain list
		TLD_LIST?: KVNamespace;  // Namespace for TLD risk profiles

		// Feature flags (optional, for Phase 2)
		AUTO_PROMOTE_TO_CANARY?: string;  // Set to "true" to enable auto-promotion
	}
}

export {};
