/**
 * Calibration Drift Monitoring Command
 *
 * Tracks how often calibration boosts/suppresses Markov confidence
 * to detect when calibration needs retraining.
 */

import { logger } from '../../utils/logger.ts';
import { parseArgs, getOption, hasFlag } from '../../utils/args.ts';

export default async function driftMonitor(args: string[]) {
  const parsed = parseArgs(args);

  if (hasFlag(parsed, 'help', 'h')) {
    printHelp();
    return;
  }

  const hours = parseInt(getOption(parsed, 'hours') || '24', 10);
  const baseUrl = getOption(parsed, 'url') || 'https://fraud.erfi.dev';
  const apiKey = getOption(parsed, 'api-key') || process.env.FRAUD_API_KEY || process.env.ADMIN_API_KEY;

  if (!apiKey) {
    logger.error('❌ API key required. Set FRAUD_API_KEY or ADMIN_API_KEY environment variable or use --api-key');
    process.exit(1);
  }

  logger.section('📊 Calibration Drift Analysis');
  logger.info(`Time window: Last ${hours} hours`);
  logger.info(`Endpoint: ${baseUrl}/admin/analytics`);
  console.log();

  try {
    // Query 1: Overall calibration usage
    const usageQuery = `
      SELECT
        COUNT(*) as total_requests,
        SUM(CASE WHEN classification_risk IS NOT NULL THEN 1 ELSE 0 END) as has_classification,
        SUM(CASE WHEN calibrated_fraud_probability IS NOT NULL THEN 1 ELSE 0 END) as has_calibration,
        ROUND(
          100.0 * SUM(CASE WHEN calibrated_fraud_probability IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*),
          2
        ) as calibration_usage_pct
      FROM ANALYTICS_DATASET
      WHERE timestamp >= datetime('now', '-${hours} hours')
    `;

    const usageData = await executeQuery(baseUrl, apiKey, usageQuery);
    const usage = usageData.data[0];

    logger.subsection('Calibration Usage');
    logger.info(`Total requests: ${usage.total_requests.toLocaleString()}`);
    logger.info(`Has classification risk: ${usage.has_classification.toLocaleString()} (${(100 * usage.has_classification / usage.total_requests).toFixed(1)}%)`);
    logger.info(`Has calibration: ${usage.has_calibration.toLocaleString()} (${usage.calibration_usage_pct}%)`);
    console.log();

    // Query 2: Boost vs suppress behavior
    const driftQuery = `
      SELECT
        SUM(CASE WHEN calibrated_fraud_probability > markov_confidence THEN 1 ELSE 0 END) as boost_count,
        SUM(CASE WHEN calibrated_fraud_probability < markov_confidence THEN 1 ELSE 0 END) as suppress_count,
        SUM(CASE WHEN calibrated_fraud_probability = markov_confidence THEN 1 ELSE 0 END) as equal_count,
        AVG(calibrated_fraud_probability - markov_confidence) as avg_difference,
        AVG(CASE WHEN calibrated_fraud_probability > markov_confidence
            THEN calibrated_fraud_probability - markov_confidence
            ELSE NULL END) as avg_boost,
        AVG(CASE WHEN calibrated_fraud_probability < markov_confidence
            THEN markov_confidence - calibrated_fraud_probability
            ELSE NULL END) as avg_suppress
      FROM ANALYTICS_DATASET
      WHERE timestamp >= datetime('now', '-${hours} hours')
        AND calibrated_fraud_probability IS NOT NULL
        AND markov_confidence IS NOT NULL
    `;

    const driftData = await executeQuery(baseUrl, apiKey, driftQuery);
    const drift = driftData.data[0];

    const total = drift.boost_count + drift.suppress_count + drift.equal_count;
    const boostPct = total > 0 ? (100 * drift.boost_count / total).toFixed(1) : '0.0';
    const suppressPct = total > 0 ? (100 * drift.suppress_count / total).toFixed(1) : '0.0';
    const equalPct = total > 0 ? (100 * drift.equal_count / total).toFixed(1) : '0.0';

    logger.subsection('Calibration Behavior');
    logger.info(`Boost (calibrated > markov): ${drift.boost_count.toLocaleString()} (${boostPct}%)`);
    logger.info(`Suppress (calibrated < markov): ${drift.suppress_count.toLocaleString()} (${suppressPct}%)`);
    logger.info(`Equal: ${drift.equal_count.toLocaleString()} (${equalPct}%)`);
    console.log();

    logger.subsection('Calibration Impact');
    logger.info(`Average difference: ${drift.avg_difference?.toFixed(4) || 'N/A'}`);
    logger.info(`Average boost amount: ${drift.avg_boost?.toFixed(4) || 'N/A'}`);
    logger.info(`Average suppress amount: ${drift.avg_suppress?.toFixed(4) || 'N/A'}`);
    console.log();

    // Query 3: Distribution of differences
    const distributionQuery = `
      SELECT
        CASE
          WHEN ABS(calibrated_fraud_probability - markov_confidence) < 0.05 THEN 'Very small (<0.05)'
          WHEN ABS(calibrated_fraud_probability - markov_confidence) < 0.10 THEN 'Small (0.05-0.10)'
          WHEN ABS(calibrated_fraud_probability - markov_confidence) < 0.20 THEN 'Medium (0.10-0.20)'
          ELSE 'Large (>0.20)'
        END as diff_range,
        COUNT(*) as count
      FROM ANALYTICS_DATASET
      WHERE timestamp >= datetime('now', '-${hours} hours')
        AND calibrated_fraud_probability IS NOT NULL
        AND markov_confidence IS NOT NULL
      GROUP BY diff_range
      ORDER BY
        CASE diff_range
          WHEN 'Very small (<0.05)' THEN 1
          WHEN 'Small (0.05-0.10)' THEN 2
          WHEN 'Medium (0.10-0.20)' THEN 3
          WHEN 'Large (>0.20)' THEN 4
        END
    `;

    const distributionData = await executeQuery(baseUrl, apiKey, distributionQuery);

    logger.subsection('Difference Distribution');
    for (const row of distributionData.data) {
      const pct = total > 0 ? (100 * row.count / total).toFixed(1) : '0.0';
      logger.info(`${row.diff_range}: ${row.count.toLocaleString()} (${pct}%)`);
    }
    console.log();

    // Query 4: Fraud detection impact
    const impactQuery = `
      SELECT
        decision,
        COUNT(*) as count,
        AVG(markov_confidence) as avg_markov,
        AVG(calibrated_fraud_probability) as avg_calibrated,
        AVG(risk_score) as avg_risk_score
      FROM ANALYTICS_DATASET
      WHERE timestamp >= datetime('now', '-${hours} hours')
        AND calibrated_fraud_probability IS NOT NULL
        AND markov_confidence IS NOT NULL
      GROUP BY decision
      ORDER BY
        CASE decision
          WHEN 'block' THEN 1
          WHEN 'warn' THEN 2
          WHEN 'allow' THEN 3
          ELSE 4
        END
    `;

    const impactData = await executeQuery(baseUrl, apiKey, impactQuery);

    logger.subsection('Impact by Decision');
    for (const row of impactData.data) {
      logger.info(`${row.decision}: ${row.count.toLocaleString()} requests`);
      logger.info(`  Avg Markov: ${row.avg_markov?.toFixed(3) || 'N/A'}`);
      logger.info(`  Avg Calibrated: ${row.avg_calibrated?.toFixed(3) || 'N/A'}`);
      logger.info(`  Avg Risk Score: ${row.avg_risk_score?.toFixed(3) || 'N/A'}`);
    }
    console.log();

    // Health checks
    logger.subsection('🏥 Health Assessment');

    const alerts: Array<{ level: 'error' | 'warning' | 'info', message: string }> = [];

    // Alert 1: High suppression rate
    const suppressRateThreshold = 10; // 10%
    if (parseFloat(suppressPct) > suppressRateThreshold) {
      alerts.push({
        level: 'warning',
        message: `High suppression rate (${suppressPct}%) - calibration is frequently lower than Markov (threshold: ${suppressRateThreshold}%)`
      });
    }

    // Alert 2: Large average suppression
    if (drift.avg_suppress && drift.avg_suppress > 0.15) {
      alerts.push({
        level: 'error',
        message: `Large average suppression (${drift.avg_suppress.toFixed(3)}) - calibration is significantly diverging from Markov`
      });
    }

    // Alert 3: Low calibration usage
    if (parseFloat(usage.calibration_usage_pct) < 50) {
      alerts.push({
        level: 'warning',
        message: `Low calibration usage (${usage.calibration_usage_pct}%) - many requests missing calibration data`
      });
    }

    // Alert 4: Very high boost rate
    if (parseFloat(boostPct) > 80) {
      alerts.push({
        level: 'info',
        message: `Very high boost rate (${boostPct}%) - calibration is consistently increasing risk beyond Markov`
      });
    }

    if (alerts.length === 0) {
      logger.success('✅ No drift alerts - calibration appears healthy');
    } else {
      for (const alert of alerts) {
        if (alert.level === 'error') {
          logger.error(`❌ ${alert.message}`);
        } else if (alert.level === 'warning') {
          logger.warn(`⚠️  ${alert.message}`);
        } else {
          logger.info(`ℹ️  ${alert.message}`);
        }
      }

      console.log();
      if (alerts.some(a => a.level === 'error' || a.level === 'warning')) {
        logger.warn('📋 Recommended Actions:');
        logger.info('  1. Review recent calibration training data quality');
        logger.info('  2. Check if dataset distribution has shifted');
        logger.info('  3. Consider retraining calibration:');
        logger.info('     npm run cli train:calibrate --dataset dataset/training_compiled.csv --models models --upload --remote');
      }
    }

  } catch (error) {
    logger.error(`❌ Failed to analyze drift: ${error}`);
    if (error instanceof Error && error.message.includes('401')) {
      logger.info('Hint: Check your API key is valid and has admin access');
    }
    process.exit(1);
  }
}

async function executeQuery(baseUrl: string, apiKey: string, query: string): Promise<any> {
  const url = `${baseUrl}/admin/analytics`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': apiKey,
    },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return await response.json();
}

function printHelp() {
  console.log(`
╔════════════════════════════════════════════════════════╗
║          Calibration Drift Monitoring                  ║
╚════════════════════════════════════════════════════════╝

Analyzes how calibration layer affects fraud detection to detect
when calibration needs retraining.

Monitors:
  - Calibration usage rate (% of requests using calibration)
  - Boost vs suppress behavior (how often calibration adjusts Markov)
  - Average difference between calibrated and Markov scores
  - Distribution of differences
  - Impact on fraud detection decisions

USAGE
  npm run cli analytics:drift [options]

OPTIONS
  --hours <n>         Time window in hours (default: 24)
  --url <url>         Base URL (default: https://fraud.erfi.dev)
  --api-key <key>     Admin API key (or set FRAUD_API_KEY env var)
  --help, -h          Show this help message

EXAMPLES
  # Analyze last 24 hours (default)
  FRAUD_API_KEY=xxx npm run cli analytics:drift

  # Analyze last 7 days
  FRAUD_API_KEY=xxx npm run cli analytics:drift --hours 168

  # Use custom endpoint
  npm run cli analytics:drift --url http://localhost:8787 --api-key xxx

HEALTH ALERTS
  - Warning: Suppression rate > 10% (calibration frequently lowers Markov)
  - Error: Average suppression > 0.15 (large divergence from Markov)
  - Warning: Calibration usage < 50% (missing calibration data)
  - Info: Boost rate > 80% (calibration consistently raising risk)

RECOMMENDED ACTIONS
When alerts are triggered:
  1. Review calibration training data quality
  2. Check for dataset distribution shifts
  3. Retrain calibration with fresh data
  4. Verify config.json in KV matches deployed code
`);
}
