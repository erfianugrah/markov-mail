/**
 * Test Email Generator
 * Generate fraudulent email patterns for testing
 *
 * DEPRECATED (v2.2.0): 'gibberish' and 'keyboard_walk' pattern types are deprecated.
 * These patterns are now detected by Markov Chain analysis.
 * Pattern types kept for backwards compatibility with existing tests.
 */

export type PatternType =
	| 'sequential'
	| 'sequential_padded'
	| 'dated'
	| 'gibberish'          // DEPRECATED: Use Markov detection
	| 'keyboard_walk'      // DEPRECATED: Use Markov detection
	| 'plus_addressing'
	| 'name_sequential'
	| 'random_suffix'
	| 'underscore_sequential'
	| 'simple'
	| 'dictionary_numbers';

export interface GeneratedEmail {
	email: string;
	pattern: PatternType;
	expectedRisk: 'high' | 'medium' | 'low';
	notes?: string;
}

export interface EmailGeneratorOptions {
	count: number;
	patterns?: PatternType[];
	domains?: string[];
}

const DEFAULT_DOMAINS = [
	'gmail.com',
	'yahoo.com',
	'outlook.com',
	'hotmail.com',
	'example.com',
	'test.com',
	'company.com',
	'business.com',
];

const FIRST_NAMES = ['john', 'jane', 'mike', 'sarah', 'david', 'emma', 'alex', 'lisa'];
const LAST_NAMES = ['smith', 'johnson', 'williams', 'brown', 'jones', 'garcia', 'miller', 'davis'];
const DICTIONARY_WORDS = ['apple', 'banana', 'cherry', 'dragon', 'eagle', 'falcon', 'grape', 'hawk'];

export class EmailGenerator {
	private domains: string[];

	constructor(domains?: string[]) {
		this.domains = domains || DEFAULT_DOMAINS;
	}

	/**
	 * Generate a batch of fraudulent emails
	 */
	generate(options: EmailGeneratorOptions): GeneratedEmail[] {
		const emails: GeneratedEmail[] = [];
		const patterns = options.patterns || this.getAllPatterns();
		const countsPerPattern = Math.ceil(options.count / patterns.length);

		for (const pattern of patterns) {
			for (let i = 0; i < countsPerPattern && emails.length < options.count; i++) {
				const email = this.generateByPattern(pattern, i);
				emails.push(email);
			}
		}

		// Shuffle to randomize order
		return this.shuffle(emails).slice(0, options.count);
	}

	/**
	 * Generate email by specific pattern
	 */
	private generateByPattern(pattern: PatternType, index: number): GeneratedEmail {
		const domain = this.randomDomain();

		switch (pattern) {
			case 'sequential':
				return {
					email: `user${index + 1}@${domain}`,
					pattern,
					expectedRisk: 'high',
					notes: 'Sequential numbering pattern',
				};

			case 'sequential_padded':
				return {
					email: `test${String(index + 1).padStart(3, '0')}@${domain}`,
					pattern,
					expectedRisk: 'high',
					notes: 'Sequential with zero padding',
				};

			case 'dated':
				const year = 2020 + (index % 5);
				const firstName = this.randomFrom(FIRST_NAMES);
				const lastName = this.randomFrom(LAST_NAMES);
				return {
					email: `${firstName}.${lastName}.${year}@${domain}`,
					pattern,
					expectedRisk: 'high',
					notes: 'Email with year suffix',
				};

			case 'gibberish':
				return {
					email: `${this.randomGibberish(8 + (index % 4))}@${domain}`,
					pattern,
					expectedRisk: 'high',
					notes: 'Random gibberish string',
				};

			case 'keyboard_walk':
				const walks = ['qwerty', 'asdfgh', '123456', 'zxcvbn', 'qazwsx', 'wsxedc'];
				const walk = walks[index % walks.length];
				return {
					email: `${walk}${index}@${domain}`,
					pattern,
					expectedRisk: 'high',
					notes: 'Keyboard walk pattern',
				};

			case 'plus_addressing':
				const base = this.randomFrom(FIRST_NAMES);
				const suffix = ['spam', 'test', 'temp', 'promo'][index % 4];
				return {
					email: `${base}+${suffix}${index}@${domain}`,
					pattern,
					expectedRisk: 'medium',
					notes: 'Plus addressing abuse',
				};

			case 'name_sequential':
				const fn = this.randomFrom(FIRST_NAMES);
				const ln = this.randomFrom(LAST_NAMES);
				return {
					email: `${fn}.${ln}${index + 1}@${domain}`,
					pattern,
					expectedRisk: 'medium',
					notes: 'Name with sequential number',
				};

			case 'random_suffix':
				const name = this.randomFrom(FIRST_NAMES);
				const randomNum = Math.floor(100000 + Math.random() * 900000);
				return {
					email: `${name}_${randomNum}@${domain}`,
					pattern,
					expectedRisk: 'medium',
					notes: 'Random number suffix',
				};

			case 'underscore_sequential':
				return {
					email: `user_${index + 1}@${domain}`,
					pattern,
					expectedRisk: 'high',
					notes: 'Underscore with sequential',
				};

			case 'simple':
				const simpleNames = ['test', 'admin', 'user', 'demo', 'temp'];
				return {
					email: `${simpleNames[index % simpleNames.length]}@${domain}`,
					pattern,
					expectedRisk: 'medium',
					notes: 'Simple common name',
				};

			case 'dictionary_numbers':
				const word = this.randomFrom(DICTIONARY_WORDS);
				const num = (index + 1) * 111;
				return {
					email: `${word}${num}@${domain}`,
					pattern,
					expectedRisk: 'medium',
					notes: 'Dictionary word with numbers',
				};

			default:
				return {
					email: `user${index}@${domain}`,
					pattern: 'sequential',
					expectedRisk: 'high',
				};
		}
	}

	/**
	 * Generate random gibberish string
	 */
	private randomGibberish(length: number): string {
		const consonants = 'bcdfghjklmnpqrstvwxz';
		const vowels = 'aeiou';
		let result = '';

		for (let i = 0; i < length; i++) {
			if (i % 2 === 0) {
				result += consonants.charAt(Math.floor(Math.random() * consonants.length));
			} else {
				result += vowels.charAt(Math.floor(Math.random() * vowels.length));
			}
		}

		return result;
	}

	/**
	 * Get all available patterns
	 */
	private getAllPatterns(): PatternType[] {
		return [
			'sequential',
			'sequential_padded',
			'dated',
			'gibberish',
			'keyboard_walk',
			'plus_addressing',
			'name_sequential',
			'random_suffix',
			'underscore_sequential',
			'simple',
			'dictionary_numbers',
		];
	}

	/**
	 * Get random element from array
	 */
	private randomFrom<T>(array: T[]): T {
		return array[Math.floor(Math.random() * array.length)];
	}

	/**
	 * Get random domain
	 */
	private randomDomain(): string {
		return this.randomFrom(this.domains);
	}

	/**
	 * Shuffle array (Fisher-Yates)
	 */
	private shuffle<T>(array: T[]): T[] {
		const shuffled = [...array];
		for (let i = shuffled.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
		}
		return shuffled;
	}
}

/**
 * Analyze generated emails
 */
export interface EmailAnalysis {
	totalEmails: number;
	patternDistribution: Record<PatternType, number>;
	domainDistribution: Record<string, number>;
	riskDistribution: {
		high: number;
		medium: number;
		low: number;
	};
}

export function analyzeGeneratedEmails(emails: GeneratedEmail[]): EmailAnalysis {
	const patternDist: Record<string, number> = {};
	const domainDist: Record<string, number> = {};
	const riskDist = { high: 0, medium: 0, low: 0 };

	emails.forEach((email) => {
		// Pattern distribution
		patternDist[email.pattern] = (patternDist[email.pattern] || 0) + 1;

		// Domain distribution
		const domain = email.email.split('@')[1];
		domainDist[domain] = (domainDist[domain] || 0) + 1;

		// Risk distribution
		riskDist[email.expectedRisk]++;
	});

	return {
		totalEmails: emails.length,
		patternDistribution: patternDist as Record<PatternType, number>,
		domainDistribution: domainDist,
		riskDistribution: riskDist,
	};
}
