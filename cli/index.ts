#!/usr/bin/env bun
/**
 * Fraud Detection CLI
 *
 * Unified command-line interface for managing the fraud detection system
 */

import { parseArgs } from 'util';
import { join } from 'path';

const COMMANDS = {
	// Deployment commands
	'deploy': {
		description: 'Deploy worker to Cloudflare',
		file: 'commands/deploy/deploy.ts',
		usage: 'deploy [--minify] [--env <env>]',
	},
	'deploy:status': {
		description: 'Check deployment status',
		file: 'commands/deploy/status.ts',
		usage: 'deploy:status',
	},

	// Data + config management
	'kv:list': {
		description: 'List keys in KV namespace',
		file: 'commands/data/kv.ts',
		usage: 'kv:list [--binding <name>] [--prefix <prefix>]',
	},
	'kv:get': {
		description: 'Get value from KV',
		file: 'commands/data/kv.ts',
		usage: 'kv:get <key> [--binding <name>]',
	},
	'kv:put': {
		description: 'Put value to KV',
		file: 'commands/data/kv.ts',
		usage: 'kv:put <key> <value|--file <path>> [--binding <name>]',
	},
	'kv:delete': {
		description: 'Delete key from KV',
		file: 'commands/data/kv.ts',
		usage: 'kv:delete <key> [--binding <name>]',
	},
	'analytics:query': {
		description: 'Query D1 analytics via /admin/analytics',
		file: 'commands/data/analytics.ts',
		usage: 'analytics:query <sql> [--hours <n>] [--format <json|table>] [--url <base>] [--api-key <key>]',
	},
	'analytics:stats': {
		description: 'Show analytics statistics (summary/block reasons/etc.)',
		file: 'commands/data/analytics.ts',
		usage: 'analytics:stats [--last <hours>] [--url <base>] [--api-key <key>]',
	},
	'domains:update': {
		description: 'Update disposable domains from external sources',
		file: 'commands/data/domains.ts',
		usage: 'domains:update',
	},
	'domains:metadata': {
		description: 'Show disposable domains metadata',
		file: 'commands/data/domains.ts',
		usage: 'domains:metadata',
	},
	'domains:cache:clear': {
		description: 'Clear disposable domains cache',
		file: 'commands/data/domains.ts',
		usage: 'domains:cache:clear',
	},
	'tld:sync': {
		description: 'Sync hardcoded TLD profiles to KV',
		file: 'commands/data/tld.ts',
		usage: 'tld:sync',
	},
	'tld:metadata': {
		description: 'Show TLD profiles metadata',
		file: 'commands/data/tld.ts',
		usage: 'tld:metadata',
	},
	'tld:get': {
		description: 'Get a single TLD profile',
		file: 'commands/data/tld.ts',
		usage: 'tld:get <tld>',
	},
	'tld:update': {
		description: 'Update a single TLD profile',
		file: 'commands/data/tld.ts',
		usage: 'tld:update <tld> <json>',
	},
	'tld:cache:clear': {
		description: 'Clear TLD profiles cache',
		file: 'commands/data/tld.ts',
		usage: 'tld:cache:clear',
	},
	'data:synthetic': {
		description: 'Generate synthetic training data (31 cultures, multi-language)',
		file: 'commands/data/synthetic.ts',
		usage: 'data:synthetic [--count <n>] [--output <path>] [--legit-ratio <0-1>] [--append] [--seed <n>]',
	},
	'data:enron:clean': {
		description: 'Normalize raw Enron CSV export into model-ready format',
		file: 'commands/data/clean_enron.ts',
		usage: 'data:enron:clean [--input <path>] [--output <path>]',
	},

	// Testing commands
	'test:live': {
		description: 'Run live tests against production with curated test cases',
		file: 'commands/test-live.ts',
		usage: 'test:live [--endpoint <url>] [--verbose]',
	},
	'test:batch': {
		description: 'Batch test large email datasets against production',
		file: 'commands/test/batch.ts',
		usage: 'test:batch --input <path> [--endpoint <url>] [--concurrency <n>]',
	},
	'test:cron': {
		description: 'Test cron triggers locally',
		file: 'commands/test/cron.ts',
		usage: 'test:cron [--port <port>] [--cron <pattern>] [--time <timestamp>]',
	},
	'test:generate': {
		description: 'Generate test email dataset',
		file: 'commands/test/generate.ts',
		usage: 'test:generate [--count <n>] [--patterns <pattern,...>]',
	},
	'test:detectors': {
		description: 'Test pattern detectors',
		file: 'commands/test/detectors.ts',
		usage: 'test:detectors [--pattern <name>]',
	},
	'test:api': {
		description: 'Test API endpoints',
		file: 'commands/test/api.ts',
		usage: 'test:api [--url <url>] [--email <email>]',
	},
	'test:multilang': {
		description: 'Test multi-language bigram/trigram support',
		file: 'commands/test/multilang.ts',
		usage: 'test:multilang',
	},

	// Configuration commands
	'config:get': {
		description: 'Get configuration value',
		file: 'commands/config/manage.ts',
		usage: 'config:get <key>',
	},
	'config:set': {
		description: 'Set configuration value',
		file: 'commands/config/manage.ts',
		usage: 'config:set <key> <value>',
	},
	'config:list': {
		description: 'List all configurations',
		file: 'commands/config/manage.ts',
		usage: 'config:list',
	},
	'config:upload': {
		description: 'Overwrite config.json with a local file',
		file: 'commands/config/manage.ts',
		usage: 'config:upload <path>',
	},
	'config:sync': {
		description: 'Sync local config to KV',
		file: 'commands/config/manage.ts',
		usage: 'config:sync',
	},
	'config:update-thresholds': {
		description: 'Update config defaults with new warn/block thresholds',
		file: 'commands/config/update-thresholds.ts',
		usage: 'config:update-thresholds [--warn <value> --block <value>] [--input <recommendation.json>]',
	},

	'features:export': {
		description: 'Generate feature matrix for model training',
		file: 'commands/features/export.ts',
		usage: 'features:export [--input data/main.csv] [--output data/features/export.csv]',
	},
	'artifacts:snapshot': {
		description: 'Copy latest calibration/threshold artifacts into tmp folder',
		file: 'commands/artifacts/snapshot.ts',
		usage: 'artifacts:snapshot [--output <dir>]',
	},
	'model:train': {
		description: 'Train ML model (1 tree = decision tree, 10+ trees = random forest)',
		file: 'commands/model/train_unified.ts',
		usage: 'model:train [--n-trees <n>] [--max-depth <n>] [--conflict-weight <n>] [--skip-mx] [--upload]',
	},
	'model:tune': {
		description: 'Run RandomizedSearchCV to suggest better RF hyperparameters',
		file: 'commands/model/tune_model.ts',
		usage: 'model:tune [--dataset <path>] [--n-iter <n>] [--output <path>]',
	},
	'model:calibrate': {
		description: 'Calibrate Random Forest scores via Platt scaling',
		file: 'commands/model/calibrate.ts',
		usage: 'model:calibrate [--input <path>] [--output <path>]',
	},
	'model:thresholds': {
		description: 'Recommend warn/block thresholds from calibration scan',
		file: 'commands/model/thresholds.ts',
		usage: 'model:thresholds [--input <threshold-scan.json>]',
	},
	'model:guardrail': {
		description: 'CI guardrail: run calibration + threshold recommendation + verification',
		file: 'commands/model/guardrail.ts',
		usage: 'model:guardrail [--skip-calibrate] [--skip-thresholds]',
	},
	'model:pipeline': {
		description: 'Run export → train → guardrail → sync pipeline',
		file: 'commands/model/pipeline.ts',
		usage: 'model:pipeline [--dataset <path>] [--export-modes fast,full] [--search <json>] [--run-dir <dir>] [--resume <dir>] [--upload-model] [--apply-thresholds] [--sync-config]',
	},
	'model:analyze': {
		description: 'Analyze a trained model (e.g., view feature importances)',
		file: 'commands/model/analyze_model.ts',
		usage: 'model:analyze <path-to-model.json>',
	},
	// A/B Testing commands
	'ab:create': {
		description: 'Create new A/B test experiment',
		file: 'commands/ab/create.ts',
		usage: 'ab:create --experiment-id <id> --description <desc> [options]',
	},
	'ab:status': {
		description: 'Show active A/B test status',
		file: 'commands/ab/status.ts',
		usage: 'ab:status [--remote]',
	},
	'ab:analyze': {
		description: 'Analyze A/B test results',
		file: 'commands/ab/analyze.ts',
		usage: 'ab:analyze --experiment-id <id> [--hours <n>]',
	},
	'ab:stop': {
		description: 'Stop active A/B test',
		file: 'commands/ab/stop.ts',
		usage: 'ab:stop [--remote] [--yes]',
	},
};

function showHelp() {
	console.log(`
╔═══════════════════════════════════════════════════════════════╗
║              🔍 Fraud Detection System CLI                    ║
╚═══════════════════════════════════════════════════════════════╝

Usage: npm run cli <command> [options]

🚀 DEPLOYMENT
  deploy                    Deploy worker to Cloudflare
  deploy:status             Check deployment status

	💾 DATA & TELEMETRY
  kv:list|get|put|delete    Inspect/update KV namespaces
  analytics:query           Run D1 SQL via /admin/analytics
  analytics:stats           Show block/warn summaries
  domains:*                 Manage disposable domain snapshots
  tld:*                     Manage TLD risk profiles
  data:synthetic            Generate balanced synthetic training datasets
  data:enron:clean          Normalize raw Enron exports into model-ready CSV

🧪 TESTING
  test:live                 Run curated regression tests
  test:batch                Replay large datasets
  test:cron                 Exercise scheduled jobs locally
  test:generate             Build synthetic pattern datasets
  test:detectors            Smoke-test pattern detectors
  test:api                  Call /validate with sample emails
  test:multilang            Inspect n-gram language support

⚙️ CONFIGURATION
  config:get|set|list       Inspect/update runtime config
  config:upload|sync        Push config files to KV

🛠️ MODEL PIPELINE
  features:export           Mirror runtime feature vector for model training
  artifacts:snapshot        Copy guardrail artifacts for review
  model:pipeline            Export → train → guardrail → snapshot (+optional upload)
  model:train               Train model (1 tree = decision tree, 10+ = random forest)
  model:tune                Randomized search for optimal RF hyperparameters
  model:calibrate           Run Platt scaling on validation scores
  model:analyze             Analyze a trained model (e.g., view feature importances)
  tree:train                [DEPRECATED] Use model:train --n-trees 1
  forest:train              [DEPRECATED] Use model:train --n-trees 10

🧮 EXPERIMENTATION
  ab:create|status|analyze|stop   Manage KV-backed experiments

OPTIONS
  --help, -h                Show this help message
  --version, -v             Show version

EXAMPLES
  npm run cli deploy -- --minify
  npm run cli kv:list -- --binding CONFIG
  npm run cli analytics:stats -- --last 24 --url https://fraud.example.dev --api-key xxx
  npm run cli domains:update
  npm run cli test:api -- --url https://fraud.example.dev --email user@example.com

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
  } catch (error: any) {
    console.error(`\n❌ Error executing command "${command}":\n`);

    if (error.code === 'MODULE_NOT_FOUND') {
      console.error(`   Command file not found: ${commandConfig.file}`);
      console.error(`   This command may not be implemented yet.\n`);
    } else if (error.message) {
      console.error(`   ${error.message}\n`);
      if (error.stack && process.env.DEBUG) {
        console.error('Stack trace:');
        console.error(error.stack);
      }
    } else {
      console.error(`   ${String(error)}\n`);
    }

    console.error('💡 Tip: Run "npm run cli --help" to see available commands');
    console.error('💡 Tip: Run "npm run cli <command> --help" for command-specific help\n');

    process.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
