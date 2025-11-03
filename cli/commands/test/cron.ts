/**
 * Cron Trigger Testing Command
 *
 * Tests scheduled cron triggers locally using Cloudflare's recommended method
 * https://developers.cloudflare.com/workers/configuration/cron-triggers/#test-cron-triggers-locally
 */

import { parseArgs } from 'util';
import { execSync } from 'child_process';

export async function testCron(args: string[]) {
	const { values } = parseArgs({
		args,
		options: {
			port: { type: 'string', default: '8787' },
			cron: { type: 'string' },
			time: { type: 'string' },
			help: { type: 'boolean', short: 'h' },
		},
		allowPositionals: true,
	});

	if (values.help) {
		console.log(`
╔════════════════════════════════════════════════════════╗
║              Test Cron Triggers Locally                ║
╚════════════════════════════════════════════════════════╝

Tests scheduled cron triggers using Cloudflare Workers dev mode.

USAGE
  npm run cli test:cron [options]

OPTIONS
  --port <port>           Port where wrangler dev is running (default: 8787)
  --cron <pattern>        Cron pattern to test (e.g., "0 */6 * * *")
  --time <timestamp>      Override scheduled time (Unix timestamp)
  --help, -h              Show this help message

EXAMPLES
  # Test with default settings (requires wrangler dev running)
  npm run cli test:cron

  # Test with specific cron pattern
  npm run cli test:cron --cron "0 */6 * * *"

  # Test with specific timestamp
  npm run cli test:cron --time 1745856238

  # Test on different port
  npm run cli test:cron --port 9000

PREREQUISITES
  You must have wrangler dev running in another terminal:
    npm run dev

WHAT HAPPENS
  1. Triggers the scheduled handler (cron job)
  2. Runs disposable domain list update
  3. Runs automated model training pipeline (direct from Analytics Engine)
  4. Logs all events to console

EXPECTED BEHAVIOR
  ✓ Cron trigger fires successfully
  ✓ Disposable domains update starts
  ✓ Training pipeline fetches data from Analytics Engine

  ⚠️  Training may fail with "Insufficient samples" - this is normal!
     Training requires 500+ samples in Analytics Engine over 7 days.
     Generate traffic to populate Analytics Engine first.

DOCS
  https://developers.cloudflare.com/workers/configuration/cron-triggers/#test-cron-triggers-locally
`);
		return;
	}

	const port = values.port as string;
	const cronPattern = values.cron as string | undefined;
	const timestamp = values.time as string | undefined;

	// Build URL
	let url = `http://localhost:${port}/cdn-cgi/handler/scheduled`;
	const params: string[] = [];

	if (cronPattern) {
		params.push(`cron=${encodeURIComponent(cronPattern)}`);
	}
	if (timestamp) {
		params.push(`time=${timestamp}`);
	}

	if (params.length > 0) {
		url += `?${params.join('&')}`;
	}

	console.log('\n🕐 Testing Cron Triggers Locally');
	console.log('═'.repeat(80));
	console.log(`Port:            ${port}`);
	console.log(`URL:             ${url}`);
	if (cronPattern) {
		console.log(`Cron Pattern:    ${cronPattern}`);
	}
	if (timestamp) {
		console.log(`Timestamp:       ${timestamp} (${new Date(parseInt(timestamp) * 1000).toISOString()})`);
	}
	console.log('═'.repeat(80));

	// Check if dev server is running
	console.log('\n📡 Checking if wrangler dev is running...');
	try {
		execSync(`curl -s http://localhost:${port}/ > /dev/null`, { stdio: 'pipe' });
		console.log('✓ Dev server is running');
	} catch (error) {
		console.log('\n❌ Error: wrangler dev is not running!');
		console.log('\nStart the dev server first:');
		console.log('  npm run dev\n');
		console.log('Then run this command again in another terminal.\n');
		process.exit(1);
	}

	// Trigger cron
	console.log('\n🚀 Triggering scheduled cron handler...');
	console.log(`   GET ${url}`);
	console.log('');

	try {
		const output = execSync(`curl -v "${url}"`, {
			encoding: 'utf-8',
			stdio: 'pipe',
		});

		console.log(output);

		console.log('\n✅ Cron trigger test completed!');
		console.log('');
		console.log('📊 Check your wrangler dev logs for:');
		console.log('   ✓ "cron_triggered" event');
		console.log('   ✓ "disposable_domains_update_started" event');
		console.log('   ✓ "training_pipeline_started" event');
		console.log('');
		console.log('⚠️  Expected Error (Normal):');
		console.log('   "Insufficient training data" - Training needs 500+ Analytics Engine samples');
		console.log('   "Analytics Engine credentials not configured" - Missing env vars for local dev');
		console.log('');
		console.log('🔍 Next Steps:');
		console.log('   1. Generate validation traffic: curl -X POST http://localhost:8787/validate -H "Content-Type: application/json" -d \'{"email":"test@example.com"}\'');
		console.log('   2. Wait for Analytics Engine to populate (production only)');
		console.log('   3. Training runs automatically every 6 hours in production');
		console.log('');
	} catch (error) {
		if (error instanceof Error && 'stdout' in error) {
			console.log((error as any).stdout);
		}
		console.log('\n❌ Cron trigger failed!');
		console.log('\nPossible issues:');
		console.log('  - Wrong port (use --port to specify)');
		console.log('  - Dev server not running (run: npm run dev)');
		console.log('  - Network issue\n');
		throw error;
	}
}

// Export for CLI integration
export default testCron;
