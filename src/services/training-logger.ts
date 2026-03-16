/**
 * Training Metrics Logger
 *
 * Logs training pipeline events to the D1 `training_metrics` table.
 * Used by both the admin API endpoints and the container training pipeline
 * to maintain a complete audit trail of retraining runs.
 */

import { logger } from '../logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TrainingEvent =
	| 'training_started'
	| 'training_completed'
	| 'training_failed'
	| 'validation_passed'
	| 'validation_failed'
	| 'lock_acquired'
	| 'lock_failed'
	| 'anomaly_detected'
	| 'candidate_created'
	| 'data_pruned';

export type TriggerType = 'scheduled' | 'manual' | 'online';

export interface TrainingMetricsEntry {
	event: TrainingEvent;
	model_version?: string;
	trigger_type?: TriggerType;
	fraud_count?: number;
	legit_count?: number;
	total_samples?: number;
	training_duration?: number;
	accuracy?: number;
	precision_metric?: number;
	recall?: number;
	f1_score?: number;
	false_positive_rate?: number;
	anomaly_score?: number;
	anomaly_type?: string;
	error_message?: string;
	error_type?: string;
}

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

/**
 * Log a training event to the D1 `training_metrics` table.
 *
 * This is a best-effort operation — failures are logged but do not throw,
 * so the training pipeline is never blocked by a logging failure.
 */
export async function logTrainingEvent(
	db: D1Database,
	entry: TrainingMetricsEntry,
): Promise<void> {
	try {
		await db.prepare(
			`INSERT INTO training_metrics (
				event, model_version, trigger_type,
				fraud_count, legit_count, total_samples,
				training_duration, accuracy, precision_metric,
				recall, f1_score, false_positive_rate,
				anomaly_score, anomaly_type,
				error_message, error_type
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		).bind(
			entry.event,
			entry.model_version ?? null,
			entry.trigger_type ?? null,
			entry.fraud_count ?? null,
			entry.legit_count ?? null,
			entry.total_samples ?? null,
			entry.training_duration ?? null,
			entry.accuracy ?? null,
			entry.precision_metric ?? null,
			entry.recall ?? null,
			entry.f1_score ?? null,
			entry.false_positive_rate ?? null,
			entry.anomaly_score ?? null,
			entry.anomaly_type ?? null,
			entry.error_message ?? null,
			entry.error_type ?? null,
		).run();

		logger.info({
			event: 'training_metric_logged',
			training_event: entry.event,
			model_version: entry.model_version,
		}, `Training event logged: ${entry.event}`);
	} catch (error) {
		// Non-fatal: log but do not throw
		logger.error({
			event: 'training_metric_log_failed',
			training_event: entry.event,
			error: error instanceof Error ? error.message : String(error),
		}, `Failed to log training event: ${entry.event}`);
	}
}

/**
 * Log the start of a training run.
 */
export async function logTrainingStarted(
	db: D1Database,
	triggerType: TriggerType,
	modelVersion?: string,
): Promise<void> {
	await logTrainingEvent(db, {
		event: 'training_started',
		trigger_type: triggerType,
		model_version: modelVersion,
	});
}

/**
 * Log a successful training completion.
 */
export async function logTrainingCompleted(
	db: D1Database,
	params: {
		modelVersion: string;
		triggerType: TriggerType;
		fraudCount: number;
		legitCount: number;
		totalSamples: number;
		trainingDurationSecs: number;
		accuracy: number;
		precision?: number;
		recall?: number;
		f1Score?: number;
		fpr?: number;
	},
): Promise<void> {
	await logTrainingEvent(db, {
		event: 'training_completed',
		model_version: params.modelVersion,
		trigger_type: params.triggerType,
		fraud_count: params.fraudCount,
		legit_count: params.legitCount,
		total_samples: params.totalSamples,
		training_duration: params.trainingDurationSecs,
		accuracy: params.accuracy,
		precision_metric: params.precision,
		recall: params.recall,
		f1_score: params.f1Score,
		false_positive_rate: params.fpr,
	});
}

/**
 * Log a training failure.
 */
export async function logTrainingFailed(
	db: D1Database,
	params: {
		triggerType: TriggerType;
		errorMessage: string;
		errorType?: string;
		modelVersion?: string;
	},
): Promise<void> {
	await logTrainingEvent(db, {
		event: 'training_failed',
		trigger_type: params.triggerType,
		error_message: params.errorMessage,
		error_type: params.errorType,
		model_version: params.modelVersion,
	});
}

/**
 * Log guardrail validation results.
 */
export async function logValidationResult(
	db: D1Database,
	params: {
		passed: boolean;
		modelVersion: string;
		accuracy?: number;
		precision?: number;
		recall?: number;
		f1Score?: number;
		fpr?: number;
		errorMessage?: string;
	},
): Promise<void> {
	await logTrainingEvent(db, {
		event: params.passed ? 'validation_passed' : 'validation_failed',
		model_version: params.modelVersion,
		accuracy: params.accuracy,
		precision_metric: params.precision,
		recall: params.recall,
		f1_score: params.f1Score,
		false_positive_rate: params.fpr,
		error_message: params.errorMessage,
	});
}

/**
 * Retrieve recent training events from D1.
 */
export async function getTrainingHistory(
	db: D1Database,
	limit = 20,
): Promise<TrainingMetricsEntry[]> {
	const result = await db.prepare(
		`SELECT * FROM training_metrics ORDER BY timestamp DESC LIMIT ?`
	).bind(limit).all();

	return (result.results ?? []) as unknown as TrainingMetricsEntry[];
}
