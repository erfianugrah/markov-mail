/**
 * Batch Test Command
 * Test large email datasets against production API
 */

import { logger } from '../../utils/logger.ts';
import { parseArgs, getOption, hasFlag } from '../../utils/args.ts';
import * as fs from 'fs';

interface EmailData {
  email: string;
  type: 'legitimate' | 'fraudulent';
  category: string;
}

interface TestDataset {
  generated: string;
  count: number;
  legitimate: number;
  fraudulent: number;
  emails: EmailData[];
}

interface TestResult {
  email: string;
  expected: string;
  actual: string;
  riskScore: number;
  reason: string;
  passed: boolean;
  category: string;
  latency: number;
}

async function testEmail(
  email: string,
  endpoint: string
): Promise<{ decision: string; riskScore: number; reason: string; latency: number }> {
  const startTime = Date.now();

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
    });

    const latency = Date.now() - startTime;

    // Check for minimal response (403 Forbidden with headers)
    if (response.status === 403) {
      const decision = response.headers.get('x-fraud-decision') || 'block';
      const riskScore = parseFloat(response.headers.get('x-fraud-risk-score') || '0');
      const reason = response.headers.get('x-fraud-reason') || 'unknown';
      return { decision, riskScore, reason, latency };
    }

    // Full JSON response
    const data = await response.json() as any;

    if (response.ok) {
      return {
        decision: data.decision || 'allow',
        riskScore: data.riskScore || 0,
        reason: data.message || 'allowed',
        latency,
      };
    } else {
      return {
        decision: 'block',
        riskScore: data.riskScore || 0,
        reason: data.reason || 'blocked',
        latency,
      };
    }
  } catch (error) {
    return {
      decision: 'error',
      riskScore: 0,
      reason: error instanceof Error ? error.message : 'Unknown error',
      latency: Date.now() - startTime,
    };
  }
}

function calculateMetrics(results: TestResult[]) {
  const totalTests = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  const legitimateTests = results.filter(r => r.expected === 'legit');
  const fraudTests = results.filter(r => r.expected === 'fraud');

  const truePositives = fraudTests.filter(r => (r.actual === 'block' || r.actual === 'warn') && r.passed).length;
  const falseNegatives = fraudTests.filter(r => r.actual === 'allow').length;
  const trueNegatives = legitimateTests.filter(r => r.actual === 'allow' && r.passed).length;
  const falsePositives = legitimateTests.filter(r => (r.actual === 'block' || r.actual === 'warn')).length;

  const accuracy = (passed / totalTests) * 100;
  const precision = truePositives / (truePositives + falsePositives) || 0;
  const recall = truePositives / (truePositives + falseNegatives) || 0;
  const f1Score = (2 * precision * recall) / (precision + recall) || 0;

  const avgLatency = results.reduce((sum, r) => sum + r.latency, 0) / results.length;

  return {
    totalTests,
    passed,
    failed,
    accuracy,
    truePositives,
    falsePositives,
    trueNegatives,
    falseNegatives,
    precision: precision * 100,
    recall: recall * 100,
    f1Score: f1Score * 100,
    avgLatency,
  };
}

export default async function batch(args: string[]) {
  const parsed = parseArgs(args);

  if (hasFlag(parsed, 'help', 'h')) {
    console.log(`
╔════════════════════════════════════════════════════════╗
║              Batch Test Command                        ║
╚════════════════════════════════════════════════════════╝

Test large email datasets against production API.

USAGE
  npm run cli test:batch [options]

OPTIONS
  --input <path>        Input JSON file with test emails (required)
  --endpoint <url>      API endpoint to test (default: https://your-worker.workers.dev/validate)
  --output <path>       Output file for results (default: /tmp/batch-test-results.json)
  --concurrency <n>     Number of concurrent requests (default: 10)
  --help, -h            Show this help message

EXAMPLES
  npm run cli test:batch --input /tmp/test_emails_5k.json
  npm run cli test:batch --input test-data/generated-emails.json --concurrency 20
`);
    return;
  }

  const inputPath = getOption(parsed, 'input');
  if (!inputPath) {
    logger.error('Missing required --input parameter');
    console.log('Run with --help for usage information');
    process.exit(1);
  }

  const endpoint = getOption(parsed, 'endpoint') || 'https://your-worker.workers.dev/validate';
  const outputPath = getOption(parsed, 'output') || '/tmp/batch-test-results.json';
  const concurrency = parseInt(getOption(parsed, 'concurrency') || '10');

  logger.section('🧪 Batch Testing');
  logger.info(`Input: ${inputPath}`);
  logger.info(`Endpoint: ${endpoint}`);
  logger.info(`Concurrency: ${concurrency}`);

  // Load test dataset
  if (!fs.existsSync(inputPath)) {
    logger.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const dataset: TestDataset = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  logger.info(`Loaded ${dataset.count} emails (${dataset.legitimate} legit, ${dataset.fraudulent} fraud)`);

  const results: TestResult[] = [];
  let processed = 0;
  const startTime = Date.now();

  // Process in batches
  const emailBatches: EmailData[][] = [];
  for (let i = 0; i < dataset.emails.length; i += concurrency) {
    emailBatches.push(dataset.emails.slice(i, i + concurrency));
  }

  console.log('\nTesting emails...\n');

  for (const batch of emailBatches) {
    const batchPromises = batch.map(async (emailData) => {
      const result = await testEmail(emailData.email, endpoint);
      const expected = emailData.type === 'legitimate' ? 'legit' : 'fraud';
      const passed =
        (expected === 'legit' && result.decision === 'allow') ||
        (expected === 'fraud' && (result.decision === 'block' || result.decision === 'warn'));

      return {
        email: emailData.email,
        expected,
        actual: result.decision,
        riskScore: result.riskScore,
        reason: result.reason,
        passed,
        category: emailData.category,
        latency: result.latency,
      };
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
    processed += batch.length;

    // Progress indicator
    const progress = (processed / dataset.count * 100).toFixed(1);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const rate = (processed / (Date.now() - startTime) * 1000).toFixed(1);
    process.stdout.write(`\rProgress: ${processed}/${dataset.count} (${progress}%) | ${elapsed}s elapsed | ${rate} req/s`);
  }

  console.log('\n');

  // Calculate metrics
  const metrics = calculateMetrics(results);

  // Display results
  logger.section('📊 Test Results');
  console.log(`\nOverall Performance:`);
  console.log(`  Total Tests:        ${metrics.totalTests}`);
  console.log(`  Passed:             ${metrics.passed} (${metrics.accuracy.toFixed(2)}%)`);
  console.log(`  Failed:             ${metrics.failed} (${(100 - metrics.accuracy).toFixed(2)}%)`);
  console.log(`  Avg Latency:        ${metrics.avgLatency.toFixed(0)}ms`);
  console.log(`  Total Time:         ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

  console.log(`\nConfusion Matrix:`);
  console.log(`  True Positives:     ${metrics.truePositives} (fraud correctly detected)`);
  console.log(`  False Positives:    ${metrics.falsePositives} (legit incorrectly flagged)`);
  console.log(`  True Negatives:     ${metrics.trueNegatives} (legit correctly allowed)`);
  console.log(`  False Negatives:    ${metrics.falseNegatives} (fraud incorrectly allowed)`);

  console.log(`\nDetailed Metrics:`);
  console.log(`  Precision:          ${metrics.precision.toFixed(2)}% (of flagged, how many were fraud)`);
  console.log(`  Recall:             ${metrics.recall.toFixed(2)}% (of all fraud, how many we caught)`);
  console.log(`  F1 Score:           ${metrics.f1Score.toFixed(2)}% (harmonic mean)`);
  console.log(`  False Positive Rate: ${(metrics.falsePositives / (metrics.falsePositives + metrics.trueNegatives) * 100).toFixed(2)}%`);
  console.log(`  False Negative Rate: ${(metrics.falseNegatives / (metrics.falseNegatives + metrics.truePositives) * 100).toFixed(2)}%`);

  // Category breakdown
  console.log(`\n${'='.repeat(80)}`);
  console.log('📋 CATEGORY BREAKDOWN');
  console.log('='.repeat(80));

  const categories = [...new Set(results.map(r => r.category))];
  categories.sort();

  for (const category of categories) {
    const categoryResults = results.filter(r => r.category === category);
    const categoryPassed = categoryResults.filter(r => r.passed).length;
    const categoryTotal = categoryResults.length;
    const categoryAccuracy = (categoryPassed / categoryTotal) * 100;

    console.log(`\n${category}: ${categoryPassed}/${categoryTotal} (${categoryAccuracy.toFixed(1)}%)`);
  }

  // Save results
  const report = {
    timestamp: new Date().toISOString(),
    endpoint,
    dataset: {
      input: inputPath,
      legitimate: dataset.legitimate,
      fraudulent: dataset.fraudulent,
      total: dataset.count,
    },
    metrics,
    categoryBreakdown: categories.map(cat => {
      const catResults = results.filter(r => r.category === cat);
      return {
        category: cat,
        total: catResults.length,
        passed: catResults.filter(r => r.passed).length,
        accuracy: (catResults.filter(r => r.passed).length / catResults.length * 100),
      };
    }),
    samples: {
      falsePositives: results.filter(r => !r.passed && r.expected === 'legit').slice(0, 10),
      falseNegatives: results.filter(r => !r.passed && r.expected === 'fraud').slice(0, 10),
    },
  };

  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  logger.success(`\n✅ Results saved to: ${outputPath}`);
}
