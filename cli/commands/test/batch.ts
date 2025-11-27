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
  // Separate error results from valid test results
  const errorResults = results.filter(r => r.actual === 'error');
  const validResults = results.filter(r => r.actual !== 'error');

  // If there are network errors, abort metrics calculation
  if (errorResults.length > 0) {
    const errorRate = ((errorResults.length / results.length) * 100).toFixed(2);
    logger.error(`ABORT: ${errorResults.length} network/API errors detected (${errorRate}%) - metrics would be invalid`);
    logger.error(`Sample errors: ${errorResults.slice(0, 3).map(r => `${r.email}: ${r.reason}`).join(', ')}`);

    return {
      totalTests: results.length,
      errors: errorResults.length,
      passed: 0,
      failed: 0,
      accuracy: 0,
      truePositives: 0,
      falsePositives: 0,
      trueNegatives: 0,
      falseNegatives: 0,
      precision: 0,
      recall: 0,
      f1Score: 0,
      avgLatency: 0,
      aborted: true,
      abortReason: `${errorResults.length} network/API errors - endpoint unreachable or returning errors`,
    };
  }

  const totalTests = validResults.length;
  const passed = validResults.filter(r => r.passed).length;
  const failed = validResults.filter(r => !r.passed).length;

  const legitimateTests = validResults.filter(r => r.expected === 'legit');
  const fraudTests = validResults.filter(r => r.expected === 'fraud');

  const truePositives = fraudTests.filter(r => (r.actual === 'block' || r.actual === 'warn') && r.passed).length;
  const falseNegatives = fraudTests.filter(r => r.actual === 'allow').length;
  const trueNegatives = legitimateTests.filter(r => r.actual === 'allow' && r.passed).length;
  const falsePositives = legitimateTests.filter(r => (r.actual === 'block' || r.actual === 'warn')).length;

  const accuracy = (passed / totalTests) * 100;
  const precision = truePositives / (truePositives + falsePositives) || 0;
  const recall = truePositives / (truePositives + falseNegatives) || 0;
  const f1Score = (2 * precision * recall) / (precision + recall) || 0;

  const avgLatency = validResults.reduce((sum, r) => sum + r.latency, 0) / validResults.length;

  return {
    totalTests,
    errors: 0,
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
    aborted: false,
  };
}

/**
 * Parse CSV file into EmailData array
 * Auto-detects column positions based on header row
 * Supports: email, type/category columns (ignores IP and other columns)
 * Example: user@example.com,192.168.1.1,legitimate,professional
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
      const value = columns[typeCol].trim();
      const normalized = value.toLowerCase();

      // Support both text and numeric labels
      if (normalized === 'fraudulent' || normalized === 'fraud' || value === '1') {
        emailType = 'fraudulent';
      } else if (normalized === 'legitimate' || normalized === 'legit' || value === '0') {
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
 * Generate HTML report with executive summary and visualizations
 */
function generateHTMLReport(
  report: any,
  metrics: ReturnType<typeof calculateMetrics> | undefined,
  results: TestResult[],
  hasLabels: boolean,
  endpoint: string,
  inputPath: string,
  totalTime: number
): string {
  const timestamp = new Date().toLocaleString();
  const isAccuracyMode = hasLabels && metrics && !metrics.aborted;

  // Helper to get severity indicator
  const getSeverity = (value: number, thresholds: { good: number, moderate: number }): string => {
    if (value >= thresholds.good) return '✅ Good';
    if (value >= thresholds.moderate) return '⚠️ Moderate';
    return '❌ Poor';
  };

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Batch Test Report - ${timestamp}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
           background: #f5f7fa; color: #2c3e50; line-height: 1.6; padding: 20px; }
    .container { max-width: 1200px; margin: 0 auto; background: white; padding: 40px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    h1 { color: #1a1a1a; font-size: 2.5em; margin-bottom: 10px; border-bottom: 4px solid #3498db; padding-bottom: 15px; }
    h2 { color: #2c3e50; font-size: 1.8em; margin: 30px 0 15px; padding: 10px; background: #ecf0f1; border-left: 4px solid #3498db; }
    h3 { color: #34495e; font-size: 1.3em; margin: 20px 0 10px; }
    .meta { color: #7f8c8d; font-size: 0.95em; margin-bottom: 30px; }
    .executive-summary { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px;
                         border-radius: 10px; margin: 30px 0; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3); }
    .executive-summary h2 { color: white; background: transparent; border: none; margin-top: 0; }
    .executive-summary p { font-size: 1.1em; margin: 10px 0; line-height: 1.8; }
    .key-finding { background: rgba(255,255,255,0.15); padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid white; }
    .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin: 20px 0; }
    .metric-card { background: #f8f9fa; border: 2px solid #e9ecef; border-radius: 10px; padding: 20px; text-align: center;
                   transition: transform 0.2s, box-shadow 0.2s; }
    .metric-card:hover { transform: translateY(-5px); box-shadow: 0 6px 20px rgba(0,0,0,0.1); }
    .metric-value { font-size: 2.5em; font-weight: bold; color: #3498db; margin: 10px 0; }
    .metric-label { font-size: 0.9em; color: #7f8c8d; text-transform: uppercase; letter-spacing: 1px; }
    .metric-explanation { font-size: 0.85em; color: #95a5a6; margin-top: 10px; padding-top: 10px; border-top: 1px solid #e0e0e0; }
    .severity { display: inline-block; padding: 5px 15px; border-radius: 20px; font-weight: bold; font-size: 0.9em; margin: 10px 0; }
    .severity-good { background: #d4edda; color: #155724; }
    .severity-moderate { background: #fff3cd; color: #856404; }
    .severity-poor { background: #f8d7da; color: #721c24; }
    .confusion-matrix { margin: 30px auto; max-width: 600px; }
    .matrix-grid { display: grid; grid-template-columns: 100px 1fr 1fr; gap: 2px; background: #ddd; border: 2px solid #999; }
    .matrix-cell { background: white; padding: 20px; text-align: center; font-weight: bold; }
    .matrix-header { background: #34495e; color: white; font-size: 0.9em; display: flex; align-items: center; justify-content: center; }
    .matrix-label { background: #34495e; color: white; font-size: 0.9em; display: flex; align-items: center; justify-content: center; }
    .matrix-tp { background: #d4edda; color: #155724; font-size: 1.5em; }
    .matrix-fp { background: #fff3cd; color: #856404; font-size: 1.5em; }
    .matrix-tn { background: #d4edda; color: #155724; font-size: 1.5em; }
    .matrix-fn { background: #f8d7da; color: #721c24; font-size: 1.5em; }
    .chart-bar { background: #ecf0f1; border-radius: 8px; padding: 15px; margin: 10px 0; }
    .chart-bar-label { font-weight: bold; margin-bottom: 8px; display: flex; justify-content: space-between; }
    .chart-bar-fill { height: 30px; border-radius: 6px; background: linear-gradient(90deg, #3498db, #2980b9);
                      display: flex; align-items: center; padding: 0 10px; color: white; font-weight: bold; transition: width 0.5s ease; }
    .recommendations { background: #fffbea; border: 2px solid #f7dc6f; border-radius: 10px; padding: 25px; margin: 30px 0; }
    .recommendations h3 { color: #f39c12; margin-top: 0; }
    .recommendation-item { background: white; padding: 15px; margin: 10px 0; border-left: 4px solid #f39c12; border-radius: 5px; }
    .recommendation-item strong { color: #e67e22; }
    .category-breakdown { margin: 20px 0; }
    .category-item { background: #f8f9fa; padding: 15px; margin: 10px 0; border-radius: 8px; border-left: 4px solid #9b59b6; }
    .info-box { background: #e8f4f8; border: 2px solid #b8e6f5; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .info-box h4 { color: #2980b9; margin-bottom: 10px; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background: #34495e; color: white; font-weight: bold; }
    tr:hover { background: #f8f9fa; }
    .footer { margin-top: 50px; padding-top: 20px; border-top: 2px solid #ecf0f1; text-align: center; color: #95a5a6; font-size: 0.9em; }
  </style>
</head>
<body>
  <div class="container">
    <h1>📊 Batch Test Report</h1>
    <div class="meta">
      <strong>Generated:</strong> ${timestamp}<br>
      <strong>Endpoint:</strong> ${endpoint}<br>
      <strong>Input File:</strong> ${inputPath}<br>
      <strong>Total Test Time:</strong> ${totalTime.toFixed(1)}s
    </div>
`;

  if (isAccuracyMode && metrics) {
    // Executive Summary
    const overallQuality = metrics.accuracy >= 95 ? 'Excellent' : metrics.accuracy >= 85 ? 'Good' : metrics.accuracy >= 70 ? 'Fair' : 'Poor';
    const fpRate = (metrics.falsePositives / (metrics.falsePositives + metrics.trueNegatives) * 100);
    const fnRate = (metrics.falseNegatives / (metrics.falseNegatives + metrics.truePositives) * 100);

    html += `
    <div class="executive-summary">
      <h2>📋 Executive Summary</h2>
      <p><strong>What This Report Shows:</strong> This is a comprehensive test of your fraud detection system's accuracy. We tested ${metrics.totalTests.toLocaleString()} emails (both legitimate and fraudulent) to see how well the system identifies fraud.</p>

      <div class="key-finding">
        <strong>Overall Performance: ${overallQuality}</strong><br>
        The system correctly identified ${metrics.passed} out of ${metrics.totalTests} emails (${metrics.accuracy.toFixed(1)}% accuracy). ${
          metrics.accuracy >= 95 ? 'This is excellent performance for a fraud detection system.' :
          metrics.accuracy >= 85 ? 'This is good performance with room for minor improvements.' :
          metrics.accuracy >= 70 ? 'This performance is acceptable but could be improved.' :
          'This performance needs improvement to be production-ready.'
        }
      </div>

      <div class="key-finding">
        <strong>False Positive Rate: ${fpRate.toFixed(2)}%</strong><br>
        This means ${fpRate.toFixed(2)}% of legitimate emails were incorrectly flagged as fraud. ${
          fpRate < 5 ? 'This low rate means legitimate users are rarely inconvenienced.' :
          fpRate < 10 ? 'This moderate rate means some legitimate users may be affected.' :
          'This high rate means many legitimate users are being blocked unnecessarily.'
        }
      </div>

      <div class="key-finding">
        <strong>Fraud Detection Rate: ${metrics.recall.toFixed(1)}%</strong><br>
        The system caught ${metrics.recall.toFixed(1)}% of all fraudulent emails. ${
          metrics.recall >= 95 ? 'Very few fraudulent emails slip through.' :
          metrics.recall >= 85 ? 'Most fraud is caught, but some may slip through.' :
          metrics.recall >= 70 ? 'A significant amount of fraud may be missed.' :
          'Too much fraud is getting through the system.'
        }
      </div>
    </div>

    <h2>📈 Performance Metrics</h2>
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-label">Accuracy</div>
        <div class="metric-value">${metrics.accuracy.toFixed(1)}%</div>
        <div class="severity ${metrics.accuracy >= 90 ? 'severity-good' : metrics.accuracy >= 80 ? 'severity-moderate' : 'severity-poor'}">
          ${getSeverity(metrics.accuracy, { good: 90, moderate: 80 })}
        </div>
        <div class="metric-explanation">
          <strong>What does this mean?</strong><br>
          Out of every 100 emails tested, ${Math.round(metrics.accuracy)} were correctly classified. This is the overall correctness of the system.
        </div>
      </div>

      <div class="metric-card">
        <div class="metric-label">Precision</div>
        <div class="metric-value">${metrics.precision.toFixed(1)}%</div>
        <div class="severity ${metrics.precision >= 90 ? 'severity-good' : metrics.precision >= 80 ? 'severity-moderate' : 'severity-poor'}">
          ${getSeverity(metrics.precision, { good: 90, moderate: 80 })}
        </div>
        <div class="metric-explanation">
          <strong>What does this mean?</strong><br>
          When the system flags an email as fraud, it's correct ${Math.round(metrics.precision)}% of the time. Higher is better to avoid blocking legitimate users.
        </div>
      </div>

      <div class="metric-card">
        <div class="metric-label">Recall (Detection Rate)</div>
        <div class="metric-value">${metrics.recall.toFixed(1)}%</div>
        <div class="severity ${metrics.recall >= 90 ? 'severity-good' : metrics.recall >= 80 ? 'severity-moderate' : 'severity-poor'}">
          ${getSeverity(metrics.recall, { good: 90, moderate: 80 })}
        </div>
        <div class="metric-explanation">
          <strong>What does this mean?</strong><br>
          Of all the fraudulent emails, the system catches ${Math.round(metrics.recall)}%. Higher is better to prevent fraud from slipping through.
        </div>
      </div>

      <div class="metric-card">
        <div class="metric-label">F1 Score</div>
        <div class="metric-value">${metrics.f1Score.toFixed(1)}%</div>
        <div class="severity ${metrics.f1Score >= 90 ? 'severity-good' : metrics.f1Score >= 80 ? 'severity-moderate' : 'severity-poor'}">
          ${getSeverity(metrics.f1Score, { good: 90, moderate: 80 })}
        </div>
        <div class="metric-explanation">
          <strong>What does this mean?</strong><br>
          This is the balanced average of precision and recall. It gives you a single number to judge overall system quality.
        </div>
      </div>

      <div class="metric-card">
        <div class="metric-label">False Positive Rate</div>
        <div class="metric-value">${fpRate.toFixed(2)}%</div>
        <div class="severity ${fpRate <= 5 ? 'severity-good' : fpRate <= 10 ? 'severity-moderate' : 'severity-poor'}">
          ${fpRate <= 5 ? '✅ Good' : fpRate <= 10 ? '⚠️ Moderate' : '❌ Poor'}
        </div>
        <div class="metric-explanation">
          <strong>What does this mean?</strong><br>
          ${Math.round(fpRate)} out of every 100 legitimate emails are incorrectly flagged. Lower is better for user experience.
        </div>
      </div>

      <div class="metric-card">
        <div class="metric-label">Average Response Time</div>
        <div class="metric-value">${metrics.avgLatency.toFixed(0)}ms</div>
        <div class="severity ${metrics.avgLatency <= 200 ? 'severity-good' : metrics.avgLatency <= 500 ? 'severity-moderate' : 'severity-poor'}">
          ${metrics.avgLatency <= 200 ? '✅ Good' : metrics.avgLatency <= 500 ? '⚠️ Moderate' : '❌ Poor'}
        </div>
        <div class="metric-explanation">
          <strong>What does this mean?</strong><br>
          Each email check takes ${metrics.avgLatency.toFixed(0)} milliseconds on average. Under 200ms is excellent for real-time use.
        </div>
      </div>
    </div>

    <h2>🔢 Confusion Matrix</h2>
    <div class="info-box">
      <h4>Understanding the Confusion Matrix</h4>
      <p>This table shows how the system classified emails compared to their actual status. Green cells are correct, yellow/red cells are errors.</p>
    </div>

    <div class="confusion-matrix">
      <div class="matrix-grid">
        <div class="matrix-cell"></div>
        <div class="matrix-header">Predicted: Fraud</div>
        <div class="matrix-header">Predicted: Legitimate</div>

        <div class="matrix-label">Actually Fraud</div>
        <div class="matrix-cell matrix-tp">
          ${metrics.truePositives}<br>
          <small style="font-size: 0.7em;">True Positives<br>✅ Correctly blocked fraud</small>
        </div>
        <div class="matrix-cell matrix-fn">
          ${metrics.falseNegatives}<br>
          <small style="font-size: 0.7em;">False Negatives<br>❌ Missed fraud</small>
        </div>

        <div class="matrix-label">Actually Legitimate</div>
        <div class="matrix-cell matrix-fp">
          ${metrics.falsePositives}<br>
          <small style="font-size: 0.7em;">False Positives<br>⚠️ Wrongly blocked legit</small>
        </div>
        <div class="matrix-cell matrix-tn">
          ${metrics.trueNegatives}<br>
          <small style="font-size: 0.7em;">True Negatives<br>✅ Correctly allowed legit</small>
        </div>
      </div>
    </div>

    <div class="info-box">
      <p><strong>True Positives (${metrics.truePositives}):</strong> Fraudulent emails that were correctly identified and blocked.</p>
      <p><strong>False Positives (${metrics.falsePositives}):</strong> Legitimate emails that were incorrectly flagged as fraud. These hurt user experience.</p>
      <p><strong>True Negatives (${metrics.trueNegatives}):</strong> Legitimate emails that were correctly allowed through.</p>
      <p><strong>False Negatives (${metrics.falseNegatives}):</strong> Fraudulent emails that slipped through. These are security risks.</p>
    </div>
`;

    // Category breakdown
    if (report.categoryBreakdown && report.categoryBreakdown.length > 0) {
      html += `
    <h2>📊 Performance by Category</h2>
    <div class="category-breakdown">
`;
      report.categoryBreakdown.forEach((cat: any) => {
        const width = Math.round(cat.accuracy);
        html += `
      <div class="chart-bar">
        <div class="chart-bar-label">
          <span>${cat.category}</span>
          <span>${cat.passed}/${cat.total} (${cat.accuracy.toFixed(1)}%)</span>
        </div>
        <div class="chart-bar-fill" style="width: ${width}%;">${cat.accuracy.toFixed(1)}%</div>
      </div>
`;
      });
      html += `    </div>`;
    }

    // Recommendations
    html += `
    <div class="recommendations">
      <h3>💡 Actionable Recommendations</h3>
`;

    if (fpRate > 10) {
      html += `
      <div class="recommendation-item">
        <strong>High False Positive Rate Alert</strong><br>
        ${fpRate.toFixed(1)}% of legitimate emails are being blocked. This can frustrate real users. Consider:
        <ul>
          <li>Review and tune fraud detection thresholds</li>
          <li>Analyze the ${metrics.falsePositives} false positives to find patterns</li>
          <li>Consider implementing a warning system instead of immediate blocking</li>
        </ul>
      </div>
`;
    }

    if (metrics.recall < 85) {
      html += `
      <div class="recommendation-item">
        <strong>Low Fraud Detection Rate</strong><br>
        Only ${metrics.recall.toFixed(1)}% of fraud is being caught. To improve:
        <ul>
          <li>Strengthen detection rules for the ${metrics.falseNegatives} missed fraudulent emails</li>
          <li>Review detection patterns - ${fnRate.toFixed(1)}% of fraud is slipping through</li>
          <li>Consider adding additional fraud indicators to your detection logic</li>
        </ul>
      </div>
`;
    }

    if (metrics.accuracy >= 90 && fpRate < 5) {
      html += `
      <div class="recommendation-item">
        <strong>Excellent Performance!</strong><br>
        Your system is performing very well with ${metrics.accuracy.toFixed(1)}% accuracy and only ${fpRate.toFixed(2)}% false positives.
        <ul>
          <li>Continue monitoring performance with regular batch tests</li>
          <li>Consider this baseline for future improvements</li>
          <li>Document current thresholds and detection rules</li>
        </ul>
      </div>
`;
    }

    if (metrics.avgLatency > 500) {
      html += `
      <div class="recommendation-item">
        <strong>Performance Optimization Needed</strong><br>
        Average response time of ${metrics.avgLatency.toFixed(0)}ms is high for real-time fraud detection.
        <ul>
          <li>Consider caching frequently checked patterns</li>
          <li>Optimize database queries and model inference</li>
          <li>Profile code to identify bottlenecks</li>
        </ul>
      </div>
`;
    }

    html += `
    </div>
`;

    // Failed cases
    if (report.samples && (report.samples.falsePositives.length > 0 || report.samples.falseNegatives.length > 0)) {
      html += `
    <h2>🔍 Sample Failed Cases</h2>
`;

      if (report.samples.falsePositives.length > 0) {
        html += `
    <h3>False Positives (Legitimate Emails Wrongly Blocked)</h3>
    <table>
      <thead>
        <tr>
          <th>Email</th>
          <th>Risk Score</th>
          <th>Reason</th>
          <th>Category</th>
        </tr>
      </thead>
      <tbody>
`;
        report.samples.falsePositives.forEach((fp: TestResult) => {
          html += `
        <tr>
          <td>${fp.email}</td>
          <td>${fp.riskScore.toFixed(3)}</td>
          <td>${fp.reason}</td>
          <td>${fp.category}</td>
        </tr>
`;
        });
        html += `
      </tbody>
    </table>
`;
      }

      if (report.samples.falseNegatives.length > 0) {
        html += `
    <h3>False Negatives (Fraudulent Emails That Slipped Through)</h3>
    <table>
      <thead>
        <tr>
          <th>Email</th>
          <th>Risk Score</th>
          <th>Reason</th>
          <th>Category</th>
        </tr>
      </thead>
      <tbody>
`;
        report.samples.falseNegatives.forEach((fn: TestResult) => {
          html += `
        <tr>
          <td>${fn.email}</td>
          <td>${fn.riskScore.toFixed(3)}</td>
          <td>${fn.reason}</td>
          <td>${fn.category}</td>
        </tr>
`;
        });
        html += `
      </tbody>
    </table>
`;
      }
    }

  } else if (!hasLabels) {
    // Validation-only mode (no labels)
    const summary = report.summary;
    const riskDist = report.riskDistribution;

    html += `
    <div class="executive-summary">
      <h2>📋 Validation Report Summary</h2>
      <p><strong>What This Report Shows:</strong> This report shows how your fraud detection system classified ${summary.totalEmails.toLocaleString()} unlabeled emails. Since we don't have the true labels, we can't measure accuracy, but we can see the system's decisions and risk distribution.</p>

      <div class="key-finding">
        <strong>Decision Distribution:</strong><br>
        ${summary.decisions.allow} emails were allowed (${summary.percentages.allow.toFixed(1)}%)<br>
        ${summary.decisions.warn} emails received warnings (${summary.percentages.warn.toFixed(1)}%)<br>
        ${summary.decisions.block} emails were blocked (${summary.percentages.block.toFixed(1)}%)
      </div>

      <div class="key-finding">
        <strong>Average Risk Score: ${summary.avgRiskScore.toFixed(3)}</strong><br>
        ${
          summary.avgRiskScore < 0.3 ? 'The dataset appears mostly legitimate with low overall risk.' :
          summary.avgRiskScore < 0.6 ? 'The dataset has moderate risk indicators.' :
          'The dataset shows high fraud indicators.'
        }
      </div>
    </div>

    <h2>📈 Decision Distribution</h2>
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-label">Allowed</div>
        <div class="metric-value">${summary.decisions.allow}</div>
        <div class="metric-explanation">${summary.percentages.allow.toFixed(1)}% of emails passed all checks</div>
      </div>

      <div class="metric-card">
        <div class="metric-label">Warned</div>
        <div class="metric-value">${summary.decisions.warn}</div>
        <div class="metric-explanation">${summary.percentages.warn.toFixed(1)}% of emails had moderate risk</div>
      </div>

      <div class="metric-card">
        <div class="metric-label">Blocked</div>
        <div class="metric-value">${summary.decisions.block}</div>
        <div class="metric-explanation">${summary.percentages.block.toFixed(1)}% of emails were flagged as fraud</div>
      </div>

      <div class="metric-card">
        <div class="metric-label">Avg Response Time</div>
        <div class="metric-value">${summary.avgLatency.toFixed(0)}ms</div>
        <div class="metric-explanation">Average time per email check</div>
      </div>
    </div>

    <h2>🎯 Risk Distribution</h2>
    <div class="chart-bar">
      <div class="chart-bar-label">
        <span>Low Risk (&lt;0.3)</span>
        <span>${riskDist.low} emails (${(riskDist.low / summary.totalEmails * 100).toFixed(1)}%)</span>
      </div>
      <div class="chart-bar-fill" style="width: ${Math.round(riskDist.low / summary.totalEmails * 100)}%; background: linear-gradient(90deg, #2ecc71, #27ae60);">
        ${(riskDist.low / summary.totalEmails * 100).toFixed(1)}%
      </div>
    </div>

    <div class="chart-bar">
      <div class="chart-bar-label">
        <span>Medium Risk (0.3-0.6)</span>
        <span>${riskDist.medium} emails (${(riskDist.medium / summary.totalEmails * 100).toFixed(1)}%)</span>
      </div>
      <div class="chart-bar-fill" style="width: ${Math.round(riskDist.medium / summary.totalEmails * 100)}%; background: linear-gradient(90deg, #f39c12, #e67e22);">
        ${(riskDist.medium / summary.totalEmails * 100).toFixed(1)}%
      </div>
    </div>

    <div class="chart-bar">
      <div class="chart-bar-label">
        <span>High Risk (&gt;0.6)</span>
        <span>${riskDist.high} emails (${(riskDist.high / summary.totalEmails * 100).toFixed(1)}%)</span>
      </div>
      <div class="chart-bar-fill" style="width: ${Math.round(riskDist.high / summary.totalEmails * 100)}%; background: linear-gradient(90deg, #e74c3c, #c0392b);">
        ${(riskDist.high / summary.totalEmails * 100).toFixed(1)}%
      </div>
    </div>

    <div class="info-box">
      <h4>Understanding Risk Scores</h4>
      <p><strong>Low Risk (&lt;0.3):</strong> Emails that appear legitimate with few or no fraud indicators.</p>
      <p><strong>Medium Risk (0.3-0.6):</strong> Emails with some suspicious characteristics that warrant monitoring.</p>
      <p><strong>High Risk (&gt;0.6):</strong> Emails with strong fraud indicators that are typically blocked.</p>
    </div>

    <div class="recommendations">
      <h3>💡 Next Steps</h3>
      <div class="recommendation-item">
        <strong>Manual Review Recommended</strong><br>
        Since this is unlabeled data, consider manually reviewing a sample of emails from each risk category to validate the system's decisions.
      </div>

      ${summary.decisions.block > summary.totalEmails * 0.3 ? `
      <div class="recommendation-item">
        <strong>High Block Rate Detected</strong><br>
        ${summary.percentages.block.toFixed(1)}% of emails were blocked. If this seems high:
        <ul>
          <li>Review the top blocked emails to ensure they're actually fraudulent</li>
          <li>Consider if detection thresholds need adjustment</li>
          <li>Check if legitimate patterns are being misclassified</li>
        </ul>
      </div>
      ` : ''}
    </div>

    <h2>🔴 Top Blocked Emails</h2>
    <table>
      <thead>
        <tr>
          <th>Email</th>
          <th>Risk Score</th>
          <th>Reason</th>
        </tr>
      </thead>
      <tbody>
`;
    report.topBlocked.slice(0, 10).forEach((item: any) => {
      html += `
        <tr>
          <td>${item.email}</td>
          <td>${item.riskScore.toFixed(3)}</td>
          <td>${item.reason}</td>
        </tr>
`;
    });
    html += `
      </tbody>
    </table>
`;
  }

  html += `
    <div class="footer">
      <p>Generated by Markov Mail Batch Testing System</p>
      <p>Report generated at ${timestamp}</p>
    </div>
  </div>
</body>
</html>
`;

  return html;
}

/**
 * Generate text report for terminal-friendly output
 */
function generateTextReport(
  report: any,
  metrics: ReturnType<typeof calculateMetrics> | undefined,
  results: TestResult[],
  hasLabels: boolean,
  endpoint: string,
  inputPath: string,
  totalTime: number
): string {
  const timestamp = new Date().toLocaleString();
  const isAccuracyMode = hasLabels && metrics && !metrics.aborted;

  let txt = '';
  txt += '═'.repeat(80) + '\n';
  txt += '                         BATCH TEST REPORT\n';
  txt += '═'.repeat(80) + '\n\n';
  txt += `Generated:   ${timestamp}\n`;
  txt += `Endpoint:    ${endpoint}\n`;
  txt += `Input File:  ${inputPath}\n`;
  txt += `Test Time:   ${totalTime.toFixed(1)}s\n`;
  txt += '\n';

  if (isAccuracyMode && metrics) {
    const fpRate = (metrics.falsePositives / (metrics.falsePositives + metrics.trueNegatives) * 100);
    const fnRate = (metrics.falseNegatives / (metrics.falseNegatives + metrics.truePositives) * 100);

    txt += '─'.repeat(80) + '\n';
    txt += 'EXECUTIVE SUMMARY\n';
    txt += '─'.repeat(80) + '\n\n';

    txt += `Overall Performance: `;
    if (metrics.accuracy >= 95) txt += '✅ EXCELLENT\n';
    else if (metrics.accuracy >= 85) txt += '✅ GOOD\n';
    else if (metrics.accuracy >= 70) txt += '⚠️  FAIR\n';
    else txt += '❌ POOR\n';

    txt += `\nThe system correctly classified ${metrics.passed}/${metrics.totalTests} emails\n`;
    txt += `(${metrics.accuracy.toFixed(2)}% accuracy)\n\n`;

    txt += `False Positive Rate: ${fpRate.toFixed(2)}% `;
    if (fpRate < 5) txt += '✅\n';
    else if (fpRate < 10) txt += '⚠️\n';
    else txt += '❌\n';
    txt += `  → ${fpRate.toFixed(2)}% of legitimate emails were incorrectly blocked\n\n`;

    txt += `Fraud Detection Rate: ${metrics.recall.toFixed(1)}% `;
    if (metrics.recall >= 90) txt += '✅\n';
    else if (metrics.recall >= 80) txt += '⚠️\n';
    else txt += '❌\n';
    txt += `  → System caught ${metrics.recall.toFixed(1)}% of all fraudulent emails\n\n`;

    txt += '─'.repeat(80) + '\n';
    txt += 'PERFORMANCE METRICS\n';
    txt += '─'.repeat(80) + '\n\n';

    txt += `Accuracy:          ${metrics.accuracy.toFixed(2)}%  `;
    txt += metrics.accuracy >= 90 ? '✅ Good\n' : metrics.accuracy >= 80 ? '⚠️  Moderate\n' : '❌ Poor\n';
    txt += `  What it means: ${Math.round(metrics.accuracy)} out of 100 emails correctly classified\n\n`;

    txt += `Precision:         ${metrics.precision.toFixed(2)}%  `;
    txt += metrics.precision >= 90 ? '✅ Good\n' : metrics.precision >= 80 ? '⚠️  Moderate\n' : '❌ Poor\n';
    txt += `  What it means: When flagged as fraud, correct ${Math.round(metrics.precision)}% of the time\n\n`;

    txt += `Recall:            ${metrics.recall.toFixed(2)}%  `;
    txt += metrics.recall >= 90 ? '✅ Good\n' : metrics.recall >= 80 ? '⚠️  Moderate\n' : '❌ Poor\n';
    txt += `  What it means: Catches ${Math.round(metrics.recall)}% of all fraudulent emails\n\n`;

    txt += `F1 Score:          ${metrics.f1Score.toFixed(2)}%  `;
    txt += metrics.f1Score >= 90 ? '✅ Good\n' : metrics.f1Score >= 80 ? '⚠️  Moderate\n' : '❌ Poor\n';
    txt += `  What it means: Balanced measure of precision and recall\n\n`;

    txt += `False Pos Rate:    ${fpRate.toFixed(2)}%  `;
    txt += fpRate <= 5 ? '✅ Good\n' : fpRate <= 10 ? '⚠️  Moderate\n' : '❌ Poor\n';
    txt += `  What it means: ${fpRate.toFixed(0)} per 100 legit emails wrongly blocked\n\n`;

    txt += `Avg Latency:       ${metrics.avgLatency.toFixed(0)}ms  `;
    txt += metrics.avgLatency <= 200 ? '✅ Good\n' : metrics.avgLatency <= 500 ? '⚠️  Moderate\n' : '❌ Poor\n';
    txt += `  What it means: Average response time per email check\n\n`;

    txt += '─'.repeat(80) + '\n';
    txt += 'CONFUSION MATRIX\n';
    txt += '─'.repeat(80) + '\n\n';
    txt += '                    Predicted Fraud    Predicted Legit\n';
    txt += '  ──────────────────────────────────────────────────────\n';
    txt += `  Actually Fraud    ${String(metrics.truePositives).padStart(8)}  ✅       ${String(metrics.falseNegatives).padStart(8)}  ❌\n`;
    txt += `  Actually Legit    ${String(metrics.falsePositives).padStart(8)}  ⚠️       ${String(metrics.trueNegatives).padStart(8)}  ✅\n\n`;

    txt += `  ✅ True Positives:  ${metrics.truePositives} (fraud correctly blocked)\n`;
    txt += `  ⚠️  False Positives: ${metrics.falsePositives} (legit wrongly blocked)\n`;
    txt += `  ✅ True Negatives:  ${metrics.trueNegatives} (legit correctly allowed)\n`;
    txt += `  ❌ False Negatives: ${metrics.falseNegatives} (fraud that slipped through)\n\n`;

    // Category breakdown
    if (report.categoryBreakdown && report.categoryBreakdown.length > 0) {
      txt += '─'.repeat(80) + '\n';
      txt += 'CATEGORY PERFORMANCE\n';
      txt += '─'.repeat(80) + '\n\n';

      report.categoryBreakdown.forEach((cat: any) => {
        const bar = '█'.repeat(Math.floor(cat.accuracy / 2)) + '░'.repeat(50 - Math.floor(cat.accuracy / 2));
        txt += `${cat.category.padEnd(20)} [${bar}] ${cat.accuracy.toFixed(1)}% (${cat.passed}/${cat.total})\n`;
      });
      txt += '\n';
    }

    // Recommendations
    txt += '─'.repeat(80) + '\n';
    txt += 'RECOMMENDATIONS\n';
    txt += '─'.repeat(80) + '\n\n';

    if (fpRate > 10) {
      txt += '⚠️  HIGH FALSE POSITIVE RATE\n';
      txt += `   ${fpRate.toFixed(1)}% of legitimate emails are being blocked.\n`;
      txt += '   → Review and tune fraud detection thresholds\n';
      txt += `   → Analyze ${metrics.falsePositives} false positives for patterns\n`;
      txt += '   → Consider warning system instead of immediate blocking\n\n';
    }

    if (metrics.recall < 85) {
      txt += '⚠️  LOW FRAUD DETECTION RATE\n';
      txt += `   Only ${metrics.recall.toFixed(1)}% of fraud is being caught.\n`;
      txt += `   → Strengthen detection for ${metrics.falseNegatives} missed emails\n`;
      txt += `   → ${fnRate.toFixed(1)}% of fraud is slipping through\n`;
      txt += '   → Consider additional fraud indicators\n\n';
    }

    if (metrics.accuracy >= 90 && fpRate < 5) {
      txt += '✅ EXCELLENT PERFORMANCE!\n';
      txt += `   System performing well: ${metrics.accuracy.toFixed(1)}% accuracy, ${fpRate.toFixed(2)}% FP rate\n`;
      txt += '   → Continue regular monitoring\n';
      txt += '   → Use as baseline for improvements\n';
      txt += '   → Document current configuration\n\n';
    }

    if (metrics.avgLatency > 500) {
      txt += '⚠️  PERFORMANCE OPTIMIZATION NEEDED\n';
      txt += `   Average ${metrics.avgLatency.toFixed(0)}ms response time is high\n`;
      txt += '   → Consider caching frequent patterns\n';
      txt += '   → Optimize queries and model inference\n';
      txt += '   → Profile code for bottlenecks\n\n';
    }

  } else if (!hasLabels) {
    const summary = report.summary;
    const riskDist = report.riskDistribution;

    txt += '─'.repeat(80) + '\n';
    txt += 'VALIDATION SUMMARY (UNLABELED DATA)\n';
    txt += '─'.repeat(80) + '\n\n';
    txt += `Total Emails:      ${summary.totalEmails.toLocaleString()}\n`;
    txt += `Allowed:           ${summary.decisions.allow} (${summary.percentages.allow.toFixed(1)}%)\n`;
    txt += `Warned:            ${summary.decisions.warn} (${summary.percentages.warn.toFixed(1)}%)\n`;
    txt += `Blocked:           ${summary.decisions.block} (${summary.percentages.block.toFixed(1)}%)\n`;
    txt += `Avg Risk Score:    ${summary.avgRiskScore.toFixed(3)}\n`;
    txt += `Avg Latency:       ${summary.avgLatency.toFixed(0)}ms\n\n`;

    txt += '─'.repeat(80) + '\n';
    txt += 'RISK DISTRIBUTION\n';
    txt += '─'.repeat(80) + '\n\n';

    const lowPct = (riskDist.low / summary.totalEmails * 100);
    const medPct = (riskDist.medium / summary.totalEmails * 100);
    const highPct = (riskDist.high / summary.totalEmails * 100);

    const lowBar = '█'.repeat(Math.floor(lowPct / 2)) + '░'.repeat(50 - Math.floor(lowPct / 2));
    const medBar = '█'.repeat(Math.floor(medPct / 2)) + '░'.repeat(50 - Math.floor(medPct / 2));
    const highBar = '█'.repeat(Math.floor(highPct / 2)) + '░'.repeat(50 - Math.floor(highPct / 2));

    txt += `Low Risk (<0.3)     [${lowBar}] ${lowPct.toFixed(1)}% (${riskDist.low})\n`;
    txt += `Medium Risk (0.3-0.6) [${medBar}] ${medPct.toFixed(1)}% (${riskDist.medium})\n`;
    txt += `High Risk (>0.6)    [${highBar}] ${highPct.toFixed(1)}% (${riskDist.high})\n\n`;

    txt += '─'.repeat(80) + '\n';
    txt += 'NEXT STEPS\n';
    txt += '─'.repeat(80) + '\n\n';
    txt += '→ Manual review recommended for unlabeled data validation\n';
    txt += '→ Sample emails from each risk category to verify decisions\n';
    if (summary.decisions.block > summary.totalEmails * 0.3) {
      txt += `⚠️  High block rate (${summary.percentages.block.toFixed(1)}%) - review blocked emails\n`;
    }
  }

  txt += '\n' + '═'.repeat(80) + '\n';
  txt += 'END OF REPORT\n';
  txt += '═'.repeat(80) + '\n';

  return txt;
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
  --output <path>       Output file for results (default: /tmp/batch-test-results-{timestamp})
  --format <type>       Output format: json, html, txt, or all (default: all)
  --concurrency <n>     Number of concurrent requests (default: 10)
  --help, -h            Show this help message

CSV FORMAT
  Auto-detects columns based on header row. Supports any column order.
  Required: email column
  Optional: type/label, category, IP (ignored), and other columns

  Example with header:
    email,ip,type,category
    user@example.com,192.168.1.1,legitimate,professional
    test123@gmail.com,10.0.0.1,fraudulent,sequential

  Example without header (assumes first column is email):
    user@example.com,legitimate,professional
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
  const format = (getOption(parsed, 'format') || 'all').toLowerCase();
  const concurrency = parseInt(getOption(parsed, 'concurrency') || '10');

  // Validate format
  const validFormats = ['json', 'html', 'txt', 'all'];
  if (!validFormats.includes(format)) {
    logger.error(`Invalid format: ${format}. Valid options: json, html, txt, all`);
    process.exit(1);
  }

  // Generate timestamp for output files
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const baseOutputPath = getOption(parsed, 'output') || `/tmp/batch-test-results-${timestamp}`;

  // Remove extension if provided by user
  const outputPathBase = baseOutputPath.replace(/\.(json|html|txt)$/, '');

  logger.section('🧪 Batch Testing');
  logger.info(`Input: ${inputPath}`);
  logger.info(`Endpoint: ${endpoint}`);
  logger.info(`Format: ${format}`);
  logger.info(`Concurrency: ${concurrency}`);

  // Load test dataset
  if (!fs.existsSync(inputPath)) {
    logger.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  // Auto-detect format and load (supports CSV and JSON)
  const { dataset, hasLabels } = loadDataset(inputPath);
  const fileFormat = inputPath.endsWith('.csv') ? 'CSV' : inputPath.endsWith('.json') ? 'JSON' : 'auto-detected';

  if (hasLabels) {
    logger.info(`Loaded ${dataset.count} emails from ${fileFormat} file (${dataset.legitimate} legit, ${dataset.fraudulent} fraud)`);
  } else {
    logger.info(`Loaded ${dataset.count} emails from ${fileFormat} file (unlabeled data - validation mode)`);
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
  let report: any;

  let metrics: ReturnType<typeof calculateMetrics> | undefined;

  if (hasLabels) {
    // Calculate metrics for labeled data
    metrics = calculateMetrics(results);

    if (metrics.aborted) {
      logger.error('Batch run aborted due to network/API errors. No metrics recorded.');

      const abortReport = {
        timestamp: new Date().toISOString(),
        endpoint,
        mode: 'accuracy_testing_aborted',
        dataset: {
          input: inputPath,
          legitimate: dataset.legitimate,
          fraudulent: dataset.fraudulent,
          total: dataset.count,
        },
        error: metrics.abortReason,
      };

      // Save error report
      console.log('\n');
      logger.section('📄 Generating Error Report');

      const errorTimestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const errorOutputBase = getOption(parsed, 'output')?.replace(/\.(json|html|txt)$/, '') || `/tmp/batch-test-error-${errorTimestamp}`;

      if (format === 'json' || format === 'all') {
        const jsonPath = `${errorOutputBase}.json`;
        fs.writeFileSync(jsonPath, JSON.stringify(abortReport, null, 2));
        logger.error(`JSON error report: ${jsonPath}`);
      }

      logger.error(`\n❌ Batch run aborted due to errors. Check the report for details.`);
      return;
    }

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
      samples: {
        falsePositives: results.filter(r => !r.passed && r.expected === 'legit').slice(0, 10),
        falseNegatives: results.filter(r => !r.passed && r.expected === 'fraud').slice(0, 10),
      },
    };
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
        low: lowRisk,
        medium: medRisk,
        high: highRisk,
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

  if (report.mode === 'accuracy_testing') {
    report.categoryBreakdown = categories.map(cat => {
      const catResults = results.filter(r => r.category === cat);
      return {
        category: cat,
        total: catResults.length,
        passed: catResults.filter(r => r.passed).length,
        accuracy: (catResults.filter(r => r.passed).length / catResults.length * 100),
      };
    });
  }

  // Generate and save reports based on format selection
  const totalTime = (Date.now() - startTime) / 1000;
  const savedFiles: string[] = [];

  console.log('\n');
  logger.section('📄 Generating Reports');

  if (format === 'json' || format === 'all') {
    const jsonPath = `${outputPathBase}.json`;
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    logger.success(`JSON report saved: ${jsonPath}`);
    savedFiles.push(jsonPath);
  }

  if (format === 'html' || format === 'all') {
    const htmlPath = `${outputPathBase}.html`;
    const htmlContent = generateHTMLReport(report, metrics, results, hasLabels, endpoint, inputPath, totalTime);
    fs.writeFileSync(htmlPath, htmlContent);
    logger.success(`HTML report saved: ${htmlPath}`);
    savedFiles.push(htmlPath);
  }

  if (format === 'txt' || format === 'all') {
    const txtPath = `${outputPathBase}.txt`;
    const txtContent = generateTextReport(report, metrics, results, hasLabels, endpoint, inputPath, totalTime);
    fs.writeFileSync(txtPath, txtContent);
    logger.success(`TXT report saved: ${txtPath}`);
    savedFiles.push(txtPath);
  }

  console.log('\n');
  logger.success(`✅ Report generation complete! ${savedFiles.length} file(s) created.`);

  // Display summary of where files are saved
  if (savedFiles.length > 0) {
    console.log('\n📂 Report Locations:');
    savedFiles.forEach(file => {
      console.log(`   ${file}`);
    });
  }
}
