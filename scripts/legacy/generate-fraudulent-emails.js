/**
 * Fraudulent Email Generator
 *
 * Generates realistic fraudulent email patterns using legitimate domains
 * to test detection algorithms
 *
 * Usage: node generate-fraudulent-emails.js [count]
 */

// Legitimate domains to use (real companies, popular providers)
const legitimateDomains = [
	// Enterprise domains
	'company.com',
	'enterprise.com',
	'business.com',
	'corporation.com',
	'firm.com',
	'agency.com',
	'startup.io',
	'tech.com',
	'services.com',
	'consulting.com',

	// Free providers (most common for fraud)
	'gmail.com',
	'yahoo.com',
	'outlook.com',
	'hotmail.com',
	'protonmail.com',
	'icloud.com',
	'aol.com',
	'mail.com',

	// International providers
	'gmx.com',
	'gmx.de',
	'web.de',
	'yandex.com',
	'qq.com',
	'163.com',
];

// Real names for realistic patterns
const firstNames = [
	'john', 'jane', 'michael', 'sarah', 'david', 'emily', 'robert', 'jessica',
	'william', 'jennifer', 'james', 'linda', 'richard', 'patricia', 'thomas',
	'mary', 'charles', 'barbara', 'daniel', 'nancy', 'matthew', 'karen',
	'anthony', 'lisa', 'mark', 'betty', 'donald', 'helen', 'steven', 'sandra',
	'paul', 'donna', 'andrew', 'carol', 'joshua', 'ruth', 'kenneth', 'sharon',
	'kevin', 'michelle', 'brian', 'laura', 'george', 'sarah', 'edward', 'kimberly',
	'ronald', 'deborah', 'timothy', 'jessica', 'jason', 'shirley', 'jeffrey',
	'cynthia', 'ryan', 'angela', 'jacob', 'melissa', 'gary', 'brenda'
];

const lastNames = [
	'smith', 'johnson', 'williams', 'brown', 'jones', 'garcia', 'miller', 'davis',
	'rodriguez', 'martinez', 'hernandez', 'lopez', 'gonzalez', 'wilson', 'anderson',
	'thomas', 'taylor', 'moore', 'jackson', 'martin', 'lee', 'perez', 'thompson',
	'white', 'harris', 'sanchez', 'clark', 'ramirez', 'lewis', 'robinson', 'walker',
	'young', 'allen', 'king', 'wright', 'scott', 'torres', 'nguyen', 'hill', 'flores'
];

// Common words used in emails
const commonWords = [
	'user', 'test', 'admin', 'info', 'contact', 'support', 'hello', 'mail',
	'account', 'service', 'team', 'help', 'demo', 'trial', 'temp', 'guest',
	'member', 'customer', 'client', 'partner', 'sales', 'marketing', 'dev'
];

// Keyboard walk patterns
const keyboardWalks = [
	'qwerty', 'asdfgh', 'zxcvbn', 'qazwsx', 'wsxedc', 'rfvtgb',
	'123456', '234567', '345678', 'abcdef', 'fedcba'
];

// Generate random string (gibberish)
function generateGibberish(length = 8) {
	const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
	let result = '';
	for (let i = 0; i < length; i++) {
		result += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return result;
}

// Get random item from array
function random(arr) {
	return arr[Math.floor(Math.random() * arr.length)];
}

// Generate sequential pattern
function generateSequential(count = 10) {
	const emails = [];
	const base = random(commonWords);
	const domain = random(legitimateDomains);

	for (let i = 1; i <= count; i++) {
		emails.push({
			email: `${base}${i}@${domain}`,
			pattern: 'sequential',
			base: base,
			domain: domain,
		});
	}

	return emails;
}

// Generate sequential with padding
function generateSequentialPadded(count = 10) {
	const emails = [];
	const base = random(commonWords);
	const domain = random(legitimateDomains);

	for (let i = 1; i <= count; i++) {
		const padded = String(i).padStart(3, '0');
		emails.push({
			email: `${base}${padded}@${domain}`,
			pattern: 'sequential_padded',
			base: base,
			domain: domain,
		});
	}

	return emails;
}

// Generate dated patterns
function generateDated(count = 10) {
	const emails = [];
	const year = new Date().getFullYear();
	const firstName = random(firstNames);
	const lastName = random(lastNames);
	const domain = random(legitimateDomains);

	for (let i = 0; i < count; i++) {
		const variants = [
			`${firstName}.${year}@${domain}`,
			`${lastName}.${year}@${domain}`,
			`${firstName}.${lastName}.${year}@${domain}`,
			`${firstName}_${year}@${domain}`,
			`${firstName}${year}@${domain}`,
			`${year}.${firstName}@${domain}`,
		];

		emails.push({
			email: random(variants),
			pattern: 'dated',
			year: year,
			domain: domain,
		});
	}

	return emails;
}

// Generate plus-addressing abuse
function generatePlusAddressing(count = 10) {
	const emails = [];
	const base = random(commonWords);
	const domain = random(['gmail.com', 'yahoo.com', 'outlook.com']);

	for (let i = 1; i <= count; i++) {
		emails.push({
			email: `${base}+${i}@${domain}`,
			pattern: 'plus_addressing',
			base: base,
			domain: domain,
		});
	}

	return emails;
}

// Generate plus-addressing with tags
function generatePlusAddressingTags(count = 10) {
	const emails = [];
	const firstName = random(firstNames);
	const lastName = random(lastNames);
	const domain = random(['gmail.com', 'yahoo.com', 'outlook.com']);
	const tags = ['spam', 'test', 'temp', 'trial', 'promo', 'newsletter', 'signup'];

	for (let i = 0; i < count; i++) {
		const tag = `${random(tags)}${i}`;
		emails.push({
			email: `${firstName}.${lastName}+${tag}@${domain}`,
			pattern: 'plus_addressing_tags',
			domain: domain,
		});
	}

	return emails;
}

// Generate keyboard walks
function generateKeyboardWalks(count = 10) {
	const emails = [];
	const domain = random(legitimateDomains);

	for (let i = 0; i < count; i++) {
		const walk = random(keyboardWalks);
		const variant = Math.random() > 0.5 ? walk : walk + Math.floor(Math.random() * 100);

		emails.push({
			email: `${variant}@${domain}`,
			pattern: 'keyboard_walk',
			walk: walk,
			domain: domain,
		});
	}

	return emails;
}

// Generate gibberish emails
function generateGibberishEmails(count = 10) {
	const emails = [];
	const domain = random(legitimateDomains);

	for (let i = 0; i < count; i++) {
		const gibberish = generateGibberish(8 + Math.floor(Math.random() * 8));
		emails.push({
			email: `${gibberish}@${domain}`,
			pattern: 'gibberish',
			domain: domain,
		});
	}

	return emails;
}

// Generate combination patterns (multiple fraud indicators)
function generateCombinationPatterns(count = 10) {
	const emails = [];

	for (let i = 0; i < count; i++) {
		const domain = random(legitimateDomains);
		const year = new Date().getFullYear();

		// Combine sequential + dated
		if (i % 3 === 0) {
			emails.push({
				email: `user${i}.${year}@${domain}`,
				pattern: 'sequential_dated',
				domain: domain,
			});
		}
		// Combine gibberish + sequential
		else if (i % 3 === 1) {
			emails.push({
				email: `${generateGibberish(6)}${i}@${domain}`,
				pattern: 'gibberish_sequential',
				domain: domain,
			});
		}
		// Combine keyboard walk + dated
		else {
			emails.push({
				email: `${random(keyboardWalks)}${year}@${domain}`,
				pattern: 'keyboard_dated',
				domain: domain,
			});
		}
	}

	return emails;
}

// Generate name-based sequential (looks legitimate but sequential)
function generateNameSequential(count = 10) {
	const emails = [];
	const firstName = random(firstNames);
	const domain = random(legitimateDomains);

	for (let i = 1; i <= count; i++) {
		const lastNameVariant = random(lastNames);
		emails.push({
			email: `${firstName}.${lastNameVariant}${i}@${domain}`,
			pattern: 'name_sequential',
			domain: domain,
		});
	}

	return emails;
}

// Generate underscore/dot variations (common bot pattern)
function generateVariations(count = 10) {
	const emails = [];
	const word = random(commonWords);
	const domain = random(legitimateDomains);

	for (let i = 1; i <= count; i++) {
		const variants = [
			`${word}_${i}@${domain}`,
			`${word}.${i}@${domain}`,
			`${word}-${i}@${domain}`,
			`${word}${i}_test@${domain}`,
			`${i}_${word}@${domain}`,
		];

		emails.push({
			email: random(variants),
			pattern: 'variations',
			domain: domain,
		});
	}

	return emails;
}

// Generate letter sequential (user_a, user_b, user_c)
function generateLetterSequential(count = 10) {
	const emails = [];
	const base = random(commonWords);
	const domain = random(legitimateDomains);
	const letters = 'abcdefghijklmnopqrstuvwxyz';

	for (let i = 0; i < Math.min(count, 26); i++) {
		emails.push({
			email: `${base}_${letters[i]}@${domain}`,
			pattern: 'letter_sequential',
			domain: domain,
		});
	}

	return emails;
}

// Main generator
function generateFraudulentEmails(totalCount = 100) {
	const allEmails = [];

	// Calculate distribution
	const perPattern = Math.floor(totalCount / 10);

	console.log(`🎯 Generating ${totalCount} fraudulent emails with legitimate domains...\n`);

	// Generate each pattern type
	allEmails.push(...generateSequential(perPattern));
	allEmails.push(...generateSequentialPadded(perPattern));
	allEmails.push(...generateDated(perPattern));
	allEmails.push(...generatePlusAddressing(perPattern));
	allEmails.push(...generatePlusAddressingTags(perPattern));
	allEmails.push(...generateKeyboardWalks(perPattern));
	allEmails.push(...generateGibberishEmails(perPattern));
	allEmails.push(...generateCombinationPatterns(perPattern));
	allEmails.push(...generateNameSequential(perPattern));
	allEmails.push(...generateVariations(perPattern));
	allEmails.push(...generateLetterSequential(perPattern));

	// Shuffle to mix patterns
	for (let i = allEmails.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[allEmails[i], allEmails[j]] = [allEmails[j], allEmails[i]];
	}

	return allEmails.slice(0, totalCount);
}

// Export as JSON
function exportAsJSON(emails, filename = '../data/fraudulent-emails.json') {
	const fs = require('fs');
	fs.writeFileSync(filename, JSON.stringify(emails, null, 2));
	console.log(`✅ Exported ${emails.length} emails to ${filename}`);
}

// Export as CSV
function exportAsCSV(emails, filename = '../data/fraudulent-emails.csv') {
	const fs = require('fs');
	const header = 'email,pattern,domain,consumer,flow\n';
	const rows = emails.map(e => {
		const consumer = random(['OWF', 'PORTAL', 'API', 'MOBILE', 'WEB']);
		const flow = random(['SIGNUP_EMAIL_VERIFY', 'PWDLESS_LOGIN_EMAIL', 'PASSWORD_RESET']);
		return `${e.email},${e.pattern},${e.domain},${consumer},${flow}`;
	}).join('\n');

	fs.writeFileSync(filename, header + rows);
	console.log(`✅ Exported ${emails.length} emails to ${filename}`);
}

// Print statistics
function printStatistics(emails) {
	const patterns = {};
	const domains = {};

	emails.forEach(e => {
		patterns[e.pattern] = (patterns[e.pattern] || 0) + 1;
		domains[e.domain] = (domains[e.domain] || 0) + 1;
	});

	console.log('\n📊 Pattern Distribution:');
	Object.entries(patterns).sort((a, b) => b[1] - a[1]).forEach(([pattern, count]) => {
		console.log(`  ${pattern.padEnd(25)} ${count} (${((count / emails.length) * 100).toFixed(1)}%)`);
	});

	console.log('\n🌐 Domain Distribution:');
	Object.entries(domains).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([domain, count]) => {
		console.log(`  ${domain.padEnd(25)} ${count} (${((count / emails.length) * 100).toFixed(1)}%)`);
	});
}

// Print sample
function printSamples(emails, count = 20) {
	console.log(`\n📧 Sample Emails (${count} of ${emails.length}):`);
	console.log('='.repeat(80));

	emails.slice(0, count).forEach((e, i) => {
		console.log(`${(i + 1).toString().padStart(2)}. ${e.email.padEnd(40)} [${e.pattern}]`);
	});

	console.log('='.repeat(80));
}

// CLI
const count = parseInt(process.argv[2]) || 100;
const emails = generateFraudulentEmails(count);

printSamples(emails, 20);
printStatistics(emails);

// Export files
exportAsJSON(emails);
exportAsCSV(emails);

console.log(`\n✨ Generation complete! Use these files to test your detection system.`);
console.log(`\n💡 To test with API:`);
console.log(`   1. Start dev server: npm run dev`);
console.log(`   2. Use test-fraudulent-emails.js to validate all generated emails\n`);
