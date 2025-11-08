#!/usr/bin/env bun
/**
 * Relabel validation records with v2.2.0 algorithm (Markov-only)
 */

import { readFile, writeFile } from 'fs/promises';

interface Record {
  email: string;
  decision: string;
  risk_score: number;
  markov_detected: number;
  markov_confidence: number | null;
  pattern_type: string | null;
  pattern_family: string | null;
  is_disposable: number;
  pattern_classification_version: string;
}

interface LabeledRecord extends Record {
  new_label: 'legit' | 'fraud' | 'ambiguous';
  new_confidence: number;
  reason: string;
}

function relabel(r: Record): { label: 'legit' | 'fraud' | 'ambiguous'; confidence: number; reason: string } {
  // v2.2.0 labeling logic (Markov-first)

  // HIGH CONFIDENCE FRAUD
  if (r.markov_detected && r.markov_confidence && r.markov_confidence >= 0.8) {
    return { label: 'fraud', confidence: r.markov_confidence, reason: 'markov_high_confidence' };
  }

  // DISPOSABLE
  if (r.is_disposable === 1) {
    return { label: 'fraud', confidence: 0.95, reason: 'disposable_domain' };
  }

  // SEQUENTIAL
  if (r.pattern_type === 'sequential' || r.pattern_family?.includes('sequential')) {
    return { label: 'fraud', confidence: 0.8, reason: 'sequential_pattern' };
  }

  // BLOCKED + HIGH RISK
  if (r.decision === 'block' && r.risk_score >= 0.7) {
    return { label: 'fraud', confidence: r.risk_score, reason: 'blocked_high_risk' };
  }

  // MODERATE MARKOV FRAUD
  if (r.markov_detected && r.markov_confidence && r.markov_confidence >= 0.6) {
    return { label: 'fraud', confidence: r.markov_confidence, reason: 'markov_moderate' };
  }

  // HIGH CONFIDENCE LEGIT (Markov says not fraud + allowed)
  if (r.decision === 'allow' && r.markov_confidence && r.markov_confidence >= 0.8 && !r.markov_detected) {
    return { label: 'legit', confidence: r.markov_confidence, reason: 'markov_legit' };
  }

  // ALLOWED + LOW RISK
  if (r.decision === 'allow' && r.risk_score < 0.3) {
    return { label: 'legit', confidence: 1.0 - r.risk_score, reason: 'allow_low_risk' };
  }

  // LOW MARKOV FRAUD + ALLOWED
  if (r.markov_detected && r.markov_confidence && r.markov_confidence < 0.5 && r.decision === 'allow') {
    return { label: 'legit', confidence: 1.0 - r.markov_confidence, reason: 'markov_low_allow' };
  }

  // AMBIGUOUS
  return { label: 'ambiguous', confidence: 0.5, reason: 'insufficient_signal' };
}

async function main() {
  const inputPath = process.argv[2] || 'data/exports/deduped_50k.json';
  const outputPath = process.argv[3] || 'data/exports/relabeled_v2.2.0.csv';

  console.log(`📖 Reading ${inputPath}...`);
  const json = await readFile(inputPath, 'utf-8');
  const parsed = JSON.parse(json);
  const records: Record[] = parsed[0]?.results || [];

  console.log(`✅ Loaded ${records.length} records`);
  console.log(`🏷️  Relabeling with v2.2.0 algorithm...`);

  const labeled: LabeledRecord[] = records.map(r => {
    const { label, confidence, reason } = relabel(r);
    return { ...r, new_label: label, new_confidence: confidence, reason };
  });

  // Statistics
  const stats: { [key: string]: number } = labeled.reduce((acc, r) => {
    acc[r.new_label] = (acc[r.new_label] || 0) + 1;
    return acc;
  }, {} as { [key: string]: number });

  console.log(`\n📊 Label Distribution:`);
  console.log(`   Fraud:      ${stats.fraud || 0} (${((stats.fraud || 0) / labeled.length * 100).toFixed(1)}%)`);
  console.log(`   Legit:      ${stats.legit || 0} (${((stats.legit || 0) / labeled.length * 100).toFixed(1)}%)`);
  console.log(`   Ambiguous:  ${stats.ambiguous || 0} (${((stats.ambiguous || 0) / labeled.length * 100).toFixed(1)}%)`);

  // Export to CSV
  console.log(`\n💾 Exporting to ${outputPath}...`);

  const headers = ['email', 'new_label', 'new_confidence', 'reason', 'old_decision', 'old_risk_score', 'markov_detected', 'markov_confidence', 'pattern_type', 'version'];
  const rows = labeled.map(r => [
    r.email,
    r.new_label,
    r.new_confidence.toFixed(4),
    r.reason,
    r.decision,
    r.risk_score.toFixed(4),
    r.markov_detected ? '1' : '0',
    (r.markov_confidence || 0).toFixed(4),
    r.pattern_type || 'none',
    r.pattern_classification_version
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  await writeFile(outputPath, csv, 'utf-8');

  console.log(`✅ Exported ${labeled.length} records to ${outputPath}\n`);

  // Show reason breakdown for fraud
  const fraudReasons: { [key: string]: number } = labeled.filter(r => r.new_label === 'fraud').reduce((acc, r) => {
    acc[r.reason] = (acc[r.reason] || 0) + 1;
    return acc;
  }, {} as { [key: string]: number });

  console.log(`📋 Fraud Reasons:`);
  Object.entries(fraudReasons)
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .slice(0, 10)
    .forEach(([reason, count]) => {
      console.log(`   ${reason}: ${count} (${((count as number) / (stats.fraud || 1) * 100).toFixed(1)}%)`);
    });
}

main().catch(console.error);
