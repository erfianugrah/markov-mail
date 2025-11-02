/**
 * Test API Command
 */

import { logger } from '../../utils/logger.ts';
import { parseArgs, getOption } from '../../utils/args.ts';

export default async function api(args: string[]) {
  const parsed = parseArgs(args);
  const url = getOption(parsed, 'url') || 'https://your-worker.workers.dev/validate';
  const email = parsed.positional[0] || 'test@example.com';

  logger.section('🧪 Testing API');
  logger.info(`URL: ${url}`);
  logger.info(`Email: ${email}\n`);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    const data = await response.json();
    logger.json(data);
  } catch (error) {
    logger.error(`Test failed: ${error}`);
    process.exit(1);
  }
}
