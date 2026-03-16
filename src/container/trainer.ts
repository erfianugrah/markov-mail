/**
 * TrainerContainer — Durable Object wrapping the training container
 *
 * Extends the Container class from @cloudflare/containers to manage
 * the lifecycle of the model training container. The container runs
 * a Bun HTTP server (container/train.ts) that fetches data from the
 * Worker, trains a Random Forest, and POSTs the result back.
 *
 * Usage from the scheduled handler or admin API:
 *   const container = getContainer(env.TRAINER, 'trainer');
 *   const res = await container.fetch('http://container/train', { method: 'POST', ... });
 */

import { Container } from '@cloudflare/containers';

export class TrainerContainer extends Container {
	defaultPort = 8787;

	// After 30 seconds of idle (no incoming requests), the container is
	// automatically stopped. Training typically completes in <10s for
	// small datasets, so 30s provides generous headroom.
	sleepAfter = '30s';

	override onStart(): void {
		console.log('[TrainerContainer] Container started');
	}

	override onStop(params: { exitCode: number; reason: string }): void {
		if (params.exitCode === 0) {
			console.log('[TrainerContainer] Container stopped gracefully');
		} else {
			console.error(
				`[TrainerContainer] Container stopped with exit code ${params.exitCode}: ${params.reason}`
			);
		}
	}

	override onError(error: string): void {
		console.error(`[TrainerContainer] Container error: ${error}`);
	}
}
