#!/usr/bin/env bun
/**
 * Fraud Detection CLI
 *
 * Unified command-line interface for managing the fraud detection system
 */

import { parseArgs } from 'util';
import { join } from 'path';

const COMMANDS = {
  // Training commands
  'train:relabel': {
    description: 'Re-label dataset based on pattern analysis (not content)',
    file: 'commands/train/relabel.ts',
    usage: 'train:relabel [--input <path>] [--output <path>] [--threshold <n>]'
  },
  'train:markov': {
    description: 'Train Markov Chain models from CSV datasets',
    file: 'commands/train/markov.ts',
    usage: 'train:markov [--dataset <path>] [--output <path>]'
  },
  'train:dataset': {
    description: 'Combine base + curated datasets into a training CSV',
    file: 'commands/train/dataset-build.ts',
    usage: 'train:dataset [--base <paths>] [--augment <paths>] [--output <path>]'
  },
  'train:calibrate': {
    description: 'Fit logistic calibration layer on top of Markov outputs',
    file: 'commands/train/calibrate.ts',
    usage: 'train:calibrate [--dataset <path>] [--models <dir>] [--output <path>]'
  },
  'train:validate': {
    description: 'Validate training dataset quality',
    file: 'commands/train/validate.ts',
    usage: 'train:validate <dataset-path>'
  },
  'model:validate': {
    description: 'Validate trained models against test suite',
    file: 'commands/model/validate.ts',
    usage: 'model:validate [--remote] [--orders <n>] [--ensemble] [--verbose]'
  },
  'training:validate': {
    description: 'Validate trained models before deployment',
    file: 'commands/training/validate.ts',
    usage: 'training:validate --version <version>'
  },
  'training:extract': {
    description: 'Extract training data from D1 validations table',
    file: 'commands/training/extract.ts',
    usage: 'training:extract [--days <n>] [--min-confidence <n>] [--remote]'
  },
  'training:train': {
    description: 'Train models from extracted datasets',
    file: 'commands/training/train.ts',
    usage: 'training:train [--days <n>] [--orders <list>]'
  },

  // Deployment commands
  'deploy': {
    description: 'Deploy worker to Cloudflare',
    file: 'commands/deploy/deploy.ts',
    usage: 'deploy [--minify] [--env <env>]'
  },
  'deploy:status': {
    description: 'Check deployment status',
    file: 'commands/deploy/status.ts',
    usage: 'deploy:status'
  },

  // Data management commands
  'kv:list': {
    description: 'List keys in KV namespace',
    file: 'commands/data/kv.ts',
    usage: 'kv:list [--binding <name>] [--prefix <prefix>]'
  },
  'kv:get': {
    description: 'Get value from KV',
    file: 'commands/data/kv.ts',
    usage: 'kv:get <key> [--binding <name>]'
  },
  'kv:put': {
    description: 'Put value to KV',
    file: 'commands/data/kv.ts',
    usage: 'kv:put <key> <value|--file <path>> [--binding <name>]'
  },
  'kv:delete': {
    description: 'Delete key from KV',
    file: 'commands/data/kv.ts',
    usage: 'kv:delete <key> [--binding <name>]'
  },
  'analytics:query': {
    description: 'Query D1 analytics via /admin/analytics',
    file: 'commands/data/analytics.ts',
    usage: 'analytics:query <sql> [--hours <n>] [--format <json|table>] [--url <base>] [--api-key <key>]'
  },
  'analytics:stats': {
    description: 'Show analytics statistics (summary/block reasons/etc.)',
    file: 'commands/data/analytics.ts',
    usage: 'analytics:stats [--last <hours>] [--url <base>] [--api-key <key>]'
  },
  'analytics:drift': {
    description: 'Monitor calibration drift and health',
    file: 'commands/analytics/drift.ts',
    usage: 'analytics:drift [--hours <n>] [--url <base>] [--api-key <key>]'
  },
  'domains:update': {
    description: 'Update disposable domains from external sources',
    file: 'commands/data/domains.ts',
    usage: 'domains:update'
  },
  'domains:metadata': {
    description: 'Show disposable domains metadata',
    file: 'commands/data/domains.ts',
    usage: 'domains:metadata'
  },
  'domains:cache:clear': {
    description: 'Clear disposable domains cache',
    file: 'commands/data/domains.ts',
    usage: 'domains:cache:clear'
  },
  'tld:sync': {
    description: 'Sync hardcoded TLD profiles to KV',
    file: 'commands/data/tld.ts',
    usage: 'tld:sync'
  },
  'tld:metadata': {
    description: 'Show TLD profiles metadata',
    file: 'commands/data/tld.ts',
    usage: 'tld:metadata'
  },
  'tld:get': {
    description: 'Get a single TLD profile',
    file: 'commands/data/tld.ts',
    usage: 'tld:get <tld>'
  },
  'tld:update': {
    description: 'Update a single TLD profile',
    file: 'commands/data/tld.ts',
    usage: 'tld:update <tld> <json>'
  },
  'tld:cache:clear': {
    description: 'Clear TLD profiles cache',
    file: 'commands/data/tld.ts',
    usage: 'tld:cache:clear'
  },

  // Testing commands
  'test:live': {
    description: 'Run live tests against production with curated test cases',
    file: 'commands/test-live.ts',
    usage: 'test:live [--endpoint <url>] [--verbose]'
  },
  // 'test:ood': {
  //   description: 'Run OOD (Out-of-Distribution) detection test suite (v2.4+)',
  //   file: 'commands/test-ood.ts',  // TODO: File not implemented yet
  //   usage: 'test:ood [--endpoint <url>] [--verbose]'
  // },
  'test:batch': {
    description: 'Batch test large email datasets against production',
    file: 'commands/test/batch.ts',
    usage: 'test:batch --input <path> [--endpoint <url>] [--concurrency <n>]'
  },
  'test:cron': {
    description: 'Test cron triggers locally',
    file: 'commands/test/cron.ts',
    usage: 'test:cron [--port <port>] [--cron <pattern>] [--time <timestamp>]'
  },
  'test:generate': {
    description: 'Generate test email dataset',
    file: 'commands/test/generate.ts',
    usage: 'test:generate [--count <n>] [--patterns <pattern,...>]'
  },
  'test:detectors': {
    description: 'Test pattern detectors',
    file: 'commands/test/detectors.ts',
    usage: 'test:detectors [--pattern <name>]'
  },
  'test:api': {
    description: 'Test API endpoints',
    file: 'commands/test/api.ts',
    usage: 'test:api [--url <url>] [--email <email>]'
  },
  'test:multilang': {
    description: 'Test multi-language N-gram support',
    file: 'commands/test/multilang.ts',
    usage: 'test:multilang'
  },

  // Configuration commands
  'config:get': {
    description: 'Get configuration value',
    file: 'commands/config/manage.ts',
    usage: 'config:get <key>'
  },
  'config:set': {
    description: 'Set configuration value',
    file: 'commands/config/manage.ts',
    usage: 'config:set <key> <value>'
  },
  'config:list': {
    description: 'List all configurations',
    file: 'commands/config/manage.ts',
    usage: 'config:list'
  },
  'config:upload': {
    description: 'Overwrite config.json with a local file',
    file: 'commands/config/manage.ts',
    usage: 'config:upload <path>'
  },
  'config:sync': {
    description: 'Sync local config to KV',
    file: 'commands/config/manage.ts',
    usage: 'config:sync'
  },
  'config:verify': {
    description: 'Verify deployed config.json integrity',
    file: 'commands/config/verify.ts',
    usage: 'config:verify [--remote] [--max-age <hours>]'
  },

  // A/B Testing commands
  'ab:create': {
    description: 'Create new A/B test experiment',
    file: 'commands/ab/create.ts',
    usage: 'ab:create --experiment-id <id> --description <desc> [options]'
  },
  'ab:status': {
    description: 'Show active A/B test status',
    file: 'commands/ab/status.ts',
    usage: 'ab:status [--remote]'
  },
  'ab:analyze': {
    description: 'Analyze A/B test results',
    file: 'commands/ab/analyze.ts',
    usage: 'ab:analyze --experiment-id <id> [--hours <n>]'
  },
  'ab:stop': {
    description: 'Stop active A/B test',
    file: 'commands/ab/stop.ts',
    usage: 'ab:stop [--remote] [--yes]'
  },

  // Dataset management commands
  'dataset:generate': {
    description: 'Generate synthetic pattern-based dataset (gibberish vs. legitimate names)',
    file: 'commands/dataset/generate.ts',
    usage: 'dataset:generate [--legit <n>] [--fraud <n>] [--output <path>] [--verbose]'
  },
  'dataset:analyze': {
    description: 'Analyze dataset quality and identify mislabeled emails',
    file: 'commands/dataset/analyze.ts',
    usage: 'dataset:analyze [--dataset <path>] [--endpoint <url>] [--sample <n>] [--output <path>]'
  },
  'dataset:clean': {
    description: 'Clean dataset by correcting mislabeled emails',
    file: 'commands/dataset/clean.ts',
    usage: 'dataset:clean [--input <path>] [--output <path>] [--analysis <path>] [--min-confidence <high|medium|low>] [--dry-run]'
  }
};

function showHelp() {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║              🔍 Fraud Detection System CLI                    ║
╚═══════════════════════════════════════════════════════════════╝

Usage: npm run cli <command> [options]

📦 TRAINING COMMANDS
  train:relabel             Re-label dataset (pattern-based, not content)
  train:markov              Train Markov Chain models
  train:validate            Validate dataset quality
  training:extract          Extract training data from D1
 (??)
  training:train            Train models from extracted datasets
  training:validate         Validate trained models before deployment

🚀 DEPLOYMENT COMMANDS
  deploy                    Deploy worker to Cloudflare
  deploy:status             Check deployment status

💾 DATA MANAGEMENT
  kv:list                   List KV keys
  kv:get <key>              Get KV value
  kv:put <key> <value>      Put KV value
  kv:delete <key>           Delete KV key
  analytics:query <sql>     Run D1 SQL via /admin/analytics
  analytics:stats           Show analytics summaries
  analytics:drift           Monitor calibration drift
  domains:update            Update disposable domains list
  domains:metadata          Show domains metadata
  domains:cache:clear       Clear domains cache
  tld:sync                  Sync TLD profiles to KV
  tld:metadata              Show TLD profiles metadata
  tld:get <tld>             Get single TLD profile
  tld:update <tld> <json>   Update TLD profile
  tld:cache:clear           Clear TLD cache

🧪 TESTING COMMANDS
  test:live                 Run live production tests (curated dataset)
  test:batch                Batch test large datasets (5k+ emails)
  test:generate             Generate test dataset
  test:detectors            Test pattern detectors
  test:api                  Test API endpoints

⚙️  CONFIGURATION
  config:get <key>          Get configuration
  config:set <key> <value>  Set configuration
  config:list               List configurations
  config:sync               Sync config to KV
  config:verify             Verify deployed config integrity

🧪 A/B TESTING
  ab:create                 Create new experiment
  ab:status                 Show active experiment
  ab:analyze                Analyze test results
  ab:stop                   Stop active experiment

OPTIONS
  --help, -h                Show this help message
  --version, -v             Show version

EXAMPLES
  npm run cli train:markov --dataset ./dataset
  npm run cli deploy --minify
  npm run cli kv:list --binding MARKOV_MODEL
  FRAUD_API_KEY=your-key npm run cli analytics:query "SELECT COUNT(*) FROM validations"
  npm run cli test:generate --count 100 --patterns sequential,dated

For detailed command help: npm run cli <command> --help
`);
}

function showVersion() {
  const pkg = require('../package.json');
  console.log(`Fraud Detection CLI v${pkg.version}`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    showHelp();
    process.exit(0);
  }

  if (args[0] === '--version' || args[0] === '-v') {
    showVersion();
    process.exit(0);
  }

  const command = args[0];
  const commandConfig = COMMANDS[command as keyof typeof COMMANDS];

  if (!commandConfig) {
    console.error(`❌ Unknown command: ${command}\n`);
    console.error('Run "npm run cli --help" to see available commands');
    process.exit(1);
  }

  try {
    const commandPath = join(__dirname, commandConfig.file);
    const commandModule = await import(commandPath);

    // Pass remaining args to command, and command name for multi-command handlers
    await commandModule.default(args.slice(1), command);
  } catch (error) {
    console.error(`❌ Error executing command "${command}":`, error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
