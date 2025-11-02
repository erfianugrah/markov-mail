/**
 * Deploy Command
 */

import { logger } from '../../utils/logger.ts';
import { parseArgs, hasFlag, getOption } from '../../utils/args.ts';
import { $ } from 'bun';

export default async function deploy(args: string[]) {
  const parsed = parseArgs(args);

  if (hasFlag(parsed, 'help', 'h')) {
    console.log(`
╔════════════════════════════════════════════════════════╗
║               Deploy Worker                            ║
╚════════════════════════════════════════════════════════╝

Deploy the fraud detection worker to Cloudflare.

USAGE
  npm run cli deploy [options]

OPTIONS
  --minify           Minify worker code
  --env <name>       Deploy to specific environment
  --help, -h         Show this help message

EXAMPLES
  npm run cli deploy
  npm run cli deploy --minify
  npm run cli deploy --env production
`);
    return;
  }

  logger.section('🚀 Deploying Worker');

  const minify = hasFlag(parsed, 'minify');
  const env = getOption(parsed, 'env');

  try {
    const args = ['wrangler', 'deploy'];
    if (minify) args.push('--minify');
    if (env) args.push('--env', env);

    logger.info('Running deployment...\n');
    await $`npx ${args}`;

    logger.success('\n✨ Deployment complete!');
  } catch (error) {
    logger.error(`Deployment failed: ${error}`);
    process.exit(1);
  }
}
