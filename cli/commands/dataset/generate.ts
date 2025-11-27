/**
 * Synthetic Dataset Generator
 * Generate pattern-based fraud detection dataset (gibberish vs. legitimate names)
 */

import { logger } from '../../utils/logger.ts';
import { parseArgs, getOption, hasFlag } from '../../utils/args.ts';
import * as fs from 'fs';

// Common first names
const FIRST_NAMES = [
	'james', 'john', 'robert', 'michael', 'william', 'david', 'richard', 'joseph', 'thomas', 'charles',
	'mary', 'patricia', 'jennifer', 'linda', 'elizabeth', 'barbara', 'susan', 'jessica', 'sarah', 'karen',
	'daniel', 'matthew', 'anthony', 'donald', 'mark', 'paul', 'steven', 'andrew', 'kenneth', 'joshua',
	'nancy', 'betty', 'margaret', 'sandra', 'ashley', 'dorothy', 'kimberly', 'emily', 'donna', 'michelle',
	'christopher', 'brian', 'kevin', 'ryan', 'jacob', 'gary', 'nicholas', 'eric', 'jonathan', 'stephen',
	'lisa', 'amanda', 'melissa', 'deborah', 'stephanie', 'rebecca', 'laura', 'sharon', 'cynthia', 'kathleen',
	'alexander', 'benjamin', 'samuel', 'patrick', 'frank', 'raymond', 'jack', 'dennis', 'jerry', 'tyler',
	'carol', 'ruth', 'sharon', 'michelle', 'laura', 'sarah', 'kimberly', 'deborah', 'jessica', 'shirley',
	'aaron', 'jose', 'adam', 'zachary', 'nathan', 'walter', 'kyle', 'harold', 'carl', 'keith',
	'angela', 'helen', 'anna', 'brenda', 'pamela', 'nicole', 'emma', 'samantha', 'katherine', 'christine',
];

// Common last names
const LAST_NAMES = [
	'smith', 'johnson', 'williams', 'brown', 'jones', 'garcia', 'miller', 'davis', 'rodriguez', 'martinez',
	'hernandez', 'lopez', 'gonzalez', 'wilson', 'anderson', 'thomas', 'taylor', 'moore', 'jackson', 'martin',
	'lee', 'perez', 'thompson', 'white', 'harris', 'sanchez', 'clark', 'ramirez', 'lewis', 'robinson',
	'walker', 'young', 'allen', 'king', 'wright', 'scott', 'torres', 'nguyen', 'hill', 'flores',
	'green', 'adams', 'nelson', 'baker', 'hall', 'rivera', 'campbell', 'mitchell', 'carter', 'roberts',
	'phillips', 'evans', 'turner', 'diaz', 'parker', 'cruz', 'edwards', 'collins', 'reyes', 'stewart',
	'morris', 'morales', 'murphy', 'cook', 'rogers', 'gutierrez', 'ortiz', 'morgan', 'cooper', 'peterson',
	'bailey', 'reed', 'kelly', 'howard', 'ramos', 'kim', 'cox', 'ward', 'richardson', 'watson',
	'brooks', 'chavez', 'wood', 'james', 'bennett', 'gray', 'mendoza', 'ruiz', 'hughes', 'price',
	'alvarez', 'castillo', 'sanders', 'patel', 'myers', 'long', 'ross', 'foster', 'jimenez', 'powell',
];

// Email domains
const LEGIT_DOMAINS = [
	'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com',
	'company.com', 'corp.com', 'business.com', 'enterprise.com', 'tech.com',
	'university.edu', 'college.edu', 'school.edu', 'research.edu', 'institute.edu',
	'mail.com', 'email.com', 'protonmail.com', 'zoho.com', 'fastmail.com',
];

const FRAUD_DOMAINS = [
	'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'mail.com',
	'email.com', 'protonmail.com', 'tempmail.com', 'mailinator.com', 'guerrillamail.com',
];

/**
 * Generate legitimate email patterns
 */
function generateLegitimateEmail(): string {
	const rand = Math.random();
	const firstName = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
	const lastName = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
	const domain = LEGIT_DOMAINS[Math.floor(Math.random() * LEGIT_DOMAINS.length)];

	if (rand < 0.4) {
		// firstname.lastname@domain.com (40%)
		return `${firstName}.${lastName}@${domain}`;
	} else if (rand < 0.65) {
		// firstnamelastname@domain.com (25%)
		return `${firstName}${lastName}@${domain}`;
	} else if (rand < 0.80) {
		// firstname_lastname@domain.com (15%)
		return `${firstName}_${lastName}@${domain}`;
	} else if (rand < 0.90) {
		// f.lastname@domain.com (10%)
		return `${firstName[0]}.${lastName}@${domain}`;
	} else if (rand < 0.95) {
		// firstname@domain.com (5%)
		return `${firstName}@${domain}`;
	} else {
		// firstname.lastname+tag@domain.com (5%)
		const tags = ['work', 'personal', 'newsletter', 'shopping', 'notifications'];
		const tag = tags[Math.floor(Math.random() * tags.length)];
		return `${firstName}.${lastName}+${tag}@${domain}`;
	}
}

/**
 * Generate fraudulent gibberish patterns
 */
function generateFraudulentEmail(): string {
	const rand = Math.random();
	const domain = FRAUD_DOMAINS[Math.floor(Math.random() * FRAUD_DOMAINS.length)];

	if (rand < 0.25) {
		// Random lowercase letters (25%)
		const length = 6 + Math.floor(Math.random() * 8); // 6-13 chars
		let local = '';
		for (let i = 0; i < length; i++) {
			local += String.fromCharCode(97 + Math.floor(Math.random() * 26));
		}
		return `${local}@${domain}`;
	} else if (rand < 0.40) {
		// Sequential numbers (15%)
		const patterns = ['123', '456', '789', '111', '222', '333', '1234', '5678'];
		const pattern = patterns[Math.floor(Math.random() * patterns.length)];
		const prefix = Math.random() < 0.5 ? 'user' : 'test';
		return `${prefix}${pattern}@${domain}`;
	} else if (rand < 0.55) {
		// Keyboard mashing (15%)
		const mashPatterns = [
			'qwerty', 'asdfgh', 'zxcvbn', 'qwertyuiop', 'asdfghjkl',
			'poiuytrewq', 'lkjhgfdsa', 'mnbvcxz', 'qazwsx', 'plokijuhygt'
		];
		const mash = mashPatterns[Math.floor(Math.random() * mashPatterns.length)];
		const suffix = Math.floor(Math.random() * 1000);
		return `${mash}${suffix}@${domain}`;
	} else if (rand < 0.70) {
		// Random consonant clusters (15%)
		const consonants = 'bcdfghjklmnpqrstvwxyz';
		const vowels = 'aeiou';
		let local = '';
		const syllables = 2 + Math.floor(Math.random() * 3); // 2-4 syllables
		for (let i = 0; i < syllables; i++) {
			local += consonants[Math.floor(Math.random() * consonants.length)];
			local += vowels[Math.floor(Math.random() * vowels.length)];
			local += consonants[Math.floor(Math.random() * consonants.length)];
		}
		return `${local}@${domain}`;
	} else if (rand < 0.85) {
		// Mixed alphanumeric gibberish (15%)
		const length = 8 + Math.floor(Math.random() * 6); // 8-13 chars
		let local = '';
		const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
		for (let i = 0; i < length; i++) {
			local += chars[Math.floor(Math.random() * chars.length)];
		}
		return `${local}@${domain}`;
	} else {
		// Repeated characters (15%)
		const chars = 'abcdefghijklmnopqrstuvwxyz';
		const char = chars[Math.floor(Math.random() * chars.length)];
		const count = 4 + Math.floor(Math.random() * 6); // 4-9 repetitions
		const num = Math.floor(Math.random() * 1000);
		return `${char.repeat(count)}${num}@${domain}`;
	}
}

export default async function generateDataset(args: string[]) {
	const parsed = parseArgs(args);
	const legitCount = parseInt(getOption(parsed, 'legit') || '25000');
	const fraudCount = parseInt(getOption(parsed, 'fraud') || '25000');
	const outputPath = getOption(parsed, 'output') || 'dataset/synthetic_pattern_dataset.csv';
	const verbose = hasFlag(parsed, 'verbose');

	logger.section('Synthetic Pattern Dataset Generation');
	logger.info(`Legitimate emails: ${legitCount.toLocaleString()}`);
	logger.info(`Fraudulent emails: ${fraudCount.toLocaleString()}`);
	logger.info(`Total: ${(legitCount + fraudCount).toLocaleString()}`);
	logger.info(`Output: ${outputPath}`);
	logger.info('');

	// Generate emails
	logger.subsection('Generating Legitimate Patterns');
	const legitimateEmails = new Set<string>();
	let attempts = 0;
	const maxAttempts = legitCount * 3;

	while (legitimateEmails.size < legitCount && attempts < maxAttempts) {
		const email = generateLegitimateEmail();
		legitimateEmails.add(email);
		attempts++;

		if (legitimateEmails.size % 5000 === 0) {
			logger.progress(legitimateEmails.size, legitCount, 'Generating');
		}
	}
	logger.progress(legitimateEmails.size, legitCount, 'Generating');
	logger.info('');

	logger.subsection('Generating Fraudulent Patterns');
	const fraudulentEmails = new Set<string>();
	attempts = 0;

	while (fraudulentEmails.size < fraudCount && attempts < maxAttempts) {
		const email = generateFraudulentEmail();
		// Ensure no overlap with legitimate
		if (!legitimateEmails.has(email)) {
			fraudulentEmails.add(email);
		}
		attempts++;

		if (fraudulentEmails.size % 5000 === 0) {
			logger.progress(fraudulentEmails.size, fraudCount, 'Generating');
		}
	}
	logger.progress(fraudulentEmails.size, fraudCount, 'Generating');
	logger.info('');

	// Combine and shuffle
	logger.subsection('Creating CSV');
	const allEmails: Array<{ email: string; label: number }> = [];

	for (const email of legitimateEmails) {
		allEmails.push({ email, label: 0 });
	}
	for (const email of fraudulentEmails) {
		allEmails.push({ email, label: 1 });
	}

	// Shuffle using Fisher-Yates
	for (let i = allEmails.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[allEmails[i], allEmails[j]] = [allEmails[j], allEmails[i]];
	}

	// Write CSV
	const csvLines = ['email,label'];
	for (const { email, label } of allEmails) {
		csvLines.push(`${email},${label}`);
	}

	fs.writeFileSync(outputPath, csvLines.join('\n'));
	logger.success(`Dataset saved to: ${outputPath}`);
	logger.info('');

	// Statistics
	logger.subsection('Dataset Statistics');
	logger.info(`Total emails: ${allEmails.length.toLocaleString()}`);
	logger.info(`Legitimate: ${legitimateEmails.size.toLocaleString()} (${((legitimateEmails.size / allEmails.length) * 100).toFixed(1)}%)`);
	logger.info(`Fraudulent: ${fraudulentEmails.size.toLocaleString()} (${((fraudulentEmails.size / allEmails.length) * 100).toFixed(1)}%)`);
	logger.info('');

	// Show samples
	if (verbose) {
		logger.subsection('Sample Legitimate Emails (10)');
		Array.from(legitimateEmails).slice(0, 10).forEach(email => {
			console.log(`  ${email}`);
		});
		logger.info('');

		logger.subsection('Sample Fraudulent Emails (10)');
		Array.from(fraudulentEmails).slice(0, 10).forEach(email => {
			console.log(`  ${email}`);
		});
		logger.info('');
	}

	logger.subsection('Next Steps');
	logger.info('1. Review samples to ensure quality:');
	logger.info(`   head -20 ${outputPath}`);
	logger.info('2. Train Markov models:');
	logger.info(`   npm run cli train:markov --dataset ${outputPath} --upload --remote`);
	logger.info('3. Calibrate:');
	logger.info(`   npm run cli train:calibrate --dataset ${outputPath} --upload`);
	logger.info('4. Run batch test:');
	logger.info(`   npm run cli test:batch --input ${outputPath}`);
}
