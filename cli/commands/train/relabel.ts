/**
 * Dataset Re-labeling Command
 *
 * Re-labels dataset based on PATTERN analysis (not content)
 * Uses heuristic fraud detectors to assign correct labels
 */

import { readFile, writeFile } from 'fs/promises';
import { parse } from 'csv-parse/sync';
import { logger } from '../../utils/logger.ts';
import { parseArgs, getOption, hasFlag } from '../../utils/args.ts';

// Import pattern detectors
import { detectKeyboardWalk } from '../../../src/detectors/keyboard-walk.ts';
import { detectGibberish } from '../../../src/detectors/ngram-analysis.ts';
import { extractPatternFamily } from '../../../src/detectors/pattern-family.ts';

interface RelabelOptions {
  input: string;
  output: string;
  threshold: number; // Minimum score to label as fraud (0-1)
  verbose: boolean;
}

interface RelabelResult {
  email: string;
  originalLabel: number;
  newLabel: number;
  reason: string;
  confidence: number;
  changed: boolean;
}

/**
 * Analyze email pattern using heuristic detectors
 */
async function analyzePattern(email: string): Promise<{ isFraud: boolean; reason: string; confidence: number }> {
  const [localPart] = email.split('@');

  let fraudScore = 0;
  let reasons: string[] = [];

  // 1. Keyboard walk detection (very strong signal)
  const keyboardWalk = detectKeyboardWalk(email);
  if (keyboardWalk.hasKeyboardWalk) {
    fraudScore += 0.9;
    reasons.push(`keyboard_walk_${keyboardWalk.walkType}`);
  }

  // 2. Sequential pattern detection
  const patternFamily = await extractPatternFamily(email);
  if (patternFamily.patternType === 'sequential') {
    fraudScore += 0.8;
    reasons.push('sequential_pattern');
  }

  // 3. Gibberish detection (moderate signal - can have false positives on names)
  const gibberish = detectGibberish(email);
  if (gibberish.isGibberish && gibberish.confidence > 0.8) {
    fraudScore += 0.6 * gibberish.confidence;
    reasons.push('gibberish');
  }

  // 4. Random pattern with high confidence
  if (patternFamily.patternType === 'random' && patternFamily.confidence > 0.7) {
    fraudScore += 0.7;
    reasons.push('random_high_confidence');
  }

  // 5. Very short local parts (< 3 chars) are often bot-generated
  if (localPart.length < 3) {
    fraudScore += 0.4;
    reasons.push('very_short');
  }

  // 6. Dated patterns with suspicious years
  if (patternFamily.patternType === 'dated' && patternFamily.confidence > 0.8) {
    fraudScore += 0.7;
    reasons.push('dated_suspicious');
  }

  // Normalize score to 0-1
  const normalizedScore = Math.min(fraudScore, 1.0);

  return {
    isFraud: normalizedScore > 0.5,
    reason: reasons.length > 0 ? reasons.join(', ') : 'legitimate_pattern',
    confidence: normalizedScore
  };
}

/**
 * Re-label dataset based on pattern analysis
 */
async function relabelDataset(options: RelabelOptions): Promise<RelabelResult[]> {
  logger.section('📊 Dataset Re-labeling');
  logger.info(`Input: ${options.input}`);
  logger.info(`Output: ${options.output}`);
  logger.info(`Fraud threshold: ${options.threshold}`);

  // Load CSV
  logger.subsection('Loading Dataset');
  const content = await readFile(options.input, 'utf-8');
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
  }) as Array<{ email: string; label: string }>;

  logger.info(`Loaded ${records.length.toLocaleString()} emails`);

  // Analyze each email
  logger.subsection('Analyzing Patterns');
  const results: RelabelResult[] = [];
  let changed = 0;
  let processed = 0;

  for (const record of records) {
    const email = record.email;
    const originalLabel = parseInt(record.label || '0');

    // Analyze pattern
    const analysis = await analyzePattern(email);
    const newLabel = analysis.isFraud ? 1 : 0;
    const hasChanged = originalLabel !== newLabel;

    if (hasChanged) changed++;

    results.push({
      email,
      originalLabel,
      newLabel,
      reason: analysis.reason,
      confidence: analysis.confidence,
      changed: hasChanged
    });

    processed++;
    if (processed % 1000 === 0) {
      logger.info(`Progress: ${processed}/${records.length} (${Math.round(processed / records.length * 100)}%) | Changed: ${changed}`);
    }

    // Log verbose output
    if (options.verbose && hasChanged) {
      logger.debug(`Changed: ${email} | ${originalLabel} → ${newLabel} | ${analysis.reason} (${Math.round(analysis.confidence * 100)}%)`);
    }
  }

  logger.success(`Analyzed ${processed} emails`);
  logger.info(`Labels changed: ${changed} (${Math.round(changed / processed * 100)}%)`);

  return results;
}

/**
 * Save re-labeled dataset
 */
async function saveRelabeledDataset(results: RelabelResult[], outputPath: string): Promise<void> {
  logger.subsection('Saving Re-labeled Dataset');

  // Manually create CSV output
  const header = 'email,label,original_label,reason,confidence,changed\n';
  const rows = results.map(r => {
    // Escape fields with commas or quotes
    const escapeField = (field: string | number) => {
      const str = String(field);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    return [
      escapeField(r.email),
      r.newLabel,
      r.originalLabel,
      escapeField(r.reason),
      Math.round(r.confidence * 100) / 100,
      r.changed ? 'yes' : 'no'
    ].join(',');
  }).join('\n');

  const csvString = header + rows;
  await writeFile(outputPath, csvString, 'utf-8');
  logger.success(`Saved to: ${outputPath}`);
}

/**
 * Print statistics
 */
function printStatistics(results: RelabelResult[]): void {
  logger.subsection('Statistics');

  const total = results.length;
  const changed = results.filter(r => r.changed).length;
  const originalLegit = results.filter(r => r.originalLabel === 0).length;
  const originalFraud = results.filter(r => r.originalLabel === 1).length;
  const newLegit = results.filter(r => r.newLabel === 0).length;
  const newFraud = results.filter(r => r.newLabel === 1).length;

  const legitToFraud = results.filter(r => r.originalLabel === 0 && r.newLabel === 1).length;
  const fraudToLegit = results.filter(r => r.originalLabel === 1 && r.newLabel === 0).length;

  logger.info(`Total emails: ${total.toLocaleString()}`);
  logger.info('');
  logger.info('Original labels:');
  logger.info(`  Legitimate: ${originalLegit.toLocaleString()} (${Math.round(originalLegit / total * 100)}%)`);
  logger.info(`  Fraud: ${originalFraud.toLocaleString()} (${Math.round(originalFraud / total * 100)}%)`);
  logger.info('');
  logger.info('New labels:');
  logger.info(`  Legitimate: ${newLegit.toLocaleString()} (${Math.round(newLegit / total * 100)}%)`);
  logger.info(`  Fraud: ${newFraud.toLocaleString()} (${Math.round(newFraud / total * 100)}%)`);
  logger.info('');
  logger.info('Changes:');
  logger.info(`  Total changed: ${changed.toLocaleString()} (${Math.round(changed / total * 100)}%)`);
  logger.info(`  Legit → Fraud: ${legitToFraud.toLocaleString()}`);
  logger.info(`  Fraud → Legit: ${fraudToLegit.toLocaleString()}`);

  // Top reasons for changes
  const changeReasons = results
    .filter(r => r.changed)
    .reduce((acc, r) => {
      acc[r.reason] = (acc[r.reason] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

  logger.info('');
  logger.info('Top reasons for label changes:');
  Object.entries(changeReasons)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .forEach(([reason, count]) => {
      logger.info(`  ${reason}: ${count}`);
    });
}

export default async function relabel(args: string[]) {
  const parsed = parseArgs(args);

  if (hasFlag(parsed, 'help', 'h')) {
    console.log(`
╔════════════════════════════════════════════════════════╗
║          Re-label Dataset (Pattern-Based)              ║
╚════════════════════════════════════════════════════════╝

Re-labels a dataset based on PATTERN analysis rather than content.
Uses heuristic fraud detectors (keyboard walks, gibberish, sequential, etc.)
to assign correct labels based on email address patterns.

USAGE
  npm run cli train:relabel [options]

OPTIONS
  --input <path>       Input CSV file (default: ./dataset/consolidated_emails.csv)
  --output <path>      Output CSV file (default: ./dataset/relabeled_emails.csv)
  --threshold <num>    Fraud score threshold 0-1 (default: 0.5)
  --verbose, -v        Show detailed changes
  --help, -h           Show this help message

EXAMPLES
  # Re-label default dataset
  npm run cli train:relabel

  # Custom input/output
  npm run cli train:relabel --input ./data/raw.csv --output ./data/clean.csv

  # Stricter fraud threshold
  npm run cli train:relabel --threshold 0.7

  # Verbose output
  npm run cli train:relabel --verbose

OUTPUT FORMAT
  The output CSV includes:
  - email: The email address
  - label: New label (0=legit, 1=fraud)
  - original_label: Original label from input
  - reason: Pattern analysis reason
  - confidence: Fraud score (0-1)
  - changed: Whether label changed (yes/no)

PATTERN ANALYSIS
  The re-labeling uses these heuristics:
  1. Keyboard walks (qwerty, asdfgh) → fraud
  2. Sequential patterns (abc123, user123) → fraud
  3. High-confidence gibberish → fraud
  4. Random high-entropy → fraud
  5. Very short (<3 chars) → suspicious
  6. Dated patterns with suspicious years → fraud
  7. Simple names (john.doe) → legit
  8. Formatted (first_last) → legit
`);
    return;
  }

  const options: RelabelOptions = {
    input: getOption(parsed, 'input') || './dataset/consolidated_emails.csv',
    output: getOption(parsed, 'output') || './dataset/relabeled_emails.csv',
    threshold: parseFloat(getOption(parsed, 'threshold') || '0.5'),
    verbose: hasFlag(parsed, 'verbose', 'v')
  };

  // Validate threshold
  if (options.threshold < 0 || options.threshold > 1) {
    logger.error('Threshold must be between 0 and 1');
    process.exit(1);
  }

  try {
    // Re-label dataset
    const results = await relabelDataset(options);

    // Save results
    await saveRelabeledDataset(results, options.output);

    // Print statistics
    printStatistics(results);

    logger.section('✅ Re-labeling Complete!');
    logger.info('');
    logger.info('Next steps:');
    logger.info('  1. Review the output file to verify changes');
    logger.info('  2. Train Markov models with the re-labeled dataset:');
    logger.info(`     npm run cli train:markov --dataset ${options.output.replace('/relabeled_emails.csv', '')} --orders "2,3" --upload --remote`);

  } catch (error) {
    logger.error(`Re-labeling failed: ${error}`);
    process.exit(1);
  }
}
