/**
 * Manual test script for pattern detectors
 * Run with: node test-detectors.js
 */

// Import detectors (using dynamic import since we're in a .js file)
async function testDetectors() {
  const {
    detectSequentialPattern,
    detectDatedPattern,
    normalizeEmail,
    detectKeyboardWalk
  } = await import('./src/detectors/index.ts');

  console.log('🧪 Testing Pattern Detectors\n');

  // Test Sequential Patterns
  console.log('📊 Sequential Pattern Detection:');
  const seqTests = [
    'user123@gmail.com',
    'john.doe.001@yahoo.com',
    'test_account_456@outlook.com',
    'normaluser@gmail.com'
  ];

  for (const email of seqTests) {
    const result = detectSequentialPattern(email);
    console.log(`  ${email}`);
    console.log(`    Sequential: ${result.isSequential}, Confidence: ${result.confidence.toFixed(2)}`);
    if (result.isSequential) {
      console.log(`    Base: ${result.basePattern}, Sequence: ${result.sequence}`);
    }
  }

  // Test Dated Patterns
  console.log('\n📅 Dated Pattern Detection:');
  const currentYear = new Date().getFullYear();
  const datedTests = [
    `john.doe.${currentYear}@gmail.com`,
    `jane.smith.${currentYear}@gmail.com`,
    `user_oct${currentYear}@yahoo.com`,
    'person1.person2@gmail.com'
  ];

  for (const email of datedTests) {
    const result = detectDatedPattern(email);
    console.log(`  ${email}`);
    console.log(`    Dated: ${result.hasDatedPattern}, Type: ${result.dateType}, Confidence: ${result.confidence.toFixed(2)}`);
    if (result.hasDatedPattern) {
      console.log(`    Base: ${result.basePattern}, Date: ${result.dateComponent}`);
    }
  }

  // Test Plus-Addressing
  console.log('\n➕ Plus-Addressing Normalization:');
  const plusTests = [
    'user+1@gmail.com',
    'user+test@gmail.com',
    'john.doe+spam@gmail.com',
    'normaluser@gmail.com'
  ];

  for (const email of plusTests) {
    const result = normalizeEmail(email);
    console.log(`  ${email}`);
    console.log(`    Normalized: ${result.normalized}`);
    console.log(`    Has Plus: ${result.hasPlus}, Tag: ${result.plusTag || 'N/A'}`);
    console.log(`    Provider Normalized: ${result.providerNormalized}`);
    console.log(`    Suspicious: ${result.metadata?.suspiciousTag || false}`);
  }

  // Test Keyboard Walks
  console.log('\n⌨️  Keyboard Walk Detection:');
  const keyboardTests = [
    'qwerty@example.com',
    'asdfgh@example.com',
    'user123456@example.com',
    'normaluser@example.com'
  ];

  for (const email of keyboardTests) {
    const result = detectKeyboardWalk(email);
    console.log(`  ${email}`);
    console.log(`    Has Walk: ${result.hasKeyboardWalk}, Type: ${result.walkType}, Confidence: ${result.confidence.toFixed(2)}`);
    if (result.hasKeyboardWalk) {
      console.log(`    Pattern: ${result.pattern}`);
    }
  }

  console.log('\n✅ All detector tests completed!\n');
}

testDetectors().catch(console.error);
