/**
 * Configuration Management Command
 */

import { logger } from '../../utils/logger.ts';
import { parseArgs } from '../../utils/args.ts';
import { $ } from 'bun';

export default async function config(args: string[]) {
  const parsed = parseArgs(args);
  const command = process.argv[2]; // Get the full command like "config:set"

  logger.section('⚙️  Configuration Management');

  if (command?.includes('config:get')) {
    const key = parsed.positional[0];
    if (!key) {
      logger.error('❌ Key is required');
      return;
    }

    try {
      const result = await $`npx wrangler kv key get config.json --binding=CONFIG`.text();
      const configData = JSON.parse(result);

      if (!configData) {
        logger.error('❌ No configuration found in KV');
        return;
      }

      // Navigate to nested key (e.g., "riskWeights.patternDetection")
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
      logger.info('Example: npm run cli -- config:set riskWeights.patternDetection 0.50');
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
      const result = await $`npx wrangler kv key get config.json --binding=CONFIG`.text();
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

      await $`npx wrangler kv key put config.json --path=${tempFile} --binding=CONFIG --remote`;

      // Clean up temp file
      await $`rm ${tempFile}`;

      logger.success(`✓ Updated: ${key} = ${JSON.stringify(value)}`);
      logger.info('Configuration updated in KV successfully');
    } catch (error) {
      logger.error(`❌ Failed to set config: ${error}`);
    }
  } else if (command?.includes('config:list')) {
    try {
      const result = await $`npx wrangler kv key get config.json --binding=CONFIG`.text();
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
  } else if (command?.includes('config:sync')) {
    logger.info('Syncing configuration to KV');
    logger.warn('Not yet implemented - use config:set to update individual values');
  } else {
    logger.error('❌ Unknown config command');
    logger.info('Available commands: config:get, config:set, config:list');
  }
}
