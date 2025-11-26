/**
 * Analytics Commands (D1/Admin API)
 *
 * Runs SQL queries via /admin/analytics and prints results.
 */

import { logger } from '../../utils/logger.ts';
import { parseArgs, getOption, hasFlag } from '../../utils/args.ts';

interface ApiConfig {
  url: string;
  apiKey: string;
}

function normalizeBaseUrl(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function getApiConfig(parsed: ReturnType<typeof parseArgs>): ApiConfig {
  const url =
    (getOption(parsed, 'url') as string | undefined) ||
    process.env.FRAUD_API_URL ||
    'http://localhost:8787';

  const apiKey =
    (getOption(parsed, 'api-key') as string | undefined) ||
    process.env.FRAUD_API_KEY;

  if (!apiKey) {
    logger.error('Missing API key. Set FRAUD_API_KEY or use --api-key.');
    process.exit(1);
  }

  return { url: normalizeBaseUrl(url), apiKey };
}

async function runQuery(args: string[]) {
  const parsed = parseArgs(args);
  const sql = parsed.positional[0];

  if (!sql) {
    logger.error('SQL query is required');
    console.log('\nUsage: npm run cli analytics:query "<sql>" [--hours <n>] [--url <base>] [--api-key <key>] [--format json|table]');
    process.exit(1);
  }

  const hours = parseInt(getOption(parsed, 'hours') || '24', 10);
  const format = (getOption(parsed, 'format') as string) || 'json';
  const { url, apiKey } = getApiConfig(parsed);

  logger.section('📊 Analytics Query');
  logger.info(`SQL: ${sql}`);
  logger.info(`Hours: ${hours}`);
  logger.info(`Endpoint: ${url}/admin/analytics\n`);

  const response = await fetch(`${url}/admin/analytics`, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql, hours }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Query failed (${response.status}): ${text}`);
  }

  const payload = await response.json() as { data?: Record<string, any>[] };
  const rows = payload.data || [];

  if (format === 'table') {
    logger.table(rows);
  } else {
    logger.json(rows);
  }
}

async function runStats(args: string[]) {
  const parsed = parseArgs(args);
  const hours = parseInt(getOption(parsed, 'last') || '24', 10);
  const { url, apiKey } = getApiConfig(parsed);

  logger.section('📈 Analytics Statistics');
  logger.info(`Hours: ${hours}`);
  logger.info(`Endpoint: ${url}/admin/analytics\n`);

  const sections: Array<{ name: string; type: string }> = [
    { name: 'Decision Summary', type: 'summary' },
    { name: 'Top Block Reasons', type: 'blockReasons' },
    { name: 'Risk Distribution', type: 'riskDistribution' },
    { name: 'Disposable Domains', type: 'disposableDomains' },
    { name: 'Pattern Families', type: 'patternFamilies' },
  ];

  for (const section of sections) {
    logger.subsection(section.name);
    try {
      const response = await fetch(
        `${url}/admin/analytics?type=${section.type}&hours=${hours}`,
        {
          headers: { 'X-API-Key': apiKey },
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = await response.json() as { data?: Record<string, any>[] };
      logger.table(payload.data || []);
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
║        D1 Analytics (via /admin/analytics)             ║
╚════════════════════════════════════════════════════════╝

Query and analyze fraud detection analytics stored in D1.

Environment:
  FRAUD_API_URL   Base URL (default: http://localhost:8787)
  FRAUD_API_KEY   Admin API key (required)

USAGE
  npm run cli analytics:query "<sql>" [--hours <n>] [--format json|table]
  npm run cli analytics:stats [--last <hours>]

OPTIONS
  --url <base>           Override API base URL (default: FRAUD_API_URL or http://localhost:8787)
  --api-key <key>        Override API key (default: FRAUD_API_KEY)
  --hours <n>            Time range for query command (default: 24)
  --last <hours>         Time range for stats command (default: 24)
  --format <type>        Output format for query: json|table (default: json)
  --help, -h             Show this help message

EXAMPLES
  npm run cli analytics:query "SELECT COUNT(*) AS total FROM validations"
  npm run cli analytics:stats --last 48
`);
    return;
  }

  const command = process.argv[3];
  if (command.includes(':query')) {
    await runQuery(args);
  } else if (command.includes(':stats')) {
    await runStats(args);
  }
}
