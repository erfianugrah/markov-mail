/**
 * Configuration Management Command
 */

import { logger } from '../../utils/logger.ts';
import { parseArgs, getOption, hasFlag } from '../../utils/args.ts';
import { $ } from 'bun';
import { resolve } from 'path';
import { existsSync } from 'fs';

export default async function config(args: string[]) {
  const parsed = parseArgs(args);
  const command = process.argv[2]; // Get the full command like "config:set"

  // Check for help flag
  if (hasFlag(parsed, 'help', 'h')) {
    console.log(`
╔════════════════════════════════════════════════════════╗
║          Configuration Management                      ║
╚════════════════════════════════════════════════════════╝

Manage configuration stored in Cloudflare KV.

USAGE
  npm run cli config:<command> [options]

COMMANDS
  config:get <key>           Get configuration value
  config:set <key> <value>   Set configuration value
  config:list                List all configuration
  config:upload <path>       Overwrite config.json with local file
  config:sync                Sync local config to KV (not implemented)

OPTIONS
  --binding <name>           KV binding name (default: CONFIG)
  --help, -h                 Show this help message

EXAMPLES
  # Get a configuration value
  npm run cli config:get riskWeights.domainReputation

  # Set a configuration value
  npm run cli config:set riskWeights.domainReputation 0.25

  # List all configuration
  npm run cli config:list

  # Use custom binding
  npm run cli config:get mykey --binding MY_CONFIG
    `);
    return;
  }

  const binding = getOption(parsed, 'binding') || 'CONFIG';

  logger.section('⚙️  Configuration Management');
  logger.info(`Binding: ${binding}`);

  if (command?.includes('config:get')) {
    const key = parsed.positional[0];
    if (!key) {
      logger.error('❌ Key is required');
      return;
    }

    try {
      const result = await $`npx wrangler kv key get config.json --binding=${binding}`.text();
      const configData = JSON.parse(result);

      if (!configData) {
        logger.error('❌ No configuration found in KV');
        return;
      }

      // Navigate to nested key (e.g., "riskWeights.domainReputation")
      const keyParts = key.split('.');
      let value: any = configData;
      for (const part of keyParts) {
        value = value?.[part];
      }

      if (value === undefined) {
        logger.error(`❌ Key not found: ${key}`);
        return;
      }

      logger.success(`✓ ${key} = ${JSON.stringify(value, null, 2)}`);
    } catch (error) {
      logger.error(`❌ Failed to get config: ${error}`);
    }
  } else if (command?.includes('config:set')) {
    const key = parsed.positional[0];
    const valueStr = parsed.positional[1];

    if (!key || valueStr === undefined) {
      logger.error('❌ Key and value are required');
      logger.info('Usage: npm run cli -- config:set <key> <value>');
      logger.info('Example: npm run cli -- config:set riskWeights.domainReputation 0.25');
      return;
    }

    try {
      // Parse value (handle numbers, booleans, JSON objects)
      let value: any;
      try {
        value = JSON.parse(valueStr);
      } catch {
        value = valueStr; // Keep as string if not JSON
      }

      // Get current config
      const result = await $`npx wrangler kv key get config.json --binding=${binding}`.text();
      const configData = JSON.parse(result || '{}');

      // Navigate and set nested key
      const keyParts = key.split('.');
      let target: any = configData;
      for (let i = 0; i < keyParts.length - 1; i++) {
        const part = keyParts[i];
        if (!target[part]) {
          target[part] = {};
        }
        target = target[part];
      }
      target[keyParts[keyParts.length - 1]] = value;

      // Write to temp file and upload
      const tempFile = `/tmp/config-${Date.now()}.json`;
      await Bun.write(tempFile, JSON.stringify(configData, null, 2));

      await $`npx wrangler kv key put config.json --path=${tempFile} --binding=${binding} --remote`;

      // Clean up temp file
      await $`rm ${tempFile}`;

      logger.success(`✓ Updated: ${key} = ${JSON.stringify(value)}`);
      logger.info('Configuration updated in KV successfully');
    } catch (error) {
      logger.error(`❌ Failed to set config: ${error}`);
    }
  } else if (command?.includes('config:list')) {
    try {
      const result = await $`npx wrangler kv key get config.json --binding=${binding}`.text();
      const configData = JSON.parse(result);

      if (!configData) {
        logger.error('❌ No configuration found in KV');
        return;
      }

      logger.success('📋 Current Configuration:');
      console.log(JSON.stringify(configData, null, 2));
    } catch (error) {
      logger.error(`❌ Failed to list config: ${error}`);
    }
  } else if (command?.includes('config:upload')) {
    const filePath = parsed.positional[0];
    if (!filePath) {
      logger.error('❌ File path is required');
      logger.info('Usage: npm run cli config:upload <path-to-json>');
      return;
    }

    try {
      const resolvedPath = resolve(filePath);
      await $`npx wrangler kv key put config.json --path=${resolvedPath} --binding=${binding} --remote`;
      logger.success(`✅ Uploaded ${filePath} to config.json`);
    } catch (error) {
      logger.error(`❌ Failed to upload config: ${error}`);
    }
  } else if (command?.includes('config:sync')) {
    const configPath = resolve(getOption(parsed, 'config') ?? 'config/production/config.json');
    const heuristicsPath = getOption(parsed, 'heuristics', 'risk-heuristics');
    const resolvedHeuristicsPath = heuristicsPath ? resolve(heuristicsPath) : resolve('config/risk-heuristics.json');
    const dryRun = hasFlag(parsed, 'dry-run');

    if (!existsSync(configPath)) {
      logger.error(`❌ Config file not found: ${configPath}`);
      return;
    }

    if (!existsSync(resolvedHeuristicsPath)) {
      logger.error(`❌ Risk heuristics file not found: ${resolvedHeuristicsPath}`);
      return;
    }

    if (dryRun) {
      logger.info(`[dry-run] Would upload ${configPath} → config.json`);
      logger.info(`[dry-run] Would upload ${resolvedHeuristicsPath} → risk-heuristics.json`);
      return;
    }

    try {
      logger.info(`Uploading ${configPath} → config.json`);
      await $`npx wrangler kv key put config.json --path=${configPath} --binding=${binding} --remote`;
      logger.success('✅ config.json updated');

      logger.info(`Uploading ${resolvedHeuristicsPath} → risk-heuristics.json`);
      await $`npx wrangler kv key put risk-heuristics.json --path=${resolvedHeuristicsPath} --binding=${binding} --remote`;
      logger.success('✅ risk-heuristics.json updated');
    } catch (error) {
      logger.error(`❌ Failed to sync config: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
  } else {
    logger.error('❌ Unknown config command');
    logger.info('Available commands: config:get, config:set, config:list');
  }
}
