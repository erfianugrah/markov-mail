/**
 * Train Markov Chain Models Command
 *
 * Trains legitimate and fraudulent email pattern models from labeled CSV datasets
 */

import { readFile } from 'fs/promises';
import { parse } from 'csv-parse/sync';
import { DynamicMarkovChain } from '../../../src/detectors/markov-chain.ts';
import { logger } from '../../utils/logger.ts';
import { parseArgs, getOption, hasFlag } from '../../utils/args.ts';
import { $ } from 'bun';

interface TrainingOptions {
  dataset: string;
  output: string;
  upload: boolean;
  remote: boolean;
}

const DEFAULT_DATASETS = [
  'dataset/8339691/CEAS_08.csv',
  'dataset/8339691/SpamAssasin.csv',
  'dataset/8339691/Nigerian_Fraud.csv',
  'dataset/8339691/Nigerian_5.csv',
  'dataset/8339691/Nazario.csv',
  'dataset/8339691/Nazario_5.csv',
  'dataset/8339691/TREC_05.csv',
  'dataset/8339691/TREC_06.csv',
  'dataset/8339691/TREC_07.csv',
];

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
    });

    const legit: string[] = [];
    const fraud: string[] = [];

    for (const record of records) {
      if (!record.sender && !record.Email) continue;

      const sender = record.sender || record.Email || '';
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

async function uploadToKV(legitFile: string, fraudFile: string, remote: boolean) {
  logger.section('📤 Uploading to Cloudflare KV');

  const remoteFlag = remote ? '--remote' : '';

  try {
    logger.info('Uploading legitimate model...');
    await $`npx wrangler kv key put MM_legit_production --path=${legitFile} --binding=MARKOV_MODEL ${remoteFlag}`.quiet();
    logger.success('Legitimate model uploaded');

    logger.info('Uploading fraudulent model...');
    await $`npx wrangler kv key put MM_fraud_production --path=${fraudFile} --binding=MARKOV_MODEL ${remoteFlag}`.quiet();
    logger.success('Fraudulent model uploaded');

    logger.success('✨ Models uploaded to KV successfully!');
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
  --dataset <path>    Path to dataset directory (default: ./dataset/8339691)
  --output <path>     Output directory for models (default: ./)
  --upload            Upload models to KV after training
  --remote            Use remote KV (requires --upload)
  --help, -h          Show this help message

EXAMPLES
  # Train with default datasets
  npm run cli train:markov

  # Train and upload to remote KV
  npm run cli train:markov --upload --remote

  # Use custom dataset
  npm run cli train:markov --dataset ./my-datasets
`);
    return;
  }

  const options: TrainingOptions = {
    dataset: getOption(parsed, 'dataset') || 'dataset/8339691',
    output: getOption(parsed, 'output') || './',
    upload: hasFlag(parsed, 'upload'),
    remote: hasFlag(parsed, 'remote')
  };

  logger.section('🚀 Markov Chain Model Training');

  // Load datasets
  logger.subsection('Loading Datasets');
  let allLegit: string[] = [];
  let allFraud: string[] = [];

  for (const file of DEFAULT_DATASETS) {
    const { legit, fraud } = await loadCSV(file);
    allLegit.push(...legit);
    allFraud.push(...fraud);
  }

  logger.subsection('Dataset Statistics');
  logger.info(`Legitimate samples: ${allLegit.length.toLocaleString()}`);
  logger.info(`Fraudulent samples: ${allFraud.length.toLocaleString()}`);
  logger.info(`Total samples: ${(allLegit.length + allFraud.length).toLocaleString()}`);

  // Train models
  logger.subsection('Training Models');
  logger.info('Training legitimate model...');
  const legitModel = new DynamicMarkovChain();
  let count = 0;
  for (const email of allLegit) {
    legitModel.train(email);
    count++;
    if (count % 10000 === 0) {
      logger.progress(count, allLegit.length, 'Legit  ');
    }
  }
  logger.progress(allLegit.length, allLegit.length, 'Legit  ');

  logger.info('Training fraudulent model...');
  const fraudModel = new DynamicMarkovChain();
  count = 0;
  for (const email of allFraud) {
    fraudModel.train(email);
    count++;
    if (count % 10000 === 0) {
      logger.progress(count, allFraud.length, 'Fraud  ');
    }
  }
  logger.progress(allFraud.length, allFraud.length, 'Fraud  ');

  logger.success('Training complete!');

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

  for (const { email, expected } of testEmails) {
    const legitEntropy = legitModel.crossEntropy(email);
    const fraudEntropy = fraudModel.crossEntropy(email);
    const prediction = legitEntropy < fraudEntropy ? 'legit' : 'fraud';
    const match = prediction === expected ? '✓' : '✗';

    logger.info(`${match} "${email}": Legit=${legitEntropy.toFixed(2)}, Fraud=${fraudEntropy.toFixed(2)} → ${prediction}`);
  }

  // Save models
  logger.subsection('Saving Models');
  const legitJSON = JSON.stringify(legitModel.toJSON(), null, 2);
  const fraudJSON = JSON.stringify(fraudModel.toJSON(), null, 2);

  const legitFile = `${options.output}/markov_legit_model.json`;
  const fraudFile = `${options.output}/markov_fraud_model.json`;

  await Bun.write(legitFile, legitJSON);
  await Bun.write(fraudFile, fraudJSON);

  logger.success(`Saved ${legitFile} (${(legitJSON.length / 1024 / 1024).toFixed(2)} MB)`);
  logger.success(`Saved ${fraudFile} (${(fraudJSON.length / 1024 / 1024).toFixed(2)} MB)`);

  // Upload to KV if requested
  if (options.upload) {
    await uploadToKV(legitFile, fraudFile, options.remote);
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
