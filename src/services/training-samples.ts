/**
 * Training Samples Service
 *
 * Collects feature vectors from live validations into D1 for automated
 * retraining. Every /validate call stores its 48-feature vector + an
 * auto-assigned label so the training container can pull a fresh dataset
 * directly from D1 without any manual CSV pipeline.
 *
 * Labels are assigned based on:
 *   - Known disposable domain → fraud (1), source 'known_disposable'
 *   - Known free provider + low score → legit (0), source 'known_provider'
 *   - Model decision (block → 1, allow → 0), source 'model'
 *   - Warn zone (ambiguous) → still stored with model decision
 */

import { logger } from '../logger';
import type { FeatureVector } from '../utils/feature-vector';
import type { TrainingDatasetJSON } from '../training/random-forest';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrainingSampleInput {
	emailHash: string;
	featureVector: FeatureVector;
	riskScore: number;
	decision: 'allow' | 'warn' | 'block';
	isDisposable: boolean;
	isFreeProvider: boolean;
	modelVersion: string;
}

// ---------------------------------------------------------------------------
// Write: store a training sample from a validation
// ---------------------------------------------------------------------------

/**
 * Persist a feature vector + label to D1 for retraining.
 * Uses INSERT OR REPLACE so the same email (by hash) gets updated
 * with the latest model's assessment.
 */
export async function writeTrainingSample(
	db: D1Database,
	input: TrainingSampleInput,
): Promise<void> {
	try {
		// Determine label + source
		let label: 0 | 1;
		let labelSource: string;

		if (input.isDisposable) {
			label = 1;
			labelSource = 'known_disposable';
		} else if (input.isFreeProvider && input.riskScore < 0.2) {
			label = 0;
			labelSource = 'known_provider';
		} else {
			label = input.decision === 'block' ? 1 : input.decision === 'allow' ? 0 : (input.riskScore >= 0.5 ? 1 : 0);
			labelSource = 'model';
		}

		await db.prepare(
			`INSERT OR REPLACE INTO training_samples
			 (email_hash, feature_vector, label, label_source, risk_score, decision, model_version)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
		).bind(
			input.emailHash,
			JSON.stringify(input.featureVector),
			label,
			labelSource,
			input.riskScore,
			input.decision,
			input.modelVersion,
		).run();
	} catch (error) {
		// Non-fatal — never block the validation response
		logger.error({
			event: 'training_sample_write_failed',
			error: error instanceof Error ? error.message : String(error),
		}, 'Failed to write training sample');
	}
}

// ---------------------------------------------------------------------------
// Read: assemble training dataset from D1
// ---------------------------------------------------------------------------

/**
 * Build a TrainingDatasetJSON from all samples in D1.
 * This is what the container fetches via GET /admin/training/dataset/download.
 */
export async function buildTrainingDataset(
	db: D1Database,
	limit?: number,
): Promise<TrainingDatasetJSON> {
	// Include label_source so we can priority-weight manual corrections
	const query = limit
		? `SELECT feature_vector, label, label_source FROM training_samples WHERE feature_vector != '{}' ORDER BY timestamp DESC LIMIT ?`
		: `SELECT feature_vector, label, label_source FROM training_samples WHERE feature_vector != '{}' ORDER BY timestamp DESC`;

	const result = limit
		? await db.prepare(query).bind(limit).all()
		: await db.prepare(query).all();

	const rawRows = (result.results ?? []) as { feature_vector: string; label: number; label_source: string }[];

	if (rawRows.length === 0) {
		return {
			version: new Date().toISOString().slice(0, 10),
			created: new Date().toISOString(),
			samples: 0,
			features: [],
			rows: [],
		};
	}

	// Extract sorted feature names from the first row
	const firstVector = JSON.parse(rawRows[0].feature_vector) as Record<string, number>;
	const featureNames = Object.keys(firstVector).sort();

	// Manual labels get 5x weight in training to break the feedback loop
	// where the model trains on its own mistakes
	const MANUAL_WEIGHT = 5;

	const rows = rawRows.map(row => {
		const vec = JSON.parse(row.feature_vector) as Record<string, number>;
		return {
			features: featureNames.map(f => vec[f] ?? 0),
			label: (row.label === 1 ? 1 : 0) as 0 | 1,
			weight: row.label_source === 'manual' ? MANUAL_WEIGHT : 1,
		};
	});

	return {
		version: new Date().toISOString().slice(0, 10),
		created: new Date().toISOString(),
		samples: rows.length,
		features: featureNames,
		rows,
	};
}

/**
 * Get sample counts and metadata without loading the full dataset.
 */
export async function getTrainingSampleStats(
	db: D1Database,
): Promise<{
	total: number;
	fraud: number;
	legit: number;
	sources: Record<string, number>;
	oldestTimestamp: string | null;
	newestTimestamp: string | null;
}> {
	const [countResult, sourceResult, timeResult] = await Promise.all([
		db.prepare(
			`SELECT label, COUNT(*) as cnt FROM training_samples GROUP BY label`
		).all(),
		db.prepare(
			`SELECT label_source, COUNT(*) as cnt FROM training_samples GROUP BY label_source`
		).all(),
		db.prepare(
			`SELECT MIN(timestamp) as oldest, MAX(timestamp) as newest FROM training_samples`
		).first(),
	]);

	let fraud = 0;
	let legit = 0;
	for (const row of (countResult.results ?? []) as { label: number; cnt: number }[]) {
		if (row.label === 1) fraud = row.cnt;
		else legit = row.cnt;
	}

	const sources: Record<string, number> = {};
	for (const row of (sourceResult.results ?? []) as { label_source: string; cnt: number }[]) {
		sources[row.label_source] = row.cnt;
	}

	const time = timeResult as { oldest: string | null; newest: string | null } | null;

	return {
		total: fraud + legit,
		fraud,
		legit,
		sources,
		oldestTimestamp: time?.oldest ?? null,
		newestTimestamp: time?.newest ?? null,
	};
}

// ---------------------------------------------------------------------------
// Prune: clean up old samples after training
// ---------------------------------------------------------------------------

/**
 * Delete training samples older than the given number of days.
 * Called by the weekly cron after the container finishes training.
 * Returns the number of rows deleted.
 */
export async function pruneTrainingSamples(
	db: D1Database,
	olderThanDays: number = 14,
): Promise<number> {
	const result = await db.prepare(
		`DELETE FROM training_samples
		 WHERE timestamp < datetime('now', ? || ' days')`
	).bind(-olderThanDays).run();

	const deleted = result.meta?.changes ?? 0;

	logger.info({
		event: 'training_samples_pruned',
		deleted,
		olderThanDays,
	}, `Pruned ${deleted} training samples older than ${olderThanDays} days`);

	return deleted;
}
