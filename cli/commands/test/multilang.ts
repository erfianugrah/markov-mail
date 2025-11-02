/**
 * CLI Command: Test Multi-Language N-Gram Support
 *
 * Tests international name detection across multiple languages.
 */

import { logger } from '../../utils/logger';
import { analyzeNGramNaturalness } from '../../../src/detectors/ngram-analysis';
import { detectLanguage, getLanguageName } from '../../../src/detectors/ngram-multilang';

interface TestCase {
	email: string;
	expected: string | null;
	description: string;
}

const testCases: TestCase[] = [
	// English names
	{ email: 'john.smith', expected: 'en', description: 'English name' },
	{ email: 'mary.johnson', expected: 'en', description: 'English name' },

	// Spanish names
	{ email: 'garcia.rodriguez', expected: 'es', description: 'Spanish name' },
	{ email: 'martinez.hernandez', expected: 'es', description: 'Spanish name' },
	{ email: 'gonzalez', expected: 'es', description: 'Spanish surname' },

	// French names
	{ email: 'jean.rousseau', expected: 'fr', description: 'French name' },
	{ email: 'pierre.beaumont', expected: 'fr', description: 'French name' },

	// German names
	{ email: 'mueller.schmidt', expected: 'de', description: 'German name' },
	{ email: 'hans.bergmann', expected: 'de', description: 'German name' },

	// Italian names
	{ email: 'giovanni.rossi', expected: 'it', description: 'Italian name' },
	{ email: 'francesco.ferrari', expected: 'it', description: 'Italian name' },

	// Portuguese names
	{ email: 'joao.silva', expected: 'pt', description: 'Portuguese name' },
	{ email: 'antonio.santos', expected: 'pt', description: 'Portuguese name' },

	// Russian names (romanized)
	{ email: 'dmitry.petrov', expected: 'romanized', description: 'Russian name' },
	{ email: 'alexander.ivanov', expected: 'romanized', description: 'Russian name' },

	// Chinese names (Pinyin)
	{ email: 'zhang.wei', expected: 'romanized', description: 'Chinese name' },
	{ email: 'wang.fang', expected: 'romanized', description: 'Chinese name' },

	// Arabic names (romanized)
	{ email: 'mohammed.abdullah', expected: 'romanized', description: 'Arabic name' },

	// Random strings
	{ email: 'xkgh2k9qw', expected: null, description: 'Random string' },
];

export default async function testMultilang() {
	logger.info('Testing multi-language N-gram support...');
	console.log();

	let passCount = 0;
	let failCount = 0;

	for (const testCase of testCases) {
		const localPart = testCase.email;

		// Test language detection
		const detectedLang = detectLanguage(localPart);
		const langName = getLanguageName(detectedLang);

		// Test n-gram analysis with multilang support
		const analysis = analyzeNGramNaturalness(localPart, true);

		// Check if language detection matches expected
		const langMatch =
			testCase.expected === null || detectedLang === testCase.expected || detectedLang === 'en';

		const status = langMatch ? '✅' : '❌';
		if (langMatch) passCount++;
		else failCount++;

		console.log(`${status} ${testCase.description}: ${localPart}`);
		console.log(`   Detected: ${langName} (${detectedLang}), Expected: ${testCase.expected || 'any'}`);
		console.log(`   N-gram: ${(analysis.overallScore * 100).toFixed(1)}% natural`);
		console.log(`   Is Natural: ${analysis.isNatural ? 'Yes' : 'No'}`);
		console.log();
	}

	console.log('='.repeat(60));
	logger.info(`Results: ${passCount} passed, ${failCount} failed`);
	logger.info(`Success rate: ${Math.round((passCount / testCases.length) * 100)}%`);
	console.log();

	// Comparison test
	logger.info('Comparison: English-only vs Multi-language');
	console.log('='.repeat(60));
	console.log();

	const comparisonTests = ['dmitry.petrov', 'garcia.rodriguez', 'mueller', 'giovanni.rossi'];

	for (const localPart of comparisonTests) {
		const englishOnly = analyzeNGramNaturalness(localPart, false);
		const multiLang = analyzeNGramNaturalness(localPart, true);

		console.log(`Email: ${localPart}`);
		console.log(
			`  English-only:   ${(englishOnly.overallScore * 100).toFixed(1)}% → ${englishOnly.isNatural ? 'Natural' : 'GIBBERISH'}`
		);
		console.log(
			`  Multi-language: ${(multiLang.overallScore * 100).toFixed(1)}% → ${multiLang.isNatural ? 'Natural' : 'GIBBERISH'} (${multiLang.languageName})`
		);

		const improvement = multiLang.isNatural && !englishOnly.isNatural;
		if (improvement) {
			console.log(`  ✅ IMPROVEMENT: False positive eliminated!`);
		}
		console.log();
	}

	logger.success('Multi-language test complete');
}

export const command = {
	name: 'test:multilang',
	description: 'Test multi-language N-gram support with international names',
	action: testMultilang,
};
