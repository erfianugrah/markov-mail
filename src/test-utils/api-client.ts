/**
 * Test API Client
 * Shared utilities for testing API endpoints
 */

export interface ValidationResponse {
	valid: boolean;
	riskScore: number;
	decision: 'allow' | 'warn' | 'block';
	message: string;
	signals: {
		formatValid: boolean;
		entropyScore: number;
		patternType?: string;
		patternFamily?: string;
	isDisposableDomain: boolean;
	isFreeProvider: boolean;
	hasPlusAddressing?: boolean;
	[key: string]: unknown;
	};
	fingerprint: {
		hash: string;
		country?: string;
		asn?: number;
		botScore?: number;
	};
	latency_ms: number;
	latency?: number;
}

export interface BatchValidationResult {
	email: string;
	result?: ValidationResponse;
	error?: string;
	success: boolean;
}

export interface APIClientOptions {
	baseUrl: string;
	apiKey?: string;
	timeout?: number;
}

export class FraudAPIClient {
	private baseUrl: string;
	private apiKey?: string;
	private timeout: number;

	constructor(options: APIClientOptions) {
		this.baseUrl = options.baseUrl.replace(/\/$/, ''); // Remove trailing slash
		this.apiKey = options.apiKey;
		this.timeout = options.timeout || 30000;
	}

	/**
	 * Validate a single email
	 */
	async validate(email: string): Promise<ValidationResponse> {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), this.timeout);

		try {
			const response = await fetch(`${this.baseUrl}/validate`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...(this.apiKey && { 'X-API-Key': this.apiKey }),
				},
				body: JSON.stringify({ email }),
				signal: controller.signal,
			});

			clearTimeout(timeoutId);

			if (!response.ok) {
				const error = await response.text();
				throw new Error(`HTTP ${response.status}: ${error}`);
			}

			return await response.json();
		} catch (error) {
			clearTimeout(timeoutId);

			if (error instanceof Error) {
				if (error.name === 'AbortError') {
					throw new Error(`Request timeout after ${this.timeout}ms`);
				}
				throw error;
			}
			throw new Error('Unknown error occurred');
		}
	}

	/**
	 * Validate multiple emails in batch (sequential)
	 */
	async batchValidate(
		emails: string[],
		options?: { delayMs?: number; onProgress?: (completed: number, total: number) => void }
	): Promise<BatchValidationResult[]> {
		const results: BatchValidationResult[] = [];
		const delayMs = options?.delayMs || 0;

		for (let i = 0; i < emails.length; i++) {
			try {
				const result = await this.validate(emails[i]);
				results.push({
					email: emails[i],
					result,
					success: true,
				});
			} catch (error) {
				results.push({
					email: emails[i],
					error: error instanceof Error ? error.message : 'Unknown error',
					success: false,
				});
			}

			if (options?.onProgress) {
				options.onProgress(i + 1, emails.length);
			}

			// Delay between requests to avoid rate limiting
			if (delayMs > 0 && i < emails.length - 1) {
				await new Promise((resolve) => setTimeout(resolve, delayMs));
			}
		}

		return results;
	}

	/**
	 * Validate multiple emails in parallel
	 */
	async parallelValidate(emails: string[]): Promise<BatchValidationResult[]> {
		const promises = emails.map(async (email) => {
			try {
				const result = await this.validate(email);
				return {
					email,
					result,
					success: true,
				} as BatchValidationResult;
			} catch (error) {
				return {
					email,
					error: error instanceof Error ? error.message : 'Unknown error',
					success: false,
				} as BatchValidationResult;
			}
		});

		return Promise.all(promises);
	}

	/**
	 * Get analytics data (requires admin API key)
	 */
	async getAnalytics(query: string, hours: number = 24): Promise<unknown> {
		if (!this.apiKey) {
			throw new Error('API key required for analytics endpoint');
		}

		const encodedQuery = encodeURIComponent(query);
		const response = await fetch(`${this.baseUrl}/admin/analytics?query=${encodedQuery}&hours=${hours}`, {
			method: 'GET',
			headers: {
				'X-API-Key': this.apiKey,
			},
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`HTTP ${response.status}: ${error}`);
		}

		return response.json();
	}

	/**
	 * Health check
	 */
	async healthCheck(): Promise<{ status: string; timestamp: string }> {
		const response = await fetch(`${this.baseUrl}/admin/health`, {
			method: 'GET',
			headers: this.apiKey ? { 'X-API-Key': this.apiKey } : {},
		});

		if (!response.ok) {
			throw new Error(`Health check failed: HTTP ${response.status}`);
		}

		return response.json();
	}
}

function extractLatency(result?: ValidationResponse): number {
	if (!result) {
		return 0;
	}
	if (typeof result.latency_ms === 'number') {
		return result.latency_ms;
	}
	if (typeof result.latency === 'number') {
		return result.latency;
	}
	return 0;
}

/**
 * Analyze batch validation results
 */
export interface BatchAnalysis {
	total: number;
	successful: number;
	failed: number;
	decisions: {
		allow: number;
		warn: number;
		block: number;
	};
	averageRiskScore: number;
	averageLatency: number;
	detectionRate: number;
}

export function analyzeBatchResults(results: BatchValidationResult[]): BatchAnalysis {
	const successful = results.filter((r) => r.success);
	const failed = results.filter((r) => !r.success);

	const decisions = {
		allow: 0,
		warn: 0,
		block: 0,
	};

	let totalRisk = 0;
	let totalLatency = 0;

	successful.forEach((r) => {
		if (r.result) {
			decisions[r.result.decision]++;
			totalRisk += r.result.riskScore;
			totalLatency += extractLatency(r.result);
		}
	});

	const detectionRate = successful.length > 0 ? (decisions.warn + decisions.block) / successful.length : 0;

	return {
		total: results.length,
		successful: successful.length,
		failed: failed.length,
		decisions,
		averageRiskScore: successful.length > 0 ? totalRisk / successful.length : 0,
		averageLatency: successful.length > 0 ? totalLatency / successful.length : 0,
		detectionRate,
	};
}
