#!/usr/bin/env bun
/**
 * Export D1 Data, Dedupe, and Relabel with v2.2.0 Algorithm
 *
 * This script:
 * 1. Exports all validation records from D1
 * 2. Deduplicates by email (keeping most recent)
 * 3. Re-labels using Markov-only detection
 * 4. Exports to CSV for training
 */

import { writeFile } from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface ValidationRecord {
  email_local_part: string;
  domain: string;
  decision: string;
  risk_score: number;
  block_reason: string | null;
  pattern_type: string | null;
  pattern_family: string | null;
  markov_detected: number;
  markov_confidence: number | null;
  markov_cross_entropy_legit: number | null;
  markov_cross_entropy_fraud: number | null;
  entropy_score: number | null;
  is_disposable: number;
  pattern_classification_version: string | null;
  timestamp: string;
}

interface DeduplicatedRecord {
  email: string;
  decision: string;
  risk_score: number;
  markov_detected: boolean;
  markov_confidence: number;
  pattern_type: string;
  pattern_family: string;
  version: string;
  timestamp: string;
  // New labels based on v2.2.0
  new_label: 'legit' | 'fraud' | 'ambiguous';
  new_confidence: number;
  relabel_reason: string;
}

async function exportFromD1(limit: number = 150000): Promise<ValidationRecord[]> {
  console.log(`📥 Exporting up to ${limit} records from D1...`);

  const query = `
    SELECT
      email_local_part, domain, decision, risk_score, block_reason,
      pattern_type, pattern_family, markov_detected, markov_confidence,
      markov_cross_entropy_legit, markov_cross_entropy_fraud, entropy_score,
      is_disposable, pattern_classification_version, timestamp
    FROM validations
    ORDER BY timestamp DESC
    LIMIT ${limit}
  `;

  const { stdout } = await execAsync(
    `npx wrangler d1 execute ANALYTICS --remote --command "${query.replace(/\n/g, ' ')}" --json`
  );

  const result = JSON.parse(stdout);
  const records = result[0]?.results || [];

  console.log(`✅ Exported ${records.length} records`);
  return records;
}

function deduplicateRecords(records: ValidationRecord[]): Map<string, ValidationRecord> {
  console.log('🔍 Deduplicating records by email (keeping most recent)...');

  const deduped = new Map<string, ValidationRecord>();

  for (const record of records) {
    const email = `${record.email_local_part}@${record.domain}`;

    if (!deduped.has(email)) {
      deduped.set(email, record);
    } else {
      const existing = deduped.get(email)!;
      // Keep the most recent one
      if (new Date(record.timestamp) > new Date(existing.timestamp)) {
        deduped.set(email, record);
      }
    }
  }

  console.log(`✅ Deduplicated: ${records.length} → ${deduped.size} unique emails`);
  return deduped;
}

function relabelWithV220(email: string, record: ValidationRecord): { label: string; confidence: number; reason: string } {
  // New v2.2.0 labeling logic (Markov-first)

  // HIGH CONFIDENCE FRAUD
  if (record.markov_detected && record.markov_confidence && record.markov_confidence >= 0.8) {
    return {
      label: 'fraud',
      confidence: record.markov_confidence,
      reason: `markov_high_confidence_${record.markov_confidence.toFixed(2)}`
    };
  }

  // BLOCKED WITH HIGH RISK
  if (record.decision === 'block' && record.risk_score >= 0.7) {
    return {
      label: 'fraud',
      confidence: record.risk_score,
      reason: `blocked_high_risk_${record.block_reason || 'unknown'}`
    };
  }

  // SEQUENTIAL PATTERN
  if (record.pattern_type === 'sequential' || record.pattern_family === 'sequential') {
    return {
      label: 'fraud',
      confidence: 0.8,
      reason: 'sequential_pattern'
    };
  }

  // DISPOSABLE DOMAIN
  if (record.is_disposable === 1) {
    return {
      label: 'fraud',
      confidence: 0.95,
      reason: 'disposable_domain'
    };
  }

  // HIGH CONFIDENCE LEGITIMATE (Markov says not fraud + allowed)
  if (record.decision === 'allow' &&
      record.markov_confidence &&
      record.markov_confidence >= 0.8 &&
      !record.markov_detected) {
    return {
      label: 'legit',
      confidence: record.markov_confidence,
      reason: 'markov_confident_legit'
    };
  }

  // ALLOWED WITH LOW RISK
  if (record.decision === 'allow' && record.risk_score < 0.3) {
    return {
      label: 'legit',
      confidence: 1.0 - record.risk_score,
      reason: 'allowed_low_risk'
    };
  }

  // MODERATE MARKOV FRAUD SIGNAL
  if (record.markov_detected && record.markov_confidence && record.markov_confidence >= 0.6) {
    return {
      label: 'fraud',
      confidence: record.markov_confidence,
      reason: `markov_moderate_${record.markov_confidence.toFixed(2)}`
    };
  }

  // AMBIGUOUS - not enough confidence
  return {
    label: 'ambiguous',
    confidence: 0.5,
    reason: 'insufficient_confidence'
  };
}

async function exportToCSV(records: DeduplicatedRecord[], outputPath: string): Promise<void> {
  console.log(`💾 Exporting ${records.length} records to CSV...`);

  const headers = [
    'email', 'old_decision', 'old_risk_score', 'markov_detected', 'markov_confidence',
    'pattern_type', 'pattern_family', 'version', 'timestamp',
    'new_label', 'new_confidence', 'relabel_reason'
  ];

  const rows = records.map(r => [
    r.email,
    r.decision,
    r.risk_score.toFixed(4),
    r.markov_detected ? '1' : '0',
    r.markov_confidence.toFixed(4),
    r.pattern_type || 'none',
    r.pattern_family || 'none',
    r.version,
    r.timestamp,
    r.new_label,
    r.new_confidence.toFixed(4),
    r.relabel_reason
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

  await writeFile(outputPath, csv, 'utf-8');
}

async function main() {
  console.log('🚀 Starting D1 Export, Dedupe, and Relabeling (v2.2.0)\n');

  try {
    // Step 1: Export from D1
    const rawRecords = await exportFromD1();

    // Step 2: Deduplicate
    const dedupedMap = deduplicateRecords(rawRecords);

    // Step 3: Relabel with v2.2.0
    console.log('🏷️  Re-labeling with v2.2.0 algorithm (Markov-first)...');
    const relabeled: DeduplicatedRecord[] = [];

    for (const [email, record] of dedupedMap.entries()) {
      const { label, confidence, reason } = relabelWithV220(email, record);

      relabeled.push({
        email,
        decision: record.decision,
        risk_score: record.risk_score,
        markov_detected: record.markov_detected === 1,
        markov_confidence: record.markov_confidence || 0,
        pattern_type: record.pattern_type || 'none',
        pattern_family: record.pattern_family || 'none',
        version: record.pattern_classification_version || '2.0',
        timestamp: record.timestamp,
        new_label: label as any,
        new_confidence: confidence,
        relabel_reason: reason
      });
    }

    console.log('✅ Relabeling complete\n');

    // Step 4: Export to CSV
    const timestamp = new Date().toISOString().split('T')[0];
    const outputPath = `./data/exports/relabeled_v2.2.0_${timestamp}.csv`;
    await exportToCSV(relabeled, outputPath);

    console.log(`✅ Exported to: ${outputPath}\n`);

    // Print statistics
    const labelCounts = relabeled.reduce((acc, r) => {
      acc[r.new_label] = (acc[r.new_label] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    console.log('📊 Label Distribution:');
    console.log(`   Fraud:      ${labelCounts.fraud || 0} (${((labelCounts.fraud || 0) / relabeled.length * 100).toFixed(1)}%)`);
    console.log(`   Legit:      ${labelCounts.legit || 0} (${((labelCounts.legit || 0) / relabeled.length * 100).toFixed(1)}%)`);
    console.log(`   Ambiguous:  ${labelCounts.ambiguous || 0} (${((labelCounts.ambiguous || 0) / relabeled.length * 100).toFixed(1)}%)`);
    console.log(`   Total:      ${relabeled.length}`);

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
