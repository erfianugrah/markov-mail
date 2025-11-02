/**
 * Deployment Status Command
 */

import { logger } from '../../utils/logger.ts';
import { $ } from 'bun';

export default async function status() {
  logger.section('📊 Deployment Status');

  try {
    logger.info('Fetching deployment information...\n');
    await $`npx wrangler deployments list`;
  } catch (error) {
    logger.error(`Failed to fetch status: ${error}`);
    process.exit(1);
  }
}
