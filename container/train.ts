/**
 * Container Entrypoint — Training Server
 *
 * Standalone HTTP server that runs inside a Cloudflare Container.
 * Fetches training data from the Worker's admin API, trains a Random Forest
 * model, runs guardrails, and POSTs the validated model back to the Worker.
 *
 * Can also be run locally: `bun run container/train.ts`
 */

// NOTE: When running in Docker, this file is at /app/train.ts and training
// modules are at /app/src/training/. When running locally from the repo root
// as `bun run container/train.ts`, ../src/ also resolves correctly.
import {
	trainRandomForest,
	parseTrainingDataset,
	type RandomForestConfig,
	type TrainingDatasetJSON,
	type TrainingResult,
	DEFAULT_RF_CONFIG,
} from '../src/training/random-forest';
import {
	runGuardrails,
	type GuardrailResult,
	DEFAULT_GUARDRAIL_CONFIG,
} from '../src/training/guardrails';
import { applyPlattScaling } from '../src/training/platt-scaling';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TrainRequest {
	workerUrl: string;
	apiKey: string;
	config?: Partial<RandomForestConfig>;
}

interface TrainResponse {
	success: boolean;
	message: string;
	durationMs?: number;
	modelVersion?: string;
	stats?: TrainingResult['stats'];
	guardrails?: GuardrailResult;
	error?: string;
}

// ---------------------------------------------------------------------------
// Training pipeline
// ---------------------------------------------------------------------------

async function runTrainingPipeline(req: TrainRequest): Promise<TrainResponse> {
	const startTime = Date.now();

	const config: RandomForestConfig = {
		...DEFAULT_RF_CONFIG,
		...req.config,
	};

	console.log(`[train] Starting training pipeline with config:`, JSON.stringify(config));

	// 1. Fetch training dataset from worker
	console.log(`[train] Fetching dataset from ${req.workerUrl}/admin/training/dataset/download`);

	const datasetRes = await fetch(`${req.workerUrl}/admin/training/dataset/download`, {
		headers: {
			'X-API-KEY': req.apiKey,
			'Accept': 'application/json',
		},
	});

	if (!datasetRes.ok) {
		const errText = await datasetRes.text().catch(() => 'unknown');
		throw new Error(`Failed to fetch training dataset: ${datasetRes.status} ${errText}`);
	}

	const datasetJson: TrainingDatasetJSON = await datasetRes.json();
	console.log(`[train] Dataset loaded: ${datasetJson.samples} samples, ${datasetJson.features.length} features`);

	// 2. Parse into typed arrays
	const dataset = parseTrainingDataset(datasetJson);

	// 3. Train the Random Forest
	console.log(`[train] Training ${config.nTrees} trees, maxDepth=${config.maxDepth}...`);

	const result: TrainingResult = trainRandomForest(dataset, config, (done, total) => {
		console.log(`[train] Tree ${done}/${total} complete`);
	});

	console.log(`[train] Training complete in ${result.durationMs}ms`);
	console.log(`[train] OOB accuracy: ${(result.stats.meanOobAccuracy * 100).toFixed(2)}%`);

	// 4. Compute calibrated OOB predictions for guardrails
	const calibration = result.model.meta.calibration;
	if (!calibration) {
		throw new Error('Model training did not produce calibration coefficients');
	}

	const calibratedScores: number[] = [];
	const labels: number[] = [];

	for (let i = 0; i < result.oobPredictions.length; i++) {
		if (!Number.isNaN(result.oobPredictions[i])) {
			calibratedScores.push(
				applyPlattScaling(result.oobPredictions[i], calibration.coef, calibration.intercept)
			);
			labels.push(dataset.labels[i]);
		}
	}

	// 5. Run guardrails
	console.log(`[train] Running guardrails on ${calibratedScores.length} OOB predictions...`);

	const guardrailResult = runGuardrails(
		result.model,
		calibratedScores,
		labels,
		DEFAULT_GUARDRAIL_CONFIG,
	);

	if (!guardrailResult.passed) {
		console.error(`[train] Guardrails FAILED:`, guardrailResult.failures);
		return {
			success: false,
			message: 'Guardrails failed — model NOT uploaded',
			durationMs: Date.now() - startTime,
			modelVersion: result.model.meta.version,
			stats: result.stats,
			guardrails: guardrailResult,
			error: guardrailResult.failures.join('; '),
		};
	}

	console.log(`[train] Guardrails passed. Recommended thresholds: warn=${guardrailResult.recommendation?.warnThreshold}, block=${guardrailResult.recommendation?.blockThreshold}`);

	// 6. Upload model to worker
	console.log(`[train] Uploading model to ${req.workerUrl}/admin/training/model`);

	const uploadRes = await fetch(`${req.workerUrl}/admin/training/model`, {
		method: 'POST',
		headers: {
			'X-API-KEY': req.apiKey,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(result.model),
	});

	if (!uploadRes.ok) {
		const errText = await uploadRes.text().catch(() => 'unknown');
		throw new Error(`Failed to upload model: ${uploadRes.status} ${errText}`);
	}

	const uploadResult = await uploadRes.json();
	console.log(`[train] Model uploaded successfully:`, uploadResult);

	// 7. Prune old training samples (data already consumed, free up D1 space)
	try {
		console.log(`[train] Pruning old training samples...`);
		await fetch(`${req.workerUrl}/admin/training/dataset`, {
			method: 'DELETE',
			headers: {
				'X-API-KEY': req.apiKey,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ olderThanDays: 14 }),
		});
	} catch (pruneErr) {
		console.warn(`[train] Failed to prune training samples:`, pruneErr);
	}

	const totalDuration = Date.now() - startTime;
	console.log(`[train] Pipeline complete in ${totalDuration}ms`);

	return {
		success: true,
		message: 'Model trained, validated, and deployed',
		durationMs: totalDuration,
		modelVersion: result.model.meta.version,
		stats: result.stats,
		guardrails: guardrailResult,
	};
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT ?? '8787', 10);

const server = Bun.serve({
	port: PORT,
	async fetch(req: Request): Promise<Response> {
		const url = new URL(req.url);

		// Health check
		if (url.pathname === '/health' && req.method === 'GET') {
			return Response.json({ status: 'ok', service: 'trainer-container' });
		}

		// Training endpoint
		if (url.pathname === '/train' && req.method === 'POST') {
			try {
				const body: TrainRequest = await req.json();

				if (!body.workerUrl || !body.apiKey) {
					return Response.json(
						{ success: false, error: 'Missing required fields: workerUrl, apiKey' },
						{ status: 400 },
					);
				}

				const result = await runTrainingPipeline(body);
				return Response.json(result, {
					status: result.success ? 200 : 422,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(`[train] Pipeline error:`, message);
				return Response.json(
					{ success: false, error: message },
					{ status: 500 },
				);
			}
		}

		return Response.json(
			{ error: 'Not found', routes: ['GET /health', 'POST /train'] },
			{ status: 404 },
		);
	},
});

console.log(`[trainer] Listening on port ${PORT}`);
