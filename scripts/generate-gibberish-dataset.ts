/**
 * Generate Gibberish Training Dataset
 *
 * Creates high-quality training data for Markov models by generating:
 * 1. Gibberish emails (fraud)
 * 2. Legitimate-looking emails (legit)
 *
 * Output: CSV file ready for training
 */

import { writeFile } from 'fs/promises';

/**
 * Generate random gibberish string
 */
function generateGibberish(length: number): string {
  const consonants = 'bcdfghjklmnpqrstvwxyz';
  const vowels = 'aeiou';
  let result = '';

  for (let i = 0; i < length; i++) {
    // Alternate consonants and vowels for pronounceable gibberish
    if (i % 2 === 0) {
      result += consonants[Math.floor(Math.random() * consonants.length)];
    } else {
      result += vowels[Math.floor(Math.random() * vowels.length)];
    }
  }

  return result;
}

/**
 * Generate fully random gibberish (harder to detect)
 */
function generateRandomGibberish(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join('');
}

/**
 * Generate legitimate-looking name patterns
 */
function generateLegitName(): string {
  const firstNames = [
    'john', 'jane', 'michael', 'sarah', 'david', 'emily', 'robert', 'lisa',
    'william', 'jennifer', 'james', 'mary', 'thomas', 'patricia', 'daniel',
    'elizabeth', 'matthew', 'barbara', 'anthony', 'susan', 'mark', 'jessica',
    'paul', 'nancy', 'steven', 'ashley', 'andrew', 'donna', 'joshua', 'amanda'
  ];

  const lastNames = [
    'smith', 'johnson', 'williams', 'brown', 'jones', 'garcia', 'miller',
    'davis', 'rodriguez', 'martinez', 'hernandez', 'lopez', 'gonzalez',
    'wilson', 'anderson', 'thomas', 'taylor', 'moore', 'jackson', 'martin',
    'lee', 'perez', 'thompson', 'white', 'harris', 'sanchez', 'clark'
  ];

  const first = firstNames[Math.floor(Math.random() * firstNames.length)];
  const last = lastNames[Math.floor(Math.random() * lastNames.length)];

  // Vary the format
  const formats = [
    `${first}.${last}`,
    `${first}${last}`,
    `${first}`,
    `${first[0]}${last}`,
    `${first}.${last[0]}`,
  ];

  return formats[Math.floor(Math.random() * formats.length)];
}

/**
 * Generate fraud dataset (gibberish emails)
 */
function generateFraudDataset(count: number): Array<{ email: string; label: string }> {
  const domains = ['gmail.com', 'yahoo.com', 'outlook.com', 'mail.com', 'gmx.com'];
  const fraudEmails: Array<{ email: string; label: string }> = [];

  for (let i = 0; i < count; i++) {
    const domain = domains[Math.floor(Math.random() * domains.length)];
    const length = 8 + Math.floor(Math.random() * 8); // 8-15 chars

    // Mix of pronounceable and random gibberish
    const localPart = Math.random() > 0.5
      ? generateGibberish(length)
      : generateRandomGibberish(length);

    fraudEmails.push({
      email: `${localPart}@${domain}`,
      label: 'fraud'
    });
  }

  return fraudEmails;
}

/**
 * Generate legitimate dataset (real-looking emails)
 */
function generateLegitDataset(count: number): Array<{ email: string; label: string }> {
  const domains = [
    'gmail.com', 'yahoo.com', 'outlook.com', 'company.com',
    'example.com', 'business.com', 'corporation.com', 'university.edu'
  ];
  const legitEmails: Array<{ email: string; label: string }> = [];

  for (let i = 0; i < count; i++) {
    const domain = domains[Math.floor(Math.random() * domains.length)];
    const localPart = generateLegitName();

    // Sometimes add numbers (but not sequential)
    if (Math.random() > 0.8) {
      const randomNum = Math.floor(Math.random() * 100);
      const sep = Math.random() > 0.5 ? '.' : '';
      legitEmails.push({
        email: `${localPart}${sep}${randomNum}@${domain}`,
        label: 'legit'
      });
    } else {
      legitEmails.push({
        email: `${localPart}@${domain}`,
        label: 'legit'
      });
    }
  }

  return legitEmails;
}

/**
 * Convert dataset to CSV
 */
function toCSV(dataset: Array<{ email: string; label: string }>): string {
  const header = 'email,label\n';
  const rows = dataset.map(row => `${row.email},${row.label}`).join('\n');
  return header + rows;
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  const fraudCount = parseInt(args[0] || '5000');
  const legitCount = parseInt(args[1] || '5000');
  const outputFile = args[2] || './dataset/generated-training.csv';

  console.log('\n🎲 Generating Training Dataset');
  console.log('═'.repeat(60));
  console.log(`Fraud emails:  ${fraudCount}`);
  console.log(`Legit emails:  ${legitCount}`);
  console.log(`Total:         ${fraudCount + legitCount}`);
  console.log(`Output:        ${outputFile}`);
  console.log('═'.repeat(60));
  console.log();

  // Generate datasets
  console.log('⏳ Generating fraud emails (gibberish)...');
  const fraudData = generateFraudDataset(fraudCount);
  console.log(`✓ Generated ${fraudData.length} fraud emails`);

  console.log('⏳ Generating legitimate emails...');
  const legitData = generateLegitDataset(legitCount);
  console.log(`✓ Generated ${legitData.length} legit emails`);

  // Combine and shuffle
  console.log('⏳ Shuffling dataset...');
  const combined = [...fraudData, ...legitData];
  for (let i = combined.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [combined[i], combined[j]] = [combined[j], combined[i]];
  }

  // Write to file
  console.log(`⏳ Writing to ${outputFile}...`);
  const csv = toCSV(combined);
  await writeFile(outputFile, csv, 'utf-8');

  console.log();
  console.log('✅ Dataset generated successfully!');
  console.log();
  console.log('Next steps:');
  console.log(`  1. Review the dataset: cat ${outputFile} | head -20`);
  console.log(`  2. Train models: npm run cli train:markov --dataset ${outputFile}`);
  console.log();
}

main().catch(console.error);
