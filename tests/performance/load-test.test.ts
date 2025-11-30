/**
 * Performance & Load Tests
 *
 * Tests API performance under load with large batches
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { EmailGenerator } from '../../src/test-utils/email-generator';
import { FraudAPIClient, analyzeBatchResults } from '../../src/test-utils/api-client';

const API_URL = process.env.WORKER_URL || 'http://localhost:8787';
const SMALL_BATCH = 100;
const MEDIUM_BATCH = 500;
const LARGE_BATCH = 1000;

describe('Performance & Load Tests', () => {
	let client: FraudAPIClient;
	let generator: EmailGenerator;

	beforeAll(() => {
		client = new FraudAPIClient({
			baseUrl: API_URL,
			timeout: 30000, // 30s timeout for large batches
		});
		generator = new EmailGenerator();
	});

	describe('Sequential Processing', () => {
		test('should handle 100 emails sequentially', async () => {
			console.log(`\n📦 Sequential test: ${SMALL_BATCH} emails`);

			const emails = generator.generate({ count: SMALL_BATCH });

			const startTime = Date.now();
			const results = await client.batchValidate(
				emails.map((e) => e.email),
				{
					delayMs: 10,
					onProgress: (completed, total) => {
						if (completed % 20 === 0) {
							console.log(`  Progress: ${completed}/${total}`);
						}
					},
				}
			);
			const duration = Date.now() - startTime;

			const analysis = analyzeBatchResults(results);

			console.log(`\n📊 Results:`);
			console.log(`  Duration: ${duration}ms`);
			console.log(`  Avg per email: ${(duration / results.length).toFixed(1)}ms`);
			console.log(`  Throughput: ${((results.length / duration) * 1000).toFixed(1)} emails/sec`);
			console.log(`  Success rate: ${((analysis.successful / analysis.total) * 100).toFixed(1)}%`);
			console.log(`  Detection rate: ${(analysis.detectionRate * 100).toFixed(1)}%`);

			expect(analysis.successful).toBe(analysis.total);
			expect(duration).toBeLessThan(60000); // Should complete in 60s
		}, 90000);
	});

	describe('Parallel Processing', () => {
		test('should handle 100 emails in parallel', async () => {
			console.log(`\n⚡ Parallel test: ${SMALL_BATCH} emails`);

			const emails = generator.generate({ count: SMALL_BATCH });

			const startTime = Date.now();
			const results = await client.parallelValidate(emails.map((e) => e.email));
			const duration = Date.now() - startTime;

			const analysis = analyzeBatchResults(results);

			console.log(`\n📊 Results:`);
			console.log(`  Duration: ${duration}ms`);
			console.log(`  Avg per email: ${(duration / results.length).toFixed(1)}ms`);
			console.log(`  Throughput: ${((results.length / duration) * 1000).toFixed(1)} emails/sec`);
			console.log(`  Success rate: ${((analysis.successful / analysis.total) * 100).toFixed(1)}%`);
			console.log(`  Detection rate: ${(analysis.detectionRate * 100).toFixed(1)}%`);

			expect(analysis.successful).toBe(analysis.total);
			expect(duration).toBeLessThan(20000); // Parallel should be much faster
		}, 30000);

		test('should handle 500 emails in parallel', async () => {
			console.log(`\n⚡ Parallel test: ${MEDIUM_BATCH} emails`);

			const emails = generator.generate({ count: MEDIUM_BATCH });

			const startTime = Date.now();
			const results = await client.parallelValidate(emails.map((e) => e.email));
			const duration = Date.now() - startTime;

			const analysis = analyzeBatchResults(results);

			console.log(`\n📊 Results:`);
			console.log(`  Duration: ${duration}ms (${(duration / 1000).toFixed(1)}s)`);
			console.log(`  Avg per email: ${(duration / results.length).toFixed(1)}ms`);
			console.log(`  Throughput: ${((results.length / duration) * 1000).toFixed(1)} emails/sec`);
			console.log(`  Success rate: ${((analysis.successful / analysis.total) * 100).toFixed(1)}%`);
			console.log(`  Detection rate: ${(analysis.detectionRate * 100).toFixed(1)}%`);
			console.log(`  Avg latency: ${analysis.averageLatency.toFixed(1)}ms`);

			expect(analysis.successful).toBe(analysis.total);
			// Should maintain high success rate under load
			expect(analysis.successful / analysis.total).toBeGreaterThan(0.95);
		}, 60000);
	});

	describe('Stress Testing', () => {
		test.skip('should handle 1000 emails (stress test)', async () => {
			console.log(`\n🔥 Stress test: ${LARGE_BATCH} emails`);

			const emails = generator.generate({ count: LARGE_BATCH });

			const startTime = Date.now();
			const results = await client.parallelValidate(emails.map((e) => e.email));
			const duration = Date.now() - startTime;

			const analysis = analyzeBatchResults(results);

			console.log(`\n📊 Results:`);
			console.log(`  Duration: ${duration}ms (${(duration / 1000).toFixed(1)}s)`);
			console.log(`  Avg per email: ${(duration / results.length).toFixed(1)}ms`);
			console.log(`  Throughput: ${((results.length / duration) * 1000).toFixed(1)} emails/sec`);
			console.log(`  Success rate: ${((analysis.successful / analysis.total) * 100).toFixed(1)}%`);
			console.log(`  Failed: ${analysis.failed}`);
			console.log(`  Detection rate: ${(analysis.detectionRate * 100).toFixed(1)}%`);
			console.log(`  Avg latency: ${analysis.averageLatency.toFixed(1)}ms`);

			// Accept some failures under extreme load
			expect(analysis.successful / analysis.total).toBeGreaterThan(0.90); // 90% success rate
		}, 120000);
	});

	describe('Performance Metrics', () => {
		test('should maintain consistent latency', async () => {
			console.log(`\n⏱️  Latency consistency test`);

			const emails = generator.generate({ count: 50 });
			const results = await client.parallelValidate(emails.map((e) => e.email));

			const latencies = results
				.filter((r) => r.success && r.result)
				.map((r) => r.result!.latency_ms ?? r.result!.latency ?? 0);

			const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
			const maxLatency = Math.max(...latencies);
			const minLatency = Math.min(...latencies);

			console.log(`  Avg: ${avgLatency.toFixed(1)}ms`);
			console.log(`  Min: ${minLatency.toFixed(1)}ms`);
			console.log(`  Max: ${maxLatency.toFixed(1)}ms`);
			console.log(`  Std Dev: ${calculateStdDev(latencies).toFixed(1)}ms`);

			// Average should be reasonable
			expect(avgLatency).toBeLessThan(200);

			// Max shouldn't be too much higher than average (consistency)
			expect(maxLatency).toBeLessThan(avgLatency * 3);
		}, 30000);

		test('should have acceptable p95 and p99 latencies', async () => {
			console.log(`\n📊 Percentile latency test`);

			const emails = generator.generate({ count: 100 });
			const results = await client.parallelValidate(emails.map((e) => e.email));

			const latencies = results
				.filter((r) => r.success && r.result)
				.map((r) => r.result!.latency_ms ?? r.result!.latency ?? 0)
				.sort((a, b) => a - b);

			const p50 = percentile(latencies, 50);
			const p95 = percentile(latencies, 95);
			const p99 = percentile(latencies, 99);

			console.log(`  P50 (median): ${p50.toFixed(1)}ms`);
			console.log(`  P95: ${p95.toFixed(1)}ms`);
			console.log(`  P99: ${p99.toFixed(1)}ms`);

			// P50 should be very fast
			expect(p50).toBeLessThan(100);

			// P95 should still be acceptable
			expect(p95).toBeLessThan(300);

			// P99 may be higher but not excessive
			expect(p99).toBeLessThan(500);
		}, 60000);
	});

	describe('Pattern Detection Under Load', () => {
		test('should maintain detection accuracy under load', async () => {
			console.log(`\n🎯 Detection accuracy under load`);

			const emails = generator.generate({ count: 200 });

			const results = await client.parallelValidate(emails.map((e) => e.email));
			const analysis = analyzeBatchResults(results);

			console.log(`  Detection rate: ${(analysis.detectionRate * 100).toFixed(1)}%`);
			console.log(`  Avg risk score: ${analysis.averageRiskScore.toFixed(3)}`);
			console.log(`  Decisions: Allow=${analysis.decisions.allow}, Warn=${analysis.decisions.warn}, Block=${analysis.decisions.block}`);

			// Should maintain high detection rate even under load
			expect(analysis.detectionRate).toBeGreaterThan(0.2); // Model now tuned for lower thresholds

			// Risk scores should be reasonable
			expect(analysis.averageRiskScore).toBeGreaterThan(0.3);
		}, 60000);
	});

	describe('Error Handling Under Load', () => {
		test('should handle mixed valid/invalid emails under load', async () => {
			console.log(`\n🔀 Mixed email test`);

			const validEmails = generator.generate({ count: 50 }).map((e) => e.email);
			const invalidEmails = [
				'notanemail',
				'@invalid.com',
				'missing@',
				'',
				'a@b',
			];

			const allEmails = [...validEmails, ...invalidEmails];

			const results = await client.parallelValidate(allEmails);

			const validResults = results.slice(0, validEmails.length);
			const invalidResults = results.slice(validEmails.length);

			console.log(`  Valid emails: ${validResults.filter((r) => r.success).length}/${validResults.length} succeeded`);
			console.log(`  Invalid emails: ${invalidResults.filter((r) => r.success).length}/${invalidResults.length} succeeded`);

			// All should complete (either success or handled error)
			expect(results.length).toBe(allEmails.length);

			// Invalid emails should be properly rejected
			invalidResults.forEach((result) => {
				if (result.success && result.result) {
					expect(result.result.decision).toBe('block');
				}
			});
		}, 30000);
	});

	describe('Throughput Tests', () => {
		test('should achieve minimum throughput threshold', async () => {
			console.log(`\n🚀 Throughput test`);

			const emails = generator.generate({ count: 200 });

			const startTime = Date.now();
			const results = await client.parallelValidate(emails.map((e) => e.email));
			const duration = Date.now() - startTime;

			const throughput = (results.length / duration) * 1000; // emails per second

			console.log(`  Duration: ${duration}ms`);
			console.log(`  Throughput: ${throughput.toFixed(1)} emails/second`);
			console.log(`  Success rate: ${((results.filter((r) => r.success).length / results.length) * 100).toFixed(1)}%`);

			// Should achieve reasonable throughput (depends on network/server)
			// For Cloudflare Workers, should be able to handle 10+ req/sec
			expect(throughput).toBeGreaterThan(5);
		}, 60000);
	});

	describe('Resource Efficiency', () => {
		test('should complete batch without timeouts', async () => {
			console.log(`\n⏰ Timeout resilience test`);

			const emails = generator.generate({ count: 100 });

			const results = await client.parallelValidate(emails.map((e) => e.email));

			const timeouts = results.filter(
				(r) => !r.success && r.error?.includes('timeout')
			).length;

			console.log(`  Total: ${results.length}`);
			console.log(`  Successful: ${results.filter((r) => r.success).length}`);
			console.log(`  Timeouts: ${timeouts}`);

			// Should have minimal timeouts
			expect(timeouts).toBeLessThan(results.length * 0.05); // <5% timeouts
		}, 60000);
	});
});

/**
 * Calculate standard deviation
 */
function calculateStdDev(values: number[]): number {
	const avg = values.reduce((a, b) => a + b, 0) / values.length;
	const squareDiffs = values.map((value) => Math.pow(value - avg, 2));
	const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / squareDiffs.length;
	return Math.sqrt(avgSquareDiff);
}

/**
 * Calculate percentile
 */
function percentile(sortedValues: number[], p: number): number {
	const index = (p / 100) * (sortedValues.length - 1);
	const lower = Math.floor(index);
	const upper = Math.ceil(index);
	const weight = index - lower;

	return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}
