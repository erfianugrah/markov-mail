// Analyze data sparsity in the models
const fs = require('fs');

const legit2 = JSON.parse(fs.readFileSync('markov_legit_2gram.json', 'utf8'));
const fraud2 = JSON.parse(fs.readFileSync('markov_fraud_2gram.json', 'utf8'));
const legit3 = JSON.parse(fs.readFileSync('markov_legit_3gram.json', 'utf8'));
const fraud3 = JSON.parse(fs.readFileSync('markov_fraud_3gram.json', 'utf8'));

console.log('\n=== DATA SPARSITY ANALYSIS ===\n');

// Helper to analyze state coverage
function analyzeModel(model, name) {
  const states = model.states;
  const trainingCount = model.trainingCount;
  const stateCount = states.length;

  // Calculate transitions distribution
  const transitions = states.map(s => s.totalTransitions);
  const totalTransitions = transitions.reduce((a, b) => a + b, 0);
  const avgTransitions = totalTransitions / stateCount;
  const minTransitions = Math.min(...transitions);
  const maxTransitions = Math.max(...transitions);

  // Calculate how many states are undertrained (< 100 transitions)
  const undertrainedStates = transitions.filter(t => t < 100).length;
  const undertrainedPct = (undertrainedStates / stateCount * 100).toFixed(1);

  // Calculate examples per state
  const examplesPerState = trainingCount / stateCount;

  console.log(name + ':');
  console.log('  Training samples: ' + trainingCount);
  console.log('  Unique states: ' + stateCount);
  console.log('  Examples per state: ' + examplesPerState.toFixed(1));
  console.log('  Avg transitions/state: ' + avgTransitions.toFixed(1));
  console.log('  Range: ' + minTransitions + ' - ' + maxTransitions);
  console.log('  Undertrained states (<100): ' + undertrainedStates + ' (' + undertrainedPct + '%)');
  console.log('');
}

analyzeModel(legit2, '2-gram Legitimate');
analyzeModel(fraud2, '2-gram Fraudulent');
analyzeModel(legit3, '3-gram Legitimate');
analyzeModel(fraud3, '3-gram Fraudulent');

// Theoretical state space
console.log('=== THEORETICAL STATE SPACE ===\n');
console.log('For emails (a-z, 0-9, ., _, +, -)');
console.log('  2-gram: ~46 possible contexts (single char)');
console.log('  3-gram: ~2,116 possible contexts (2 chars)');
console.log('');
console.log('Recommended training samples:');
console.log('  2-gram: 10K-50K samples (SUFFICIENT)');
console.log('  3-gram: 200K-1M samples (INSUFFICIENT - only have 44K)');
console.log('');

// Check specific contexts for gibberish
console.log('=== GIBBERISH CONTEXT ANALYSIS ===\n');

function checkContext(model, context, name) {
  const state = model.states.find(s => s.context === context);
  if (state) {
    console.log('  ' + context + ': ' + state.totalTransitions + ' transitions (trained)');
  } else {
    console.log('  ' + context + ': 0 transitions (UNSEEN - uses smoothing)');
  }
}

console.log('Checking contexts in "xkjgh2k9qw":');
console.log('\n3-gram fraud model:');
checkContext(fraud3, 'xk', '3-gram fraud');
checkContext(fraud3, 'kj', '3-gram fraud');
checkContext(fraud3, 'jg', '3-gram fraud');
checkContext(fraud3, 'gh', '3-gram fraud');
checkContext(fraud3, 'h2', '3-gram fraud');
checkContext(fraud3, '2k', '3-gram fraud');
checkContext(fraud3, 'k9', '3-gram fraud');
checkContext(fraud3, '9q', '3-gram fraud');

console.log('\nChecking contexts in "user1":');
console.log('\n3-gram fraud model:');
checkContext(fraud3, 'us', '3-gram fraud');
checkContext(fraud3, 'se', '3-gram fraud');
checkContext(fraud3, 'er', '3-gram fraud');
checkContext(fraud3, 'r1', '3-gram fraud');

console.log('\n3-gram legit model:');
checkContext(legit3, 'us', '3-gram legit');
checkContext(legit3, 'se', '3-gram legit');
checkContext(legit3, 'er', '3-gram legit');
checkContext(legit3, 'r1', '3-gram legit');
