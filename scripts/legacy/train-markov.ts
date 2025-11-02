/**
 * Markov Chain Model Training Script
 *
 * Trains separate Markov Chain models for legitimate and fraudulent email addresses
 * using labeled CSV datasets. Saves models to Cloudflare KV with the new naming scheme.
 */

import { readFile } from 'fs/promises';
import { parse } from 'csv-parse/sync';
import { DynamicMarkovChain } from './src/detectors/markov-chain.ts';

/**
 * Extract email address from sender field
 * Example: "John Doe <person1.person2@example.com>" -> "john.doe"
 */
function extractLocalPart(sender: string): string | null {
  // Extract email from various formats
  const emailMatch = sender.match(/<([^>]+)>/) || sender.match(/([^\s]+@[^\s]+)/);

  if (!emailMatch) {
    return null;
  }

  const email = emailMatch[1];
  const localPart = email.split('@')[0];

  // Filter out very short or very long local parts
  if (!localPart || localPart.length < 2 || localPart.length > 64) {
    return null;
  }

  return localPart;
}

/**
 * Load and parse CSV file
 */
async function loadCSV(filepath: string): Promise<{ legit: string[], fraud: string[] }> {
  console.log(`Loading ${filepath}...`);

  try {
    const content = await readFile(filepath, 'utf-8');
    const records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      relax_quotes: true,
      relax_column_count: true,
    });

    const legit: string[] = [];
    const fraud: string[] = [];

    for (const record of records) {
      // Check if this dataset has a sender field
      if (!record.sender && !record.Email) {
        continue; // Skip datasets without sender info
      }

      const sender = record.sender || record.Email || '';
      const label = record.label || (record['Email Type'] === 'Phishing Email' ? 1 : 0);

      const localPart = extractLocalPart(sender);

      if (localPart) {
        if (parseInt(label) === 1) {
          fraud.push(localPart);
        } else {
          legit.push(localPart);
        }
      }
    }

    console.log(`  ✓ Loaded ${legit.length} legit + ${fraud.length} fraud samples`);
    return { legit, fraud };

  } catch (error) {
    console.error(`  ✗ Error loading ${filepath}:`, error);
    return { legit: [], fraud: [] };
  }
}

/**
 * Main training function
 */
async function trainModels() {
  console.log('🚀 Starting Markov Chain Training\n');

  // Dataset files to process (only those with sender fields)
  const datasetFiles = [
    'dataset/8339691/CEAS_08.csv',
    'dataset/8339691/SpamAssasin.csv',
    'dataset/8339691/Nigerian_Fraud.csv',
    'dataset/8339691/Nigerian_5.csv',
    'dataset/8339691/Nazario.csv',
    'dataset/8339691/Nazario_5.csv',
    'dataset/8339691/TREC_05.csv',
    'dataset/8339691/TREC_06.csv',
    'dataset/8339691/TREC_07.csv',
  ];

  let allLegit: string[] = [];
  let allFraud: string[] = [];

  // Load all datasets
  for (const file of datasetFiles) {
    const { legit, fraud } = await loadCSV(file);
    allLegit.push(...legit);
    allFraud.push(...fraud);
  }

  console.log(`\n📊 Total samples collected:`);
  console.log(`   Legitimate: ${allLegit.length.toLocaleString()}`);
  console.log(`   Fraudulent: ${allFraud.length.toLocaleString()}`);
  console.log(`   Total: ${(allLegit.length + allFraud.length).toLocaleString()}`);

  // Create and train models
  console.log(`\n🔧 Training Markov Chain models...`);

  const legitModel = new DynamicMarkovChain();
  const fraudModel = new DynamicMarkovChain();

  console.log(`   Training legitimate model...`);
  let count = 0;
  for (const email of allLegit) {
    legitModel.train(email);
    count++;
    if (count % 100000 === 0) {
      console.log(`      Processed ${count.toLocaleString()} / ${allLegit.length.toLocaleString()}`);
    }
  }

  console.log(`   Training fraudulent model...`);
  count = 0;
  for (const email of allFraud) {
    fraudModel.train(email);
    count++;
    if (count % 100000 === 0) {
      console.log(`      Processed ${count.toLocaleString()} / ${allFraud.length.toLocaleString()}`);
    }
  }

  console.log(`   ✓ Training complete!`);

  // Test the models
  console.log(`\n🧪 Testing models on sample emails:\n`);

  const testEmails = [
    { email: 'john.doe', expected: 'legit' },
    { email: 'user123', expected: 'fraud' },
    { email: 'admin', expected: 'legit' },
    { email: 'zzzzqqq', expected: 'fraud' },
    { email: 'support', expected: 'legit' },
    { email: 'abc123xyz', expected: 'fraud' },
  ];

  for (const { email, expected } of testEmails) {
    const legitEntropy = legitModel.crossEntropy(email);
    const fraudEntropy = fraudModel.crossEntropy(email);
    const prediction = legitEntropy < fraudEntropy ? 'legit' : 'fraud';
    const match = prediction === expected ? '✓' : '✗';

    console.log(`   ${match} "${email}":`);
    console.log(`      Legit: ${legitEntropy.toFixed(3)}, Fraud: ${fraudEntropy.toFixed(3)} → ${prediction}`);
  }

  // Save models to JSON files
  console.log(`\n💾 Saving models...`);

  const legitJSON = JSON.stringify(legitModel.toJSON(), null, 2);
  const fraudJSON = JSON.stringify(fraudModel.toJSON(), null, 2);

  // Save to files (direct model data, no wrapper)
  await Bun.write('markov_legit_model.json', legitJSON);
  await Bun.write('markov_fraud_model.json', fraudJSON);

  console.log(`   ✓ Saved markov_legit_model.json (${(legitJSON.length / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`   ✓ Saved markov_fraud_model.json (${(fraudJSON.length / 1024 / 1024).toFixed(2)} MB)`);

  console.log(`\n✅ Training complete!`);
  console.log(`\nNext steps:`);
  console.log(`  1. Upload models to KV:`);
  console.log(`     npx wrangler kv key put MM1_legit_candidate --path=markov_legit_model.json --binding=MARKOV_MODEL`);
  console.log(`     npx wrangler kv key put MM1_fraud_candidate --path=markov_fraud_model.json --binding=MARKOV_MODEL`);
  console.log(`  2. Test the candidate models`);
  console.log(`  3. Promote to production:`);
  console.log(`     npx wrangler kv key put MM_legit_production --path=markov_legit_model.json --binding=MARKOV_MODEL`);
  console.log(`     npx wrangler kv key put MM_fraud_production --path=markov_fraud_model.json --binding=MARKOV_MODEL`);
}

// Run training
trainModels().catch(console.error);
