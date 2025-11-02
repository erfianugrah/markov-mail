/**
 * CLI Command: Analyze Risk Weights
 *
 * Analyzes current risk weights and proposes optimized weights based on detector performance.
 */

import { logger } from '../../utils/logger';

export async function analyzeWeights() {
	logger.info('Analyzing risk weights...');

	// Import the analysis logic
	const { analyzeRiskWeights } = await import('../../../scripts/analyze-risk-weights-lib');

	try {
		await analyzeRiskWeights();
		logger.success('Risk weight analysis complete');
	} catch (error) {
		logger.error('Failed to analyze weights:', error);
		throw error;
	}
}

export const command = {
	name: 'analyze:weights',
	description: 'Analyze and optimize risk weights based on detector performance',
	action: analyzeWeights,
};
