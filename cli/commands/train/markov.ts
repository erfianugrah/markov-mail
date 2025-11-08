/**
 * Train Markov Chain Models Command
 *
 * Trains legitimate and fraudulent email pattern models from labeled CSV datasets
 */

import { readFile } from 'fs/promises';
import { parse } from 'csv-parse/sync';
import { NGramMarkovChain } from '../../../src/detectors/ngram-markov.ts';
import { logger } from '../../utils/logger.ts';
import { parseArgs, getOption, hasFlag } from '../../utils/args.ts';
import { $ } from 'bun';

interface TrainingOptions {
  dataset: string;
  output: string;
  upload: boolean;
  remote: boolean;
  orders: number[]; // N-gram orders to train (1, 2, 3)
}

// Removed hardcoded DEFAULT_DATASETS - now scans directory dynamically

function extractLocalPart(sender: string): string | null {
  const emailMatch = sender.match(/<([^>]+)>/) || sender.match(/([^\s]+@[^\s]+)/);
  if (!emailMatch) return null;

  const email = emailMatch[1];
  const localPart = email.split('@')[0];

  if (!localPart || localPart.length < 2 || localPart.length > 64) {
    return null;
  }

  return localPart;
}

async function loadCSV(filepath: string): Promise<{ legit: string[], fraud: string[] }> {
  logger.debug(`Loading ${filepath}...`);

  try {
    const content = await readFile(filepath, 'utf-8');
    const records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      relax_quotes: true,
      relax_column_count: true,
    }) as Array<Record<string, any>>;

    const legit: string[] = [];
    const fraud: string[] = [];

    for (const record of records) {
      if (!record.sender && !record.Email && !record.email) continue;

      const sender = record.sender || record.Email || record.email || '';
      const label = record.label || (record['Email Type'] === 'Phishing Email' ? 1 : 0);

      const localPart = extractLocalPart(sender);

      if (localPart) {
        if (parseInt(label) === 1) {
          fraud.push(localPart);
        } else {
          legit.push(localPart);
        }
      }
    }

    logger.info(`  ✓ Loaded ${legit.length} legit + ${fraud.length} fraud samples`);
    return { legit, fraud };

  } catch (error) {
    logger.error(`  ✗ Error loading ${filepath}: ${error}`);
    return { legit: [], fraud: [] };
  }
}

async function uploadModelsToKV(
  files: Array<{ order: number; legitFile: string; fraudFile: string }>,
  remote: boolean
) {
  logger.section('📤 Uploading to Cloudflare KV');

  const remoteFlag = remote ? '--remote' : '';

  try {
    for (const { order, legitFile, fraudFile } of files) {
      logger.info(`Uploading ${order}-gram legitimate model...`);
      const legitKey = `MM_legit_${order}gram`;
      await $`npx wrangler kv key put ${legitKey} --path=${legitFile} --binding=MARKOV_MODEL ${remoteFlag}`.quiet();
      logger.success(`${order}-gram legitimate model uploaded (${legitKey})`);

      logger.info(`Uploading ${order}-gram fraudulent model...`);
      const fraudKey = `MM_fraud_${order}gram`;
      await $`npx wrangler kv key put ${fraudKey} --path=${fraudFile} --binding=MARKOV_MODEL ${remoteFlag}`.quiet();
      logger.success(`${order}-gram fraudulent model uploaded (${fraudKey})`);
    }

    logger.success('✨ All models uploaded to KV successfully!');
  } catch (error) {
    logger.error(`Failed to upload models: ${error}`);
    throw error;
  }
}

export default async function trainMarkov(args: string[]) {
  const parsed = parseArgs(args);

  if (hasFlag(parsed, 'help', 'h')) {
    console.log(`
╔════════════════════════════════════════════════════════╗
║          Train Markov Chain Models                     ║
╚════════════════════════════════════════════════════════╝

Trains separate Markov Chain models for legitimate and fraudulent
email address patterns from labeled CSV datasets.

USAGE
  npm run cli train:markov [options]

OPTIONS
  --dataset <path>    Path to dataset directory (default: ./dataset)
  --output <path>     Output directory for models (default: ./)
  --orders <list>     Comma-separated n-gram orders to train (default: "2")
                      Valid orders: 1 (unigram), 2 (bigram), 3 (trigram)
  --upload            Upload models to KV after training
  --remote            Use remote KV (requires --upload)
  --help, -h          Show this help message

EXAMPLES
  # Train with default 2-gram model
  npm run cli train:markov

  # Train ensemble: 1-gram, 2-gram, and 3-gram models
  npm run cli train:markov --orders "1,2,3"

  # Train and upload to remote KV
  npm run cli train:markov --orders "1,2,3" --upload --remote

  # Use custom dataset
  npm run cli train:markov --dataset ./my-datasets --orders "2,3"
`);
    return;
  }

  // Parse orders option
  const ordersStr = getOption(parsed, 'orders') || '2';
  const orders = ordersStr
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => n >= 1 && n <= 3);

  if (orders.length === 0) {
    logger.error('Invalid --orders value. Must be comma-separated list of 1, 2, or 3');
    logger.error('Examples: --orders "2" or --orders "1,2,3"');
    process.exit(1);
  }

  const options: TrainingOptions = {
    dataset: getOption(parsed, 'dataset') || './dataset',
    output: getOption(parsed, 'output') || './',
    upload: hasFlag(parsed, 'upload'),
    remote: hasFlag(parsed, 'remote'),
    orders: orders
  };

  logger.section('🚀 Markov Chain Model Training');
  logger.info(`N-gram orders: ${options.orders.join(', ')}`);

  // Load datasets - scan directory for CSV files
  logger.subsection('Loading Datasets');
  let allLegit: string[] = [];
  let allFraud: string[] = [];

  // Get all CSV files in the dataset directory
  const { readdirSync } = await import('fs');
  const { join } = await import('path');

  try {
    const files = readdirSync(options.dataset)
      .filter(f => f.endsWith('.csv'))
      .map(f => join(options.dataset, f));

    logger.info(`Found ${files.length} CSV files in ${options.dataset}`);

    for (const file of files) {
      const { legit, fraud } = await loadCSV(file);
      allLegit.push(...legit);
      allFraud.push(...fraud);
    }
  } catch (error) {
    logger.error(`Failed to read dataset directory: ${error}`);
    throw error;
  }

  logger.subsection('Dataset Statistics');
  logger.info(`Legitimate samples: ${allLegit.length.toLocaleString()}`);
  logger.info(`Fraudulent samples: ${allFraud.length.toLocaleString()}`);
  logger.info(`Total samples: ${(allLegit.length + allFraud.length).toLocaleString()}`);

  // Train models for each order
  const trainedModels: Array<{
    order: number;
    legitModel: NGramMarkovChain;
    fraudModel: NGramMarkovChain;
  }> = [];

  for (const order of options.orders) {
    logger.subsection(`Training ${order}-gram Models`);

    logger.info(`Training ${order}-gram legitimate model...`);
    const legitModel = new NGramMarkovChain(order);
    let count = 0;
    for (const email of allLegit) {
      legitModel.train(email);
      count++;
      if (count % 10000 === 0) {
        logger.progress(count, allLegit.length, `${order}-gram Legit`);
      }
    }
    logger.progress(allLegit.length, allLegit.length, `${order}-gram Legit`);

    logger.info(`Training ${order}-gram fraudulent model...`);
    const fraudModel = new NGramMarkovChain(order);
    count = 0;
    for (const email of allFraud) {
      fraudModel.train(email);
      count++;
      if (count % 10000 === 0) {
        logger.progress(count, allFraud.length, `${order}-gram Fraud`);
      }
    }
    logger.progress(allFraud.length, allFraud.length, `${order}-gram Fraud`);

    trainedModels.push({ order, legitModel, fraudModel });
    logger.success(`${order}-gram training complete!`);
  }

  logger.success('All model training complete!');

  // Test models
  logger.subsection('Testing Models');
  const testEmails = [
    { email: 'john.doe', expected: 'legit' },
    { email: 'user123', expected: 'fraud' },
    { email: 'admin', expected: 'legit' },
    { email: 'zzzzqqq', expected: 'fraud' },
    { email: 'support', expected: 'legit' },
    { email: 'abc123xyz', expected: 'fraud' },
  ];

  for (const { order, legitModel, fraudModel } of trainedModels) {
    logger.info(`\nTesting ${order}-gram models:`);
    for (const { email, expected } of testEmails) {
      const legitEntropy = legitModel.crossEntropy(email);
      const fraudEntropy = fraudModel.crossEntropy(email);
      const prediction = legitEntropy < fraudEntropy ? 'legit' : 'fraud';
      const match = prediction === expected ? '✓' : '✗';

      logger.info(`${match} "${email}": Legit=${legitEntropy.toFixed(2)}, Fraud=${fraudEntropy.toFixed(2)} → ${prediction}`);
    }
  }

  // Save models
  logger.subsection('Saving Models');
  const savedFiles: Array<{ order: number; legitFile: string; fraudFile: string }> = [];

  for (const { order, legitModel, fraudModel } of trainedModels) {
    const legitJSON = JSON.stringify(legitModel.toJSON(), null, 2);
    const fraudJSON = JSON.stringify(fraudModel.toJSON(), null, 2);

    const legitFile = `${options.output}/markov_legit_${order}gram.json`;
    const fraudFile = `${options.output}/markov_fraud_${order}gram.json`;

    await Bun.write(legitFile, legitJSON);
    await Bun.write(fraudFile, fraudJSON);

    logger.success(`Saved ${legitFile} (${(legitJSON.length / 1024 / 1024).toFixed(2)} MB)`);
    logger.success(`Saved ${fraudFile} (${(fraudJSON.length / 1024 / 1024).toFixed(2)} MB)`);

    savedFiles.push({ order, legitFile, fraudFile });
  }

  // Upload to KV if requested
  if (options.upload) {
    await uploadModelsToKV(savedFiles, options.remote);
  }

  logger.section('✅ Training Complete!');

  if (!options.upload) {
    logger.info('\nNext steps:');
    logger.info('1. Upload models to KV:');
    logger.info(`   npm run cli train:markov --upload ${options.remote ? '--remote' : ''}`);
    logger.info('2. Deploy worker:');
    logger.info('   npm run cli deploy');
  } else {
    logger.info('\nModels are now live! Deploy the worker to activate:');
    logger.info('   npm run cli deploy');
  }
}
