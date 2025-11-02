/**
 * KV Management Commands
 */

import { logger } from '../../utils/logger.ts';
import { parseArgs, getOption, hasFlag, requireOption } from '../../utils/args.ts';
import { $ } from 'bun';

async function list(args: string[]) {
  const parsed = parseArgs(args);
  const binding = getOption(parsed, 'binding') || 'CONFIG';
  const prefix = getOption(parsed, 'prefix');
  const remote = hasFlag(parsed, 'remote') ? '--remote' : '';

  logger.section(`📋 Listing KV Keys (${binding})`);

  try {
    const cmd = prefix
      ? `npx wrangler kv key list --binding=${binding} --prefix=${prefix} ${remote}`
      : `npx wrangler kv key list --binding=${binding} ${remote}`;

    await $`${cmd.split(' ')}`;
  } catch (error) {
    logger.error(`Failed to list keys: ${error}`);
    process.exit(1);
  }
}

async function get(args: string[]) {
  const parsed = parseArgs(args);
  const key = parsed.positional[0];

  if (!key) {
    logger.error('Key is required');
    console.log('\nUsage: npm run cli kv:get <key> [--binding <name>]');
    process.exit(1);
  }

  const binding = getOption(parsed, 'binding') || 'CONFIG';
  const remote = hasFlag(parsed, 'remote') ? '--remote' : '';

  logger.section(`🔍 Getting KV Value`);
  logger.info(`Key: ${key}`);
  logger.info(`Binding: ${binding}\n`);

  try {
    await $`npx wrangler kv key get ${key} --binding=${binding} ${remote}`;
  } catch (error) {
    logger.error(`Failed to get key: ${error}`);
    process.exit(1);
  }
}

async function put(args: string[]) {
  const parsed = parseArgs(args);
  const key = parsed.positional[0];
  const value = parsed.positional[1];
  const file = getOption(parsed, 'file');

  if (!key || (!value && !file)) {
    logger.error('Key and value/file are required');
    console.log('\nUsage: npm run cli kv:put <key> <value|--file <path>> [--binding <name>]');
    process.exit(1);
  }

  const binding = getOption(parsed, 'binding') || 'CONFIG';
  const remote = hasFlag(parsed, 'remote') ? '--remote' : '';

  logger.section(`💾 Putting KV Value`);
  logger.info(`Key: ${key}`);
  logger.info(`Binding: ${binding}`);

  try {
    if (file) {
      logger.info(`File: ${file}\n`);
      await $`npx wrangler kv key put ${key} --path=${file} --binding=${binding} ${remote}`;
    } else {
      logger.info(`Value: ${value}\n`);
      await $`npx wrangler kv key put ${key} ${value} --binding=${binding} ${remote}`;
    }
    logger.success('✨ Value stored successfully!');
  } catch (error) {
    logger.error(`Failed to put key: ${error}`);
    process.exit(1);
  }
}

async function del(args: string[]) {
  const parsed = parseArgs(args);
  const key = parsed.positional[0];

  if (!key) {
    logger.error('Key is required');
    console.log('\nUsage: npm run cli kv:delete <key> [--binding <name>]');
    process.exit(1);
  }

  const binding = getOption(parsed, 'binding') || 'CONFIG';
  const remote = hasFlag(parsed, 'remote') ? '--remote' : '';

  logger.section(`🗑️  Deleting KV Key`);
  logger.info(`Key: ${key}`);
  logger.info(`Binding: ${binding}\n`);

  try {
    await $`npx wrangler kv key delete ${key} --binding=${binding} ${remote}`;
    logger.success('✨ Key deleted successfully!');
  } catch (error) {
    logger.error(`Failed to delete key: ${error}`);
    process.exit(1);
  }
}

export default async function kv(args: string[]) {
  const parsed = parseArgs(args);

  if (hasFlag(parsed, 'help', 'h') || args.length === 0) {
    console.log(`
╔════════════════════════════════════════════════════════╗
║               KV Management                            ║
╚════════════════════════════════════════════════════════╝

Manage Cloudflare Workers KV storage.

USAGE
  npm run cli kv:<command> [options]

COMMANDS
  kv:list                List all keys
  kv:get <key>           Get value for key
  kv:put <key> <value>   Put value for key
  kv:delete <key>        Delete key

OPTIONS
  --binding <name>       KV binding name (default: CONFIG)
  --prefix <prefix>      Filter keys by prefix (list only)
  --file <path>          Read value from file (put only)
  --remote               Use remote KV (default: local)
  --help, -h             Show this help message

EXAMPLES
  npm run cli kv:list --binding MARKOV_MODEL
  npm run cli kv:get detector_config --remote
  npm run cli kv:put mykey myvalue --binding CONFIG --remote
  npm run cli kv:put model --file model.json --binding MARKOV_MODEL --remote
  npm run cli kv:delete oldkey --remote
`);
    return;
  }

  // Route to subcommand based on how it was called
  const command = process.argv[3]; // Get the original command
  if (command.includes(':list')) {
    await list(args);
  } else if (command.includes(':get')) {
    await get(args);
  } else if (command.includes(':put')) {
    await put(args);
  } else if (command.includes(':delete')) {
    await del(args);
  }
}
