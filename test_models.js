// Test the downloaded models with problematic emails
const fs = require('fs');

const legit2gram = JSON.parse(fs.readFileSync('markov_legit_2gram.json', 'utf8'));
const fraud2gram = JSON.parse(fs.readFileSync('markov_fraud_2gram.json', 'utf8'));
const legit3gram = JSON.parse(fs.readFileSync('markov_legit_3gram.json', 'utf8'));
const fraud3gram = JSON.parse(fs.readFileSync('markov_fraud_3gram.json', 'utf8'));

// Reconstruct NGramMarkovChain class (simplified)
class NGramMarkovChain {
  constructor(data) {
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

  normalize(text) {
    return text.toLowerCase().replace(/[^a-z0-9._+-]/g, '');
  }

  getContext(text, i) {
    if (this.order === 1) return '';
    if (this.order === 2) return i > 0 ? text[i - 1] : '';
    if (i < 2) return '';
    return text[i - 2] + text[i - 1];
  }

  getTransitionProb(context, next) {
    const smoothing = 0.001;
    const vocabSize = 46;
    const state = this.states.get(context);

    if (!state || state.totalTransitions === 0) {
      return smoothing;
    }

    const count = state.nextChars.get(next) || 0;
    return (count + 1) / (state.totalTransitions + vocabSize);
  }

  crossEntropy(text) {
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
}

const legitModel2 = new NGramMarkovChain(legit2gram);
const fraudModel2 = new NGramMarkovChain(fraud2gram);
const legitModel3 = new NGramMarkovChain(legit3gram);
const fraudModel3 = new NGramMarkovChain(fraud3gram);

// Test problematic emails
const testEmails = [
  { email: 'xkjgh2k9qw', expected: 'fraud', note: 'Gibberish (FALSE NEGATIVE)' },
  { email: 'zzz999xxx', expected: 'fraud', note: 'Repetitive gibberish (FALSE NEGATIVE)' },
  { email: 'qwpoeiruty', expected: 'fraud', note: 'Random gibberish (FALSE NEGATIVE)' },
  { email: 'user1', expected: 'legit', note: 'Generic user (FALSE POSITIVE)' },
  { email: 'user6', expected: 'legit', note: 'User with digit (FALSE POSITIVE)' },
  { email: 'scottpearson', expected: 'legit', note: 'Real name (TRUE NEGATIVE)' },
  { email: 'person1.person2', expected: 'legit', note: 'Name pattern (TRUE NEGATIVE)' },
  { email: 'user123', expected: 'fraud', note: 'Sequential (TRUE POSITIVE)' },
  { email: 'qwerty', expected: 'fraud', note: 'Keyboard walk (TRUE POSITIVE)' },
];

console.log('\n=== 2-GRAM MODEL ANALYSIS ===\n');
for (const test of testEmails) {
  const H_legit = legitModel2.crossEntropy(test.email);
  const H_fraud = fraudModel2.crossEntropy(test.email);
  const prediction = H_fraud < H_legit ? 'fraud' : 'legit';
  const diff = Math.abs(H_legit - H_fraud);
  const confidence = Math.min((diff / Math.max(H_legit, H_fraud)) * 2, 1.0);
  const correct = prediction === test.expected ? '✅' : '❌';

  console.log(`${correct} ${test.email.padEnd(20)} ${test.note}`);
  console.log(`   H_legit: ${H_legit.toFixed(3)}, H_fraud: ${H_fraud.toFixed(3)}, Diff: ${diff.toFixed(3)}`);
  console.log(`   Prediction: ${prediction} (confidence: ${confidence.toFixed(3)})\n`);
}

console.log('\n=== 3-GRAM MODEL ANALYSIS ===\n');
for (const test of testEmails) {
  const H_legit = legitModel3.crossEntropy(test.email);
  const H_fraud = fraudModel3.crossEntropy(test.email);
  const prediction = H_fraud < H_legit ? 'fraud' : 'legit';
  const diff = Math.abs(H_legit - H_fraud);
  const confidence = Math.min((diff / Math.max(H_legit, H_fraud)) * 2, 1.0);
  const correct = prediction === test.expected ? '✅' : '❌';

  console.log(`${correct} ${test.email.padEnd(20)} ${test.note}`);
  console.log(`   H_legit: ${H_legit.toFixed(3)}, H_fraud: ${H_fraud.toFixed(3)}, Diff: ${diff.toFixed(3)}`);
  console.log(`   Prediction: ${prediction} (confidence: ${confidence.toFixed(3)})\n`);
}
