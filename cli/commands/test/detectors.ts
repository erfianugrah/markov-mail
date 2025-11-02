/**
 * Test Detectors Command
 */

import { logger } from '../../utils/logger.ts';
import { $ } from 'bun';

export default async function detectors() {
  logger.section('🧪 Testing Pattern Detectors');

  try {
    await $`node scripts/test-detectors.js`;
  } catch (error) {
    logger.error(`Test failed: ${error}`);
    process.exit(1);
  }
}
