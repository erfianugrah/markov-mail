/**
 * Generate Test Data Command
 */

import { logger } from '../../utils/logger.ts';
import { parseArgs, getOption, hasFlag } from '../../utils/args.ts';
import * as fs from 'fs';
import * as path from 'path';

// Generate legitimate email patterns
function generateLegitEmails(count: number) {
  const emails = [];
  const firstNames = [
    'john', 'sarah', 'michael', 'jessica', 'david', 'emily', 'james', 'ashley',
    'robert', 'amanda', 'william', 'jennifer', 'richard', 'lisa', 'daniel',
    'maria', 'thomas', 'karen', 'charles', 'nancy', 'matthew', 'betty', 'joseph',
    'margaret', 'christopher', 'sandra', 'anthony', 'ashley', 'mark', 'donna'
  ];
  const lastNames = [
    'smith', 'johnson', 'williams', 'brown', 'jones', 'garcia', 'miller',
    'davis', 'rodriguez', 'martinez', 'hernandez', 'lopez', 'gonzalez', 'wilson',
    'anderson', 'thomas', 'taylor', 'moore', 'jackson', 'martin', 'lee',
    'perez', 'thompson', 'white', 'harris', 'sanchez', 'clark', 'ramirez'
  ];
  const domains = [
    'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com',
    'protonmail.com', 'aol.com', 'mail.com', 'zoho.com', 'gmx.com'
  ];

  for (let i = 0; i < count; i++) {
    const first = firstNames[Math.floor(Math.random() * firstNames.length)];
    const last = lastNames[Math.floor(Math.random() * lastNames.length)];
    const domain = domains[Math.floor(Math.random() * domains.length)];

    const patterns = [
      `${first}.${last}@${domain}`,
      `${first}${last}@${domain}`,
      `${first}_${last}@${domain}`,
      `${first}${Math.floor(Math.random() * 100)}@${domain}`,
      `${first}.${last}${Math.floor(Math.random() * 10000)}@${domain}`,
      `${first[0]}.${last}@${domain}`,
      `${first}${last[0]}@${domain}`,
    ];

    emails.push({
      email: patterns[Math.floor(Math.random() * patterns.length)],
      type: 'legitimate',
      category: 'legit-name'
    });
  }

  return emails;
}

// Generate fraudulent email patterns
function generateFraudEmails(count: number) {
  const emails = [];
  const disposableDomains = [
    'tempmail.com', '10minutemail.com', 'guerrillamail.com', 'mailinator.com',
    'throwaway.email', 'temp-mail.org', 'getnada.com', 'maildrop.cc',
    'trashmail.com', 'sharklasers.com'
  ];
  const randomChars = 'abcdefghijklmnopqrstuvwxyz0123456789';

  const fraudTypes = [
    'sequential',
    'dated',
    'entropy',
    'disposable'
  ];

  for (let i = 0; i < count; i++) {
    const fraudType = fraudTypes[Math.floor(Math.random() * fraudTypes.length)];
    let email: string, category: string;

    switch (fraudType) {
      case 'sequential':
        const seqPrefixes = ['user', 'test', 'account', 'member', 'signup', 'admin'];
        const prefix = seqPrefixes[Math.floor(Math.random() * seqPrefixes.length)];
        const num = Math.floor(Math.random() * 10000);
        email = `${prefix}${num}@gmail.com`;
        category = 'fraud-sequential';
        break;

      case 'dated':
        const year = 2020 + Math.floor(Math.random() * 6);
        const month = (Math.floor(Math.random() * 12) + 1).toString().padStart(2, '0');
        const day = (Math.floor(Math.random() * 28) + 1).toString().padStart(2, '0');
        const datePatterns = [
          `user${year}@gmail.com`,
          `signup${year}${month}@outlook.com`,
          `test_${year}${month}${day}@yahoo.com`,
          `account_${year}@hotmail.com`
        ];
        email = datePatterns[Math.floor(Math.random() * datePatterns.length)];
        category = 'fraud-dated';
        break;

      case 'entropy':
        const length = Math.floor(Math.random() * 8) + 8;
        let local = '';
        for (let j = 0; j < length; j++) {
          local += randomChars[Math.floor(Math.random() * randomChars.length)];
        }
        const repeatChars = Math.random() > 0.5;
        if (repeatChars) {
          const char = randomChars[Math.floor(Math.random() * randomChars.length)];
          local = char.repeat(3) + local.substring(3);
        }
        email = `${local}@gmail.com`;
        category = 'fraud-entropy';
        break;

      case 'disposable':
        const dispLocal = Array.from({ length: 8 }, () =>
          randomChars[Math.floor(Math.random() * randomChars.length)]
        ).join('');
        const dispDomain = disposableDomains[Math.floor(Math.random() * disposableDomains.length)];
        email = `${dispLocal}@${dispDomain}`;
        category = 'fraud-disposable';
        break;

      default:
        email = 'error@example.com';
        category = 'error';
    }

    emails.push({
      email,
      type: 'fraudulent',
      category
    });
  }

  return emails;
}

export default async function generate(args: string[]) {
  const parsed = parseArgs(args);

  if (hasFlag(parsed, 'help', 'h')) {
    console.log(`
╔════════════════════════════════════════════════════════╗
║              Generate Test Data                        ║
╚════════════════════════════════════════════════════════╝

Generate fraudulent email test datasets.

USAGE
  npm run cli test:generate [options]

OPTIONS
  --count <n>           Number of emails to generate (default: 100)
  --output <path>       Output file path (default: test-data/generated-emails.json)
  --help, -h            Show this help message

EXAMPLES
  npm run cli test:generate --count 5000
  npm run cli test:generate --count 1000 --output /tmp/emails.json
`);
    return;
  }

  const count = parseInt(getOption(parsed, 'count') || '100');
  const outputPath = getOption(parsed, 'output') || path.join(process.cwd(), 'test-data', 'generated-emails.json');

  logger.section('🧪 Generating Test Data');
  logger.info(`Count: ${count}`);
  logger.info(`Output: ${outputPath}`);

  try {
    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Generate balanced dataset
    const legitCount = Math.floor(count / 2);
    const fraudCount = count - legitCount;

    logger.info(`Generating ${legitCount} legitimate emails...`);
    const legitEmails = generateLegitEmails(legitCount);

    logger.info(`Generating ${fraudCount} fraudulent emails...`);
    const fraudEmails = generateFraudEmails(fraudCount);

    const allEmails = [...legitEmails, ...fraudEmails];

    // Shuffle array
    for (let i = allEmails.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allEmails[i], allEmails[j]] = [allEmails[j], allEmails[i]];
    }

    const output = {
      generated: new Date().toISOString(),
      count: allEmails.length,
      legitimate: legitCount,
      fraudulent: fraudCount,
      emails: allEmails
    };

    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

    logger.success('✨ Test data generated!');
    logger.info(`   Legitimate: ${legitCount}`);
    logger.info(`   Fraudulent: ${fraudCount}`);
    logger.info(`   Total: ${count}`);
  } catch (error) {
    logger.error(`Generation failed: ${error}`);
    process.exit(1);
  }
}
