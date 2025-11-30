/**
 * Test Detectors Command
 */

import { logger } from '../../utils/logger.ts';
import { $ } from 'bun';

export default async function detectors() {
  logger.section('🧪 Testing Pattern Detectors');

  try {
    await $`VITEST_CLOUDFLARE_POOL=off bun x vitest tests/unit/detectors/pattern-detectors.test.ts`;
  } catch (error) {
    logger.error(`Test failed: ${error}`);
    process.exit(1);
  }
}
