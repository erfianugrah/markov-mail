/**
 * Generate Test Data Command
 */

import { logger } from '../../utils/logger.ts';
import { parseArgs, getOption, hasFlag } from '../../utils/args.ts';
import { $ } from 'bun';

export default async function generate(args: string[]) {
  const parsed = parseArgs(args);

  if (hasFlag(parsed, 'help', 'h')) {
    console.log(`
╔════════════════════════════════════════════════════════╗
║              Generate Test Data                        ║
╚════════════════════════════════════════════════════════╝

Generate fraudulent email test datasets.

USAGE
  npm run cli test:generate [options]

OPTIONS
  --count <n>           Number of emails to generate (default: 100)
  --patterns <list>     Comma-separated pattern list
  --help, -h            Show this help message

EXAMPLES
  npm run cli test:generate --count 500
  npm run cli test:generate --patterns sequential,dated,gibberish
`);
    return;
  }

  const count = parseInt(getOption(parsed, 'count') || '100');

  logger.section('🧪 Generating Test Data');
  logger.info(`Count: ${count}`);

  try {
    await $`node scripts/generate-fraudulent-emails.js ${count}`;
    logger.success('✨ Test data generated!');
  } catch (error) {
    logger.error(`Generation failed: ${error}`);
    process.exit(1);
  }
}
