/**
 * Training Module
 *
 * Hand-rolled Random Forest training pipeline for automated retraining
 * inside a Cloudflare Container. No external ML libraries required.
 *
 * Exports:
 *   - CART decision tree trainer
 *   - Random Forest trainer (bagging + OOB)
 *   - Platt scaling calibration
 *   - Guardrails (threshold verification)
 */

export { trainCART, type CARTConfig, type CARTTrainResult, DEFAULT_CART_CONFIG } from './cart';
export {
	trainRandomForest,
	parseTrainingDataset,
	type RandomForestConfig,
	type TrainingDataset,
	type TrainingDatasetJSON,
	type TrainingResult,
	type TrainingStats,
	DEFAULT_RF_CONFIG,
} from './random-forest';
export {
	fitPlattScaling,
	applyPlattScaling,
	type PlattCoefficients,
	type PlattConfig,
	DEFAULT_PLATT_CONFIG,
} from './platt-scaling';
export {
	runGuardrails,
	scanThresholds,
	type GuardrailConfig,
	type GuardrailResult,
	type ThresholdEntry,
	type ThresholdRecommendation,
	DEFAULT_GUARDRAIL_CONFIG,
} from './guardrails';
