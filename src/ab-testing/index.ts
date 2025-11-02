/**
 * A/B Testing Framework
 *
 * Enables data-driven optimization through controlled experiments.
 *
 * Usage:
 * 1. Create experiment config via CLI or Admin API
 * 2. Config stored in Workers KV
 * 3. Each request assigned to variant based on fingerprint hash
 * 4. Analytics track variant performance
 * 5. Promote winning variant after statistical validation
 */

export * from './types';
export * from './assignment';
export * from './config-loader';
