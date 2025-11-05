/**
 * Batch Test Command
 * Test large email datasets against production API
 *
 * Supports both CSV and JSON input formats
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

/**
 * Parse CSV file into EmailData array
 * Auto-detects column positions based on header row
 * Supports: email, type/category columns (ignores IP and other columns)
 * Example: person1@example.com,192.168.1.1,legitimate,professional
 */
function parseCSV(content: string): { emails: EmailData[], hasLabels: boolean } {
  const lines = content.trim().split('\n');
  const emails: EmailData[] = [];

  if (lines.length === 0) {
    return { emails, hasLabels: false };
  }

  // Parse header to detect column positions
  const firstLine = lines[0].trim().toLowerCase();
  const hasHeader = firstLine.includes('email');

  let emailCol = 0;
  let typeCol = -1;
  let categoryCol = -1;

  if (hasHeader) {
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    emailCol = headers.findIndex(h => h === 'email' || h === 'email_address');
    typeCol = headers.findIndex(h => h === 'type' || h === 'label' || h === 'classification');
    categoryCol = headers.findIndex(h => h === 'category' || h === 'subcategory');

    if (emailCol === -1) {
      // No email column found, assume first column
      emailCol = 0;
    }
  }

  const hasLabels = typeCol !== -1;
  const startIdx = hasHeader ? 1 : 0;

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip empty lines
    if (!line) continue;

    const columns = line.split(',').map(s => s.trim());

    const email = columns[emailCol];
    if (!email || !email.includes('@')) {
      logger.warn(`Skipping line ${i + 1}: invalid or missing email`);
      continue;
    }

    // Extract type if column exists
    let emailType: 'legitimate' | 'fraudulent' = 'legitimate';
    if (typeCol !== -1 && columns[typeCol]) {
      const normalized = columns[typeCol].toLowerCase();
      if (normalized === 'fraudulent' || normalized === 'fraud') {
        emailType = 'fraudulent';
      } else if (normalized === 'legitimate' || normalized === 'legit') {
        emailType = 'legitimate';
      } else {
        logger.warn(`Line ${i + 1}: unknown type "${columns[typeCol]}", defaulting to legitimate`);
      }
    }

    // Extract category if column exists
    const category = categoryCol !== -1 && columns[categoryCol] ? columns[categoryCol] : 'unknown';

    emails.push({
      email,
      type: emailType,
      category,
    });
  }

  return { emails, hasLabels };
}

/**
 * Load dataset from file (supports both CSV and JSON)
 */
function loadDataset(filePath: string): { dataset: TestDataset, hasLabels: boolean } {
  const content = fs.readFileSync(filePath, 'utf-8');

  // Try JSON first
  if (filePath.endsWith('.json')) {
    return { dataset: JSON.parse(content) as TestDataset, hasLabels: true };
  }

  // Parse as CSV
  if (filePath.endsWith('.csv')) {
    const { emails, hasLabels } = parseCSV(content);
    const legitimate = emails.filter(e => e.type === 'legitimate').length;
    const fraudulent = emails.filter(e => e.type === 'fraudulent').length;

    return {
      dataset: {
        generated: new Date().toISOString(),
        count: emails.length,
        legitimate,
        fraudulent,
        emails,
      },
      hasLabels,
    };
  }

  // Auto-detect format
  const trimmed = content.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    // Looks like JSON
    return { dataset: JSON.parse(content) as TestDataset, hasLabels: true };
  } else {
    // Assume CSV
    const { emails, hasLabels } = parseCSV(content);
    const legitimate = emails.filter(e => e.type === 'legitimate').length;
    const fraudulent = emails.filter(e => e.type === 'fraudulent').length;

    return {
      dataset: {
        generated: new Date().toISOString(),
        count: emails.length,
        legitimate,
        fraudulent,
        emails,
      },
      hasLabels,
    };
  }
}

export default async function batch(args: string[]) {
  const parsed = parseArgs(args);

  if (hasFlag(parsed, 'help', 'h')) {
    console.log(`
╔════════════════════════════════════════════════════════╗
║              Batch Test Command                        ║
╚════════════════════════════════════════════════════════╝

Test large email datasets against production API.
Supports both CSV and JSON input formats.

USAGE
  npm run cli test:batch [options]

OPTIONS
  --input <path>        Input CSV or JSON file with test emails (required)
  --endpoint <url>      API endpoint to test (default: https://your-worker.workers.dev/validate)
  --output <path>       Output file for results (default: /tmp/batch-test-results.json)
  --concurrency <n>     Number of concurrent requests (default: 10)
  --help, -h            Show this help message

CSV FORMAT
  Auto-detects columns based on header row. Supports any column order.
  Required: email column
  Optional: type/label, category, IP (ignored), and other columns

  Example with header:
    email,ip,type,category
    person1@example.com,192.168.1.1,legitimate,professional
    test123@gmail.com,10.0.0.1,fraudulent,sequential

  Example without header (assumes first column is email):
    person1@example.com,legitimate,professional
    test123@gmail.com,fraudulent,sequential

  - Type: "legitimate"/"legit" or "fraudulent"/"fraud" (defaults to legitimate)
  - Category: any string (defaults to "unknown")

JSON FORMAT
  {
    "generated": "2025-01-05T12:00:00Z",
    "count": 100,
    "legitimate": 50,
    "fraudulent": 50,
    "emails": [
      {"email": "test@example.com", "type": "legitimate", "category": "professional"}
    ]
  }

EXAMPLES
  npm run cli test:batch --input /tmp/test_emails.csv
  npm run cli test:batch --input /tmp/test_emails_5k.json
  npm run cli test:batch --input test-data/generated-emails.csv --concurrency 20
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

  // Auto-detect format and load (supports CSV and JSON)
  const { dataset, hasLabels } = loadDataset(inputPath);
  const format = inputPath.endsWith('.csv') ? 'CSV' : inputPath.endsWith('.json') ? 'JSON' : 'auto-detected';

  if (hasLabels) {
    logger.info(`Loaded ${dataset.count} emails from ${format} file (${dataset.legitimate} legit, ${dataset.fraudulent} fraud)`);
  } else {
    logger.info(`Loaded ${dataset.count} emails from ${format} file (unlabeled data - validation mode)`);
    logger.warn('No type/label column found - will show validation results without accuracy metrics');
  }

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

  // Display results
  logger.section('📊 Validation Results');

  if (hasLabels) {
    // Calculate metrics for labeled data
    const metrics = calculateMetrics(results);

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
  } else {
    // Show distribution for unlabeled data
    const allowCount = results.filter(r => r.actual === 'allow').length;
    const warnCount = results.filter(r => r.actual === 'warn').length;
    const blockCount = results.filter(r => r.actual === 'block').length;
    const avgLatency = results.reduce((sum, r) => sum + r.latency, 0) / results.length;
    const avgRiskScore = results.reduce((sum, r) => sum + r.riskScore, 0) / results.length;

    console.log(`\nValidation Summary (Unlabeled Data):`);
    console.log(`  Total Emails:       ${results.length}`);
    console.log(`  Allowed:            ${allowCount} (${(allowCount / results.length * 100).toFixed(1)}%)`);
    console.log(`  Warned:             ${warnCount} (${(warnCount / results.length * 100).toFixed(1)}%)`);
    console.log(`  Blocked:            ${blockCount} (${(blockCount / results.length * 100).toFixed(1)}%)`);
    console.log(`  Avg Risk Score:     ${avgRiskScore.toFixed(3)}`);
    console.log(`  Avg Latency:        ${avgLatency.toFixed(0)}ms`);
    console.log(`  Total Time:         ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

    console.log(`\nRisk Distribution:`);
    const lowRisk = results.filter(r => r.riskScore < 0.3).length;
    const medRisk = results.filter(r => r.riskScore >= 0.3 && r.riskScore < 0.6).length;
    const highRisk = results.filter(r => r.riskScore >= 0.6).length;
    console.log(`  Low Risk (<0.3):    ${lowRisk} (${(lowRisk / results.length * 100).toFixed(1)}%)`);
    console.log(`  Medium Risk (0.3-0.6): ${medRisk} (${(medRisk / results.length * 100).toFixed(1)}%)`);
    console.log(`  High Risk (>0.6):   ${highRisk} (${(highRisk / results.length * 100).toFixed(1)}%)`);
  }

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
  let report: any;

  if (hasLabels) {
    // Accuracy testing report
    const metrics = calculateMetrics(results);
    report = {
      timestamp: new Date().toISOString(),
      endpoint,
      mode: 'accuracy_testing',
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
  } else {
    // Validation report (unlabeled data)
    const allowCount = results.filter(r => r.actual === 'allow').length;
    const warnCount = results.filter(r => r.actual === 'warn').length;
    const blockCount = results.filter(r => r.actual === 'block').length;
    const avgLatency = results.reduce((sum, r) => sum + r.latency, 0) / results.length;
    const avgRiskScore = results.reduce((sum, r) => sum + r.riskScore, 0) / results.length;

    report = {
      timestamp: new Date().toISOString(),
      endpoint,
      mode: 'validation_only',
      dataset: {
        input: inputPath,
        total: dataset.count,
      },
      summary: {
        totalEmails: results.length,
        decisions: {
          allow: allowCount,
          warn: warnCount,
          block: blockCount,
        },
        percentages: {
          allow: (allowCount / results.length * 100),
          warn: (warnCount / results.length * 100),
          block: (blockCount / results.length * 100),
        },
        avgRiskScore,
        avgLatency,
      },
      riskDistribution: {
        low: results.filter(r => r.riskScore < 0.3).length,
        medium: results.filter(r => r.riskScore >= 0.3 && r.riskScore < 0.6).length,
        high: results.filter(r => r.riskScore >= 0.6).length,
      },
      topBlocked: results.filter(r => r.actual === 'block').slice(0, 20).map(r => ({
        email: r.email,
        riskScore: r.riskScore,
        reason: r.reason,
      })),
      topWarned: results.filter(r => r.actual === 'warn').slice(0, 20).map(r => ({
        email: r.email,
        riskScore: r.riskScore,
        reason: r.reason,
      })),
    };
  }

  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  logger.success(`\n✅ Results saved to: ${outputPath}`);
}
