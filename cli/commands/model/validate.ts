/**
 * Model Validation Command
 *
 * Validates trained Markov models against test cases to measure accuracy
 * and compare different n-gram orders.
 */

import { logger } from '../../utils/logger.ts';
import { parseArgs, getOption, hasFlag } from '../../utils/args.ts';
import { $ } from 'bun';

interface TestCase {
  email: string;
  expected: 'legit' | 'fraud';
  category: string;
  note: string;
}

// Comprehensive test suite with diverse patterns
const TEST_CASES: TestCase[] = [
  // ========================================
  // GIBBERISH PATTERNS (should be fraud)
  // ========================================
  { email: 'xkjgh2k9qw', expected: 'fraud', category: 'gibberish', note: 'Pure random gibberish' },
  { email: 'zzz999xxx', expected: 'fraud', category: 'gibberish', note: 'Repetitive gibberish' },
  { email: 'qwpoeiruty', expected: 'fraud', category: 'gibberish', note: 'Random keyboard spam' },
  { email: 'asdfzxcv', expected: 'fraud', category: 'gibberish', note: 'Keyboard mashing' },
  { email: 'aaaaabbbbb', expected: 'fraud', category: 'gibberish', note: 'Repetitive characters' },
  { email: 'mxkq3j9w2r', expected: 'fraud', category: 'gibberish', note: 'High entropy random' },
  { email: 'lhekeg10', expected: 'fraud', category: 'gibberish', note: 'Mixed random chars' },
  { email: 'xyz999abc', expected: 'fraud', category: 'gibberish', note: 'Letter-number-letter spam' },

  // ========================================
  // SEQUENTIAL PATTERNS (should be fraud)
  // ========================================
  { email: 'user1', expected: 'fraud', category: 'sequential', note: 'Simple sequential user1' },
  { email: 'user2', expected: 'fraud', category: 'sequential', note: 'Sequential user2' },
  { email: 'user123', expected: 'fraud', category: 'sequential', note: 'Sequential with number' },
  { email: 'test001', expected: 'fraud', category: 'sequential', note: 'Zero-padded sequential' },
  { email: 'account99', expected: 'fraud', category: 'sequential', note: 'Sequential account' },
  { email: 'member456', expected: 'fraud', category: 'sequential', note: 'Sequential member' },
  { email: 'testuser1', expected: 'fraud', category: 'sequential', note: 'Compound sequential' },

  // ========================================
  // KEYBOARD WALKS (should be fraud)
  // ========================================
  { email: 'qwerty', expected: 'fraud', category: 'keyboard', note: 'QWERTY keyboard walk' },
  { email: 'asdfgh', expected: 'fraud', category: 'keyboard', note: 'ASDF keyboard walk' },
  { email: 'zxcvbn', expected: 'fraud', category: 'keyboard', note: 'ZXCV keyboard walk' },
  { email: '123456', expected: 'fraud', category: 'keyboard', note: 'Number sequence' },
  { email: 'qazwsx', expected: 'fraud', category: 'keyboard', note: 'Vertical keyboard walk' },
  { email: '123456789', expected: 'fraud', category: 'keyboard', note: 'Long number sequence' },

  // ========================================
  // DATED PATTERNS (should be fraud)
  // ========================================
  { email: 'user2025', expected: 'fraud', category: 'dated', note: 'Current year suffix' },
  { email: 'test2024', expected: 'fraud', category: 'dated', note: 'Recent year suffix' },
  { email: 'signup_jan2025', expected: 'fraud', category: 'dated', note: 'Month-year pattern' },

  // ========================================
  // LEGITIMATE NAMES (should be legit)
  // ========================================
  { email: 'scottpearson', expected: 'legit', category: 'legitimate', note: 'Real name (no separator)' },
  { email: 'person1.person2', expected: 'legit', category: 'legitimate', note: 'Name with dot separator' },
  { email: 'person3_person4', expected: 'legit', category: 'legitimate', note: 'Name with underscore' },
  { email: 'michaeljohnson', expected: 'legit', category: 'legitimate', note: 'Common compound name' },
  { email: 'alex.smith', expected: 'legit', category: 'legitimate', note: 'Standard first.last' },
  { email: 'sarah_williams', expected: 'legit', category: 'legitimate', note: 'First_last format' },
  { email: 'person5person6', expected: 'legit', category: 'legitimate', note: 'No separator' },
  { email: 'p.user', expected: 'legit', category: 'legitimate', note: 'Initial.lastname' },

  // ========================================
  // ROLE-BASED EMAILS (should be legit)
  // ========================================
  { email: 'contact', expected: 'legit', category: 'role_based', note: 'Contact role' },
  { email: 'admin', expected: 'legit', category: 'role_based', note: 'Admin role' },
  { email: 'support', expected: 'legit', category: 'role_based', note: 'Support role' },
  { email: 'info', expected: 'legit', category: 'role_based', note: 'Info role' },
  { email: 'sales', expected: 'legit', category: 'role_based', note: 'Sales role' },
  { email: 'hello', expected: 'legit', category: 'role_based', note: 'Friendly greeting role' },

  // ========================================
  // LEGITIMATE WITH NUMBERS (edge cases)
  // ========================================
  { email: 'person1.1985', expected: 'legit', category: 'legit_numbers', note: 'Name with birth year (1985)' },
  { email: 'person2.90', expected: 'legit', category: 'legit_numbers', note: 'Name with 2-digit year (1990)' },
  { email: 'person7.1992', expected: 'legit', category: 'legit_numbers', note: 'Name with birth year (1992)' },
  { email: 'person8.88', expected: 'legit', category: 'legit_numbers', note: 'Lucky number 88' },
  { email: 'person9.42', expected: 'legit', category: 'legit_numbers', note: 'Memorable number (42)' },

  // ========================================
  // INTERNATIONAL/DIVERSE PATTERNS
  // ========================================
  { email: 'personA', expected: 'legit', category: 'international', note: 'Short Asian-style name' },
  { email: 'personBpersonC', expected: 'legit', category: 'international', note: 'Compound short name' },
  { email: 'person.D', expected: 'legit', category: 'international', note: 'Name with initial' },

  // ========================================
  // EDGE CASES - AMBIGUOUS
  // ========================================
  { email: 'user', expected: 'legit', category: 'edge_case', note: 'Generic but potentially valid' },
  { email: 'test', expected: 'legit', category: 'edge_case', note: 'Test account on corporate domain' },
  { email: 'demo', expected: 'legit', category: 'edge_case', note: 'Demo account' },
];

class NGramMarkovChain {
  private order: number;
  private states: Map<string, any>;
  private trainingCount: number;

  constructor(data: any) {
    this.order = data.order;
    this.states = new Map();
    this.trainingCount = data.trainingCount;

    for (const stateData of data.states) {
      this.states.set(stateData.context, {
        context: stateData.context,
        nextChars: new Map(stateData.nextChars),
        totalTransitions: stateData.totalTransitions
      });
    }
  }

  normalize(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9._+-]/g, '');
  }

  getContext(text: string, i: number): string {
    if (this.order === 1) return '';
    if (this.order === 2) return i > 0 ? text[i - 1] : '';
    if (i < 2) return '';
    return text[i - 2] + text[i - 1];
  }

  getTransitionProb(context: string, next: string): number {
    const smoothing = 0.001;
    const vocabSize = 46;
    const state = this.states.get(context);

    if (!state || state.totalTransitions === 0) {
      return smoothing;
    }

    const count = state.nextChars.get(next) || 0;
    return (count + 1) / (state.totalTransitions + vocabSize);
  }

  crossEntropy(text: string): number {
    const normalized = this.normalize(text);
    if (normalized.length < this.order) return Infinity;

    let logProb = 0;
    let n = 0;

    for (let i = this.order - 1; i < normalized.length; i++) {
      const context = this.getContext(normalized, i);
      const next = normalized[i];
      const p = this.getTransitionProb(context, next);

      if (p > 0) {
        logProb += Math.log2(p);
        n++;
      }
    }

    return n > 0 ? -logProb / n : Infinity;
  }

  getOrder(): number {
    return this.order;
  }

  getStats() {
    return {
      order: this.order,
      states: this.states.size,
      trainingCount: this.trainingCount,
    };
  }
}

interface ModelResult {
  prediction: 'legit' | 'fraud';
  confidence: number;
  H_legit: number;
  H_fraud: number;
}

interface ValidationResult {
  email: string;
  expected: 'legit' | 'fraud';
  category: string;
  note: string;
  model2gram?: ModelResult;
  model3gram?: ModelResult;
  ensemble?: ModelResult & { reasoning: string };
  correct2gram?: boolean;
  correct3gram?: boolean;
  correctEnsemble?: boolean;
}

function calculateConfidence(H_legit: number, H_fraud: number): number {
  const diff = Math.abs(H_legit - H_fraud);
  const maxH = Math.max(H_legit, H_fraud);
  const ratio = maxH > 0 ? diff / maxH : 0;
  return Math.min(ratio * 2, 1.0);
}

function testModel(
  legitModel: NGramMarkovChain,
  fraudModel: NGramMarkovChain,
  email: string
): ModelResult {
  const H_legit = legitModel.crossEntropy(email);
  const H_fraud = fraudModel.crossEntropy(email);
  const prediction = H_fraud < H_legit ? 'fraud' : 'legit';
  const confidence = calculateConfidence(H_legit, H_fraud);

  return { prediction, confidence, H_legit, H_fraud };
}

function ensemblePredict(
  result2gram: ModelResult,
  result3gram: ModelResult
): ModelResult & { reasoning: string } {
  const prediction2 = result2gram.prediction;
  const prediction3 = result3gram.prediction;
  const confidence2 = result2gram.confidence;
  const confidence3 = result3gram.confidence;

  // Case 1: Both agree with reasonable confidence
  if (prediction2 === prediction3 && Math.min(confidence2, confidence3) > 0.3) {
    return {
      prediction: prediction2,
      confidence: Math.max(confidence2, confidence3),
      H_legit: result2gram.H_legit,
      H_fraud: result2gram.H_fraud,
      reasoning: 'both_agree_high_confidence'
    };
  }

  // Case 2: 3-gram has VERY high confidence
  if (confidence3 > 0.5 && confidence3 > confidence2 * 1.5) {
    return {
      ...result3gram,
      reasoning: '3gram_high_confidence_override'
    };
  }

  // Case 3: 2-gram detects gibberish (high cross-entropy on both)
  if (prediction2 === 'fraud' && confidence2 > 0.2 && result2gram.H_fraud > 6.0) {
    return {
      ...result2gram,
      reasoning: '2gram_gibberish_detection'
    };
  }

  // Case 4: Disagree - default to 2-gram (more robust)
  if (prediction2 !== prediction3) {
    return {
      ...result2gram,
      reasoning: 'disagree_default_to_2gram'
    };
  }

  // Case 5: Use higher confidence
  if (confidence2 >= confidence3) {
    return {
      ...result2gram,
      reasoning: '2gram_higher_confidence'
    };
  } else {
    return {
      ...result3gram,
      reasoning: '3gram_higher_confidence'
    };
  }
}

async function downloadModel(key: string, remote: boolean, binding: string): Promise<any> {
  const remoteFlag = remote ? '--remote' : '';
  try {
    const result = await $`npx wrangler kv key get ${key} --binding=${binding} ${remoteFlag}`.text();
    return JSON.parse(result);
  } catch (error) {
    logger.error(`Failed to download ${key}: ${error}`);
    return null;
  }
}

export default async function validateModels(args: string[]) {
  const parsed = parseArgs(args);

  if (hasFlag(parsed, 'help', 'h')) {
    console.log(`
╔════════════════════════════════════════════════════════╗
║              Model Validation Command                  ║
╚════════════════════════════════════════════════════════╝

Validates Markov Chain models against comprehensive test suite.
Tests individual models (2-gram, 3-gram) and ensemble approach.

USAGE
  npm run cli model:validate [options]

OPTIONS
  --remote            Download models from remote KV (production)
  --orders <list>     Which orders to test (default: "2,3")
  --ensemble          Test ensemble approach (requires 2 and 3-gram)
  --verbose           Show detailed results for each test case
  --category <cat>    Only test specific category (gibberish, sequential, etc.)
  --binding <name>    KV binding name (default: MARKOV_MODEL)
  --help, -h          Show this help message

EXAMPLES
  # Validate production models
  npm run cli model:validate --remote

  # Test only 2-gram model
  npm run cli model:validate --orders "2" --remote

  # Test ensemble with verbose output
  npm run cli model:validate --remote --ensemble --verbose

  # Test only gibberish detection
  npm run cli model:validate --remote --category gibberish

  # Use custom KV binding
  npm run cli model:validate --remote --binding MY_MODELS
    `);
    return;
  }

  const remote = hasFlag(parsed, 'remote');
  const testEnsemble = hasFlag(parsed, 'ensemble');
  const verbose = hasFlag(parsed, 'verbose');
  const categoryFilter = getOption(parsed, 'category');
  const binding = getOption(parsed, 'binding') || 'MARKOV_MODEL';

  const ordersStr = getOption(parsed, 'orders') || (testEnsemble ? '2,3' : '2');
  const orders = ordersStr.split(',').map(s => parseInt(s.trim(), 10)).filter(n => n >= 1 && n <= 3);

  logger.section('🧪 Model Validation');
  logger.info(`Source: ${remote ? 'Remote (production)' : 'Local (dev)'}`);
  logger.info(`Binding: ${binding}`);
  logger.info(`Testing orders: ${orders.join(', ')}`);
  if (testEnsemble) logger.info('Ensemble testing: enabled');
  if (categoryFilter) logger.info(`Category filter: ${categoryFilter}`);
  logger.info('');

  // Download/load models
  const models: Map<number, { legit: NGramMarkovChain, fraud: NGramMarkovChain }> = new Map();

  for (const order of orders) {
    logger.subsection(`Loading ${order}-gram models`);

    const legitData = await downloadModel(`MM_legit_${order}gram`, remote, binding);
    const fraudData = await downloadModel(`MM_fraud_${order}gram`, remote, binding);

    if (!legitData || !fraudData) {
      logger.error(`Failed to load ${order}-gram models`);
      continue;
    }

    const legitModel = new NGramMarkovChain(legitData);
    const fraudModel = new NGramMarkovChain(fraudData);

    models.set(order, { legit: legitModel, fraud: fraudModel });

    const legitStats = legitModel.getStats();
    const fraudStats = fraudModel.getStats();

    logger.info(`  Legit: ${legitStats.trainingCount} samples, ${legitStats.states} states`);
    logger.info(`  Fraud: ${fraudStats.trainingCount} samples, ${fraudStats.states} states`);
  }

  // Filter test cases if category specified
  const testCases = categoryFilter
    ? TEST_CASES.filter(tc => tc.category === categoryFilter)
    : TEST_CASES;

  if (testCases.length === 0) {
    logger.error(`No test cases found for category: ${categoryFilter}`);
    return;
  }

  logger.subsection(`Running ${testCases.length} test cases`);
  logger.info('');

  // Run tests
  const results: ValidationResult[] = [];

  for (const testCase of testCases) {
    const result: ValidationResult = {
      email: testCase.email,
      expected: testCase.expected,
      category: testCase.category,
      note: testCase.note,
    };

    // Test 2-gram
    if (models.has(2)) {
      const { legit, fraud } = models.get(2)!;
      result.model2gram = testModel(legit, fraud, testCase.email);
      result.correct2gram = result.model2gram.prediction === testCase.expected;
    }

    // Test 3-gram
    if (models.has(3)) {
      const { legit, fraud } = models.get(3)!;
      result.model3gram = testModel(legit, fraud, testCase.email);
      result.correct3gram = result.model3gram.prediction === testCase.expected;
    }

    // Test ensemble
    if (testEnsemble && result.model2gram && result.model3gram) {
      result.ensemble = ensemblePredict(result.model2gram, result.model3gram);
      result.correctEnsemble = result.ensemble.prediction === testCase.expected;
    }

    results.push(result);

    // Show individual results if verbose
    if (verbose) {
      const icon = result.correct2gram || result.correct3gram || result.correctEnsemble ? '✅' : '❌';
      console.log(`${icon} ${testCase.email.padEnd(20)} ${testCase.note}`);

      if (result.model2gram) {
        const icon2 = result.correct2gram ? '✅' : '❌';
        console.log(`   ${icon2} 2-gram: ${result.model2gram.prediction} (conf: ${result.model2gram.confidence.toFixed(3)})`);
      }
      if (result.model3gram) {
        const icon3 = result.correct3gram ? '✅' : '❌';
        console.log(`   ${icon3} 3-gram: ${result.model3gram.prediction} (conf: ${result.model3gram.confidence.toFixed(3)})`);
      }
      if (result.ensemble) {
        const iconE = result.correctEnsemble ? '✅' : '❌';
        console.log(`   ${iconE} Ensemble: ${result.ensemble.prediction} (conf: ${result.ensemble.confidence.toFixed(3)}, ${result.ensemble.reasoning})`);
      }
      console.log('');
    }
  }

  // Calculate metrics
  logger.section('📊 Validation Results');

  function calculateMetrics(results: ValidationResult[], field: 'correct2gram' | 'correct3gram' | 'correctEnsemble') {
    const filtered = results.filter(r => r[field] !== undefined);
    const correct = filtered.filter(r => r[field]).length;
    const total = filtered.length;
    const accuracy = (correct / total) * 100;

    // Per-category accuracy
    const categories = [...new Set(filtered.map(r => r.category))];
    const categoryStats = categories.map(cat => {
      const catResults = filtered.filter(r => r.category === cat);
      const catCorrect = catResults.filter(r => r[field]).length;
      return { category: cat, correct: catCorrect, total: catResults.length, accuracy: (catCorrect / catResults.length) * 100 };
    });

    return { correct, total, accuracy, categoryStats };
  }

  if (models.has(2)) {
    const metrics = calculateMetrics(results, 'correct2gram');
    logger.subsection('2-gram Model');
    logger.info(`  Accuracy: ${metrics.accuracy.toFixed(1)}% (${metrics.correct}/${metrics.total})`);
    for (const cat of metrics.categoryStats) {
      logger.info(`    ${cat.category}: ${cat.accuracy.toFixed(1)}% (${cat.correct}/${cat.total})`);
    }
    logger.info('');
  }

  if (models.has(3)) {
    const metrics = calculateMetrics(results, 'correct3gram');
    logger.subsection('3-gram Model');
    logger.info(`  Accuracy: ${metrics.accuracy.toFixed(1)}% (${metrics.correct}/${metrics.total})`);
    for (const cat of metrics.categoryStats) {
      logger.info(`    ${cat.category}: ${cat.accuracy.toFixed(1)}% (${cat.correct}/${cat.total})`);
    }
    logger.info('');
  }

  if (testEnsemble) {
    const metrics = calculateMetrics(results, 'correctEnsemble');
    logger.subsection('Ensemble (2-gram + 3-gram)');
    logger.info(`  Accuracy: ${metrics.accuracy.toFixed(1)}% (${metrics.correct}/${metrics.total})`);
    for (const cat of metrics.categoryStats) {
      logger.info(`    ${cat.category}: ${cat.accuracy.toFixed(1)}% (${cat.correct}/${cat.total})`);
    }

    // Show reasoning distribution
    const reasoningCounts = results.reduce((acc, r) => {
      if (r.ensemble) {
        acc[r.ensemble.reasoning] = (acc[r.ensemble.reasoning] || 0) + 1;
      }
      return acc;
    }, {} as Record<string, number>);

    logger.info('\n  Ensemble reasoning distribution:');
    for (const [reasoning, count] of Object.entries(reasoningCounts)) {
      const pct = (count / results.length * 100).toFixed(1);
      logger.info(`    ${reasoning}: ${count} (${pct}%)`);
    }
  }

  // Show failures
  const failures = results.filter(r =>
    (r.correct2gram === false) ||
    (r.correct3gram === false) ||
    (r.correctEnsemble === false)
  );

  if (failures.length > 0) {
    logger.subsection('❌ Failed Test Cases');
    for (const fail of failures) {
      console.log(`\n${fail.email} (expected: ${fail.expected})`);
      console.log(`  Category: ${fail.category} - ${fail.note}`);
      if (fail.model2gram && !fail.correct2gram) {
        console.log(`  ❌ 2-gram: ${fail.model2gram.prediction} (conf: ${fail.model2gram.confidence.toFixed(3)})`);
      }
      if (fail.model3gram && !fail.correct3gram) {
        console.log(`  ❌ 3-gram: ${fail.model3gram.prediction} (conf: ${fail.model3gram.confidence.toFixed(3)})`);
      }
      if (fail.ensemble && !fail.correctEnsemble) {
        console.log(`  ❌ Ensemble: ${fail.ensemble.prediction} (conf: ${fail.ensemble.confidence.toFixed(3)}, ${fail.ensemble.reasoning})`);
      }
    }
  }

  logger.success('\n✅ Validation complete!');
}
