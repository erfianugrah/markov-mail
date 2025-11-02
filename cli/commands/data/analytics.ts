/**
 * Analytics Engine Commands
 */

import { logger } from '../../utils/logger.ts';
import { parseArgs, getOption, hasFlag } from '../../utils/args.ts';

async function query(args: string[]) {
  const parsed = parseArgs(args);
  const sql = parsed.positional[0];

  if (!sql) {
    logger.error('SQL query is required');
    console.log('\nUsage: npm run cli analytics:query "<sql>"');
    process.exit(1);
  }

  const format = getOption(parsed, 'format') || 'json';
  const apiKey = process.env.CLOUDFLARE_API_KEY;
  const email = process.env.CLOUDFLARE_EMAIL;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;

  if (!apiKey || !email || !accountId) {
    logger.error('Missing environment variables:');
    logger.info('CLOUDFLARE_API_KEY');
    logger.info('CLOUDFLARE_EMAIL');
    logger.info('CLOUDFLARE_ACCOUNT_ID');
    process.exit(1);
  }

  logger.section('📊 Analytics Query');
  logger.info(`SQL: ${sql}\n`);

  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`,
      {
        method: 'POST',
        headers: {
          'X-Auth-Key': apiKey,
          'X-Auth-Email': email,
          'Content-Type': 'application/json'
        },
        body: sql
      }
    );

    if (!response.ok) {
      throw new Error(`Query failed: ${response.statusText}`);
    }

    const data = await response.json();

    if (format === 'table') {
      logger.table(data.data);
    } else {
      logger.json(data);
    }
  } catch (error) {
    logger.error(`Query failed: ${error}`);
    process.exit(1);
  }
}

async function stats(args: string[]) {
  const parsed = parseArgs(args);
  const hours = parseInt(getOption(parsed, 'last') || '24');

  logger.section('📈 Analytics Statistics');

  const queries = [
    {
      name: 'Total Validations',
      sql: `SELECT COUNT(*) as total FROM FRAUD_DETECTION_ANALYTICS WHERE timestamp >= NOW() - INTERVAL '${hours}' HOUR`
    },
    {
      name: 'By Action',
      sql: `SELECT action, COUNT(*) as count FROM FRAUD_DETECTION_ANALYTICS WHERE timestamp >= NOW() - INTERVAL '${hours}' HOUR GROUP BY action ORDER BY count DESC`
    },
    {
      name: 'Average Risk Score',
      sql: `SELECT AVG(double1) as avg_risk FROM FRAUD_DETECTION_ANALYTICS WHERE timestamp >= NOW() - INTERVAL '${hours}' HOUR`
    }
  ];

  const apiKey = process.env.CLOUDFLARE_API_KEY;
  const email = process.env.CLOUDFLARE_EMAIL;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;

  if (!apiKey || !email || !accountId) {
    logger.error('Missing environment variables');
    process.exit(1);
  }

  for (const { name, sql } of queries) {
    logger.subsection(name);

    try {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`,
        {
          method: 'POST',
          headers: {
            'X-Auth-Key': apiKey,
            'X-Auth-Email': email
          },
          body: sql
        }
      );

      const data = await response.json();
      logger.table(data.data);
    } catch (error) {
      logger.error(`Failed: ${error}`);
    }
  }
}

export default async function analytics(args: string[]) {
  const parsed = parseArgs(args);

  if (hasFlag(parsed, 'help', 'h')) {
    console.log(`
╔════════════════════════════════════════════════════════╗
║               Analytics Engine                         ║
╚════════════════════════════════════════════════════════╝

Query and analyze fraud detection analytics.

USAGE
  npm run cli analytics:<command> [options]

COMMANDS
  analytics:query "<sql>"   Run SQL query
  analytics:stats           Show statistics

OPTIONS
  --format <type>           Output format: json|table (default: json)
  --last <hours>            Last N hours for stats (default: 24)
  --help, -h                Show this help message

ENVIRONMENT VARIABLES
  CLOUDFLARE_API_KEY        Your Cloudflare API key
  CLOUDFLARE_EMAIL          Your Cloudflare email
  CLOUDFLARE_ACCOUNT_ID     Your Cloudflare account ID

EXAMPLES
  npm run cli analytics:query "SELECT COUNT(*) FROM FRAUD_DETECTION_ANALYTICS"
  npm run cli analytics:query "SELECT * FROM FRAUD_DETECTION_ANALYTICS LIMIT 10" --format table
  npm run cli analytics:stats --last 48
`);
    return;
  }

  const command = process.argv[3];
  if (command.includes(':query')) {
    await query(args);
  } else if (command.includes(':stats')) {
    await stats(args);
  }
}
