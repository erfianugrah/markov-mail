/**
 * CLI Command: Analyze Risk Weights
 *
 * Analyzes current risk weights and proposes optimized weights based on detector performance.
 */

import { logger } from '../../utils/logger';

export async function analyzeWeights() {
	logger.section('📉 Risk weight analysis');
	logger.warn('This command was replaced by the offline decision-tree workflow.');
	logger.info('Export features via `features:export`, retrain the tree, and compare D1 metrics instead.');
	throw new Error('analyze:weights is deprecated in the reset branch.');
}

export const command = {
	name: 'analyze:weights',
	description: 'Analyze and optimize risk weights based on detector performance',
	action: analyzeWeights,
};
