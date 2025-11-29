/**
 * Test API Command
 */

import { logger } from '../../utils/logger.ts';
import { parseArgs, getOption } from '../../utils/args.ts';

export default async function api(args: string[]) {
  const parsed = parseArgs(args);
  const url = getOption(parsed, 'url') || 'https://fraud.erfi.dev/validate';
  const emails = parsed.positional.length > 0 ? parsed.positional : ['test@example.com'];

  logger.section('🧪 Testing API');
  logger.info(`URL: ${url}`);
  logger.info(`Testing ${emails.length} email(s)\n`);

  for (const email of emails) {
    logger.subsection(`Testing: ${email}`);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });

      if (!response.ok) {
        logger.error(`HTTP ${response.status}: ${response.statusText}`);
        continue;
      }

      const data = await response.json() as {
        decision?: string;
        riskScore?: number;
        message?: string;
        reason?: string;
        signals?: {
          patternType?: string;
          decisionTreeReason?: string;
          decisionTreePath?: string[];
        };
      };

      // Show key fields
      console.log(`  Decision: ${data.decision ?? 'unknown'}`);
      console.log(`  Risk Score: ${data.riskScore ?? 0}`);
      console.log(`  Reason: ${data.message || data.reason || 'unknown'}`);

      if (data.signals) {
        console.log(`  Pattern Type: ${data.signals.patternType || 'unknown'}`);
        if (data.signals.decisionTreeReason) {
          console.log(`  Tree Reason: ${data.signals.decisionTreeReason}`);
        }
        if (Array.isArray(data.signals.decisionTreePath) && data.signals.decisionTreePath.length > 0) {
          console.log(`  Tree Path: ${data.signals.decisionTreePath.join(' -> ')}`);
        }
      }

      logger.info('');
    } catch (error) {
      logger.error(`Test failed: ${error}`);
      logger.info('');
    }
  }
}
