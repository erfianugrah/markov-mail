/**
 * Multi-Language N-Gram Support (Priority 2 Improvement)
 *
 * Extends N-gram analysis to support international names and reduce false positives.
 *
 * Supported Languages:
 * - English (existing)
 * - Spanish
 * - French
 * - German
 * - Italian
 * - Portuguese
 * - Romanized (Russian, Chinese, Japanese, Arabic transliterations)
 *
 * Expected Impact: +3-5% accuracy, significant reduction in international name false positives
 */

export type Language =
	| 'en' // English
	| 'es' // Spanish
	| 'fr' // French
	| 'de' // German
	| 'it' // Italian
	| 'pt' // Portuguese
	| 'romanized' // Romanized non-Latin scripts
	| 'universal'; // Universal/mixed

/**
 * Language-specific n-gram sets
 * Compiled from linguistic frequency analysis and name corpora
 */
export const LANGUAGE_BIGRAMS: Record<Language, Set<string>> = {
	// English bigrams (existing)
	en: new Set([
		'an', 'ar', 'er', 'in', 'on', 'or', 'en', 'at', 'ed', 'es',
		'ha', 'he', 'hi', 'is', 'it', 'le', 'me', 'nd', 'ne', 'ng',
		'nt', 'ou', 're', 'se', 'st', 'te', 'th', 'to', 've', 'wa',
		'al', 'as', 'be', 'ca', 'ch', 'co', 'de', 'di', 'do', 'ea',
		'el', 'et', 'fo', 'ge', 'ho', 'ia', 'ic', 'id', 'ie', 'il',
		'io', 'ke', 'la', 'li', 'lo', 'ly', 'ma', 'mi', 'mo', 'na',
		'no', 'ny', 'of', 'ol', 'om', 'oo', 'op', 'os', 'ot', 'ow',
		'pa', 'pe', 'po', 'pr', 'ra', 'ri', 'ro', 'ry', 'sa', 'sh',
		'si', 'so', 'ta', 'ti', 'tr', 'ty', 'ur', 'us', 'ut', 'we',
		'll', 'ss', 'tt', 'ff', 'pp', 'mm', 'nn', 'cc', 'dd', 'gg',
	]),

	// Spanish bigrams (common in Spanish names)
	es: new Set([
		// Spanish-specific patterns
		'ez', 'ia', 'io', 'os', 'as', 'es', 'is', 'en', 'on', 'an',
		'ar', 'er', 'or', 'al', 'el', 'il', 'ol', 'ul', 'az', 'iz',
		// Common Spanish name patterns (ASCII only; ñ/ío/ía stripped by [^a-z] filter)
		'gu', 'qu', 'ch', 'rr', 'll', 'ci', 'ce', 'gi', 'ge',
		'ue', 'ie', 'ua', 'ja', 'jo', 'ju', 'za', 'zo',
		// Shared Latin patterns
		'na', 'no', 'ma', 'mo', 'la', 'lo', 'ra', 'ro', 'sa', 'so',
		'ta', 'to', 'da', 'do', 'ca', 'co', 'ba', 'bo', 'pa', 'po',
		'nd', 'nt', 'rt', 'rd', 'rc', 'rm', 'rn', 'rs', 'nc', 'nz',
	]),

	// French bigrams (common in French names)
	fr: new Set([
		// French-specific patterns
		'au', 'ou', 'eu', 'oi', 'ai', 'ei', 'ui', 'ue',
		// Nasals and liquids
		'on', 'an', 'en', 'in', 'un', 'om', 'am', 'em', 'im',
		// Common consonant clusters
		'ch', 'ph', 'th', 'qu', 'gn', 'il',
		// Common name endings
		'ot', 'et', 'at', 'ut', 'it', 'el', 'al', 'ol', 'ul',
		// Shared patterns
		'le', 'la', 're', 'ra', 'te', 'ta', 'de', 'da', 'ne', 'na',
		'me', 'ma', 'se', 'sa', 'ce', 'ca', 'pe', 'pa', 'be', 'ba',
		'er', 'ar', 'or', 'ir', 'ur', 'es', 'as', 'os', 'is', 'us',
	]),

	// German bigrams (common in German names)
	de: new Set([
		// German-specific patterns
		'ch', 'ck', 'tz', 'pf', 'ng', 'nk', 'ig',
		// Umlauts (romanized; ß and äu stripped by [^a-z] filter)
		'ae', 'oe', 'ue', 'ss',
		// Common vowel patterns (ASCII only)
		'ei', 'ie', 'eu', 'au', 'ai', 'ui', 'oi',
		// Common consonant clusters
		'st', 'sp', 'sk', 'kr', 'gr', 'br', 'fr',
		'tr', 'dr', 'pr', 'kl', 'gl', 'bl', 'fl', 'pl', 'wr', 'zw',
		// Common name patterns
		'er', 'en', 'el', 'em', 'es', 'et',
		// Shared patterns
		'an', 'in', 'on', 'un', 'ar', 'ir', 'or', 'ur', 'nd', 'nt', 'rt',
	]),

	// Italian bigrams (common in Italian names)
	it: new Set([
		// Italian-specific patterns
		'gn', 'sc', 'zz', 'tt', 'll', 'rr', 'cc', 'gg',
		// Common vowel patterns (Italian loves vowels!)
		'io', 'ia', 'ie', 'ii', 'uo', 'ua', 'ue', 'ui', 'ao', 'ai', 'ae',
		'eo', 'ea', 'ee', 'ei', 'oo', 'oa', 'oe', 'oi',
		// Common consonant-vowel
		'ca', 'co', 'cu', 'ga', 'go', 'gu',
		'ci', 'ce', 'gi', 'ge', 'si', 'se', 'sa', 'so', 'su',
		// Name endings
		'no', 'na', 'ni', 'ne', 'ro', 'ra', 'ri', 're', 'to', 'ta', 'ti', 'te',
		// Shared patterns
		'an', 'en', 'in', 'on', 'un', 'ar', 'er', 'ir', 'or', 'ur',
		'al', 'el', 'il', 'ol', 'ul', 'as', 'es', 'is', 'os', 'us',
	]),

	// Portuguese bigrams (common in Portuguese names)
	// NOTE: Unicode accented forms (ão, õe, etc.) are stripped by the [^a-z] filter
	// in extractNGrams, so only their ASCII equivalents are included here.
	pt: new Set([
		// Portuguese-specific patterns (ASCII romanized)
		'nh', 'lh', 'ch', 'gu', 'qu',
		// Romanized versions of accented patterns
		'ao', 'oe', 'ae', 'eo', 'io', 'ui', 'ei', 'ai', 'au', 'ou',
		// Nasals
		'an', 'en', 'in', 'on', 'un', 'am', 'em', 'im', 'om', 'um',
		// Common patterns
		'es', 'as', 'os', 'is', 'us', 'ez', 'az', 'iz', 'oz', 'uz',
		'ar', 'er', 'ir', 'or', 'ur', 'al', 'el', 'il', 'ol', 'ul',
		// Name patterns
		'va', 've', 'vi', 'vo', 'vu', 'za', 'ze', 'zi', 'zo', 'zu',
		'ca', 'co', 'cu', 'ce', 'ci', 'ga', 'go', 'gu', 'ge', 'gi',
		// Shared patterns
		'na', 'ne', 'ni', 'no', 'nu', 'ma', 'me', 'mi', 'mo', 'mu',
		'ra', 're', 'ri', 'ro', 'ru', 'sa', 'se', 'si', 'so', 'su',
	]),

	// Romanized patterns (Russian, Chinese, Japanese, Arabic, Korean, Southeast Asian, South Asian)
	// NOTE: Only 2-character entries belong here; longer patterns are in LANGUAGE_TRIGRAMS.
	romanized: new Set([
		// Russian romanization patterns
		'ov', 'ev', 'sh', 'zh', 'kh', 'ts', 'ch', 'ya', 'yu', 'ye', 'yo', 'ii', 'yy',
		// Chinese Pinyin patterns
		'qi', 'xi', 'zi', 'ci', 'si', 'ri', 'an', 'en', 'in', 'un',
		'ai', 'ei', 'ui', 'ao', 'ou', 'iu', 'ie', 'ue', 'er',
		// Japanese Romaji patterns
		'ka', 'ki', 'ku', 'ke', 'ko', 'sa', 'su', 'se', 'so',
		'ta', 'te', 'to', 'na', 'ni', 'nu', 'ne', 'no',
		'ha', 'hi', 'fu', 'he', 'ho', 'ma', 'mi', 'mu', 'me', 'mo',
		'ya', 'yu', 'yo', 'ra', 'ri', 'ru', 're', 'ro', 'wa', 'wo',
		'ga', 'gi', 'gu', 'ge', 'go', 'za', 'ji', 'zu', 'ze', 'zo',
		'da', 'de', 'do', 'ba', 'bi', 'bu', 'be', 'bo', 'pa', 'pi',
		'pu', 'pe', 'po',
		// Korean romanization
		'eo', 'ae', 'oe', 'ui', 'gw', 'kw', 'hw', 'ng', 'nk', 'nh',
		// Arabic transliteration patterns
		'al', 'el', 'il', 'ul', 'ah', 'eh', 'ih', 'uh', 'kh', 'gh', 'dh', 'th',
		// Indonesian/Malay patterns
		'ug',
		// Vietnamese patterns
		'nh', 'ph', 'gi', 'tr', 'qu', 'uy', 'oa', 'oi',
	]),

	// Universal patterns (common across all languages)
	// NOTE: Only 2-character entries; single chars can never match bigram windows.
	universal: new Set([
		'an', 'en', 'in', 'on', 'un', 'ar', 'er', 'ir', 'or', 'ur',
		'al', 'el', 'il', 'ol', 'ul', 'as', 'es', 'is', 'os', 'us',
		'na', 'ne', 'ni', 'no', 'nu', 'ma', 'me', 'mi', 'mo', 'mu',
		'ra', 're', 'ri', 'ro', 'ru', 'sa', 'se', 'si', 'so', 'su',
		'ta', 'te', 'ti', 'to', 'tu', 'la', 'le', 'li', 'lo', 'lu',
	]),
};

/**
 * Language-specific trigrams
 */
export const LANGUAGE_TRIGRAMS: Record<Language, Set<string>> = {
	en: new Set([
		'the', 'and', 'ing', 'ion', 'tio', 'ent', 'for', 'her', 'ter', 'res',
		'ate', 'ver', 'all', 'wit', 'are', 'est', 'ste', 'ati', 'tur', 'int',
		'son', 'sen', 'man', 'ton', 'ley', 'lyn', 'ann', 'een', 'ine', 'ell',
	]),
	es: new Set([
		'cia', 'ion', 'ado', 'ida', 'ido', 'ero', 'era', 'oso', 'osa', 'and',
		'ent', 'ant', 'est', 'ist', 'ort', 'art', 'der', 'del', 'los', 'las',
		'nez', 'lez', 'rez', 'dez', 'vez', 'gue', 'que', 'qui', 'cia', 'cio',
	]),
	fr: new Set([
		'ion', 'ent', 'ait', 'ais', 'ant', 'eur', 'eau', 'aux', 'oux', 'eux',
		'que', 'qui', 'ois', 'ons', 'ont', 'int',
		'ier', 'oir', 'eil', 'ill',
	]),
	de: new Set([
		'sch', 'ich', 'ein', 'und', 'ung', 'eit', 'cht', 'ber', 'ste',
		'ter', 'der', 'den', 'man', 'ann', 'ern', 'ert', 'ers', 'ens', 'elt',
		'eld', 'str', 'erg', 'eld',
	]),
	it: new Set([
		'ett', 'ino', 'ina', 'oni', 'ano', 'ane', 'ato',
		'ata', 'ito', 'ita', 'uti', 'ute', 'ali', 'ale', 'ell', 'lla', 'llo',
		'cci', 'ggi', 'ghi', 'chi', 'zza', 'zze', 'zzi', 'zzo', 'gli',
	]),
	pt: new Set([
		'cao', 'sao', 'oes', 'aes', 'ios', 'ias', 'dos', 'das', 'nte', 'nde',
		'ado', 'ida', 'ido', 'oso', 'osa', 'eir', 'inh', 'nho', 'nha',
		'vez', 'lez', 'rez', 'dez', 'nez', 'lho', 'lha',
	]),
	// NOTE: Only 3-character entries belong here. Longer patterns (ovich, enko,
	// ullah, kumar, etc.) are handled by the language detection regex, not n-gram matching.
	romanized: new Set([
		// Russian romanization (3-char fragments of common suffixes)
		'ski', 'sky', 'ova', 'eva', 'yan', 'ian', 'ovi', 'vic', 'ich',
		'nko', 'enk', 'ska', 'vna', 'yev',
		// Chinese Pinyin
		'shi', 'chi', 'zhi', 'ang', 'eng', 'ing', 'ong', 'ung',
		'ian', 'iao', 'uai', 'uan',
		// Japanese Romaji
		'ama', 'aka', 'ima', 'ika', 'uma', 'uka', 'oya', 'oki',
		'ura', 'awa', 'ata', 'asa', 'ari', 'ani', 'umi', 'ino',
		// Korean
		'kim', 'ang', 'ung', 'oon', 'hin', 'hoi',
		// Arabic (3-char fragments)
		'abd', 'abu', 'ibn', 'bin', 'ahm', 'med', 'hma', 'man',
		// Southeast Asian
		'wan', 'adi', 'sri', 'utr', 'tra', 'put',
		// South Asian
		'raj', 'mar', 'uma', 'esh', 'ish', 'dha', 'bha', 'sha',
	]),
	universal: new Set([
		'ana', 'ane', 'ani', 'ano', 'anu', 'ena', 'ene', 'eni', 'eno', 'enu',
		'ina', 'ine', 'ini', 'ino', 'inu', 'ona', 'one', 'oni', 'ono', 'onu',
		'una', 'une', 'uni', 'uno', 'unu', 'ara', 'are', 'ari', 'aro', 'aru',
	]),
};

/**
 * Detect the likely language of a text based on character patterns
 */
export function detectLanguage(text: string): Language {
	const lower = text.toLowerCase();
	const romanizedPatterns = [
		/(ov|ova|ovich|ev|eva|enko|sky|ski|ashvili|adze|dze)$/i,
		/(ullah|rahman|hossain|hussein)$/i,
		/^(abd|abu|ibn|bin)/i,
		/(putra|putri|wati|wana|wan|budi|sri|dra|tya)$/i,
		/(kumar|singh|raj|deep|esh|ish)$/i,
		/(nguyen|quang|thuy|phuong|trung|trong)$/i,
		/(kim|park|choi|yoon|kang|lee)$/i,
		/(zhang|xiang|sheng|huang|xiao|qian)$/i,
	];

	if (romanizedPatterns.some((pattern) => pattern.test(lower))) {
		return 'romanized';
	}

	const spanishSuffixes = ['ez', 'iz', 'oz', 'az'];
	if (lower.includes('ñ') || spanishSuffixes.some((suffix) => lower.endsWith(suffix))) {
		return 'es';
	}

	const frenchSuffixes = ['eau', 'eaux', 'eux', 'ette', 'elle', 'ille', 'ois', 'oit'];
	if (frenchSuffixes.some((suffix) => lower.endsWith(suffix))) {
		return 'fr';
	}

	const germanPatterns = [
		/(mann|berg|stein|stadt|hardt)$/i,
		/(ae|oe|ue)/i,
		/(sch|tz|pf)/i,
	];
	if (germanPatterns.some((pattern) => pattern.test(lower))) {
		return 'de';
	}

	const italianSuffixes = ['ini', 'lli', 'tti', 'cci', 'gia', 'gio', 'zio', 'zzi', 'azzi', 'etti'];
	if (italianSuffixes.some((suffix) => lower.endsWith(suffix))) {
		return 'it';
	}

	const portuguesePatterns = [
		/(ão|õe|ãe)$/i,
		/(inho|inha|lh|nh)$/i,
		/(cao|sao)$/i,
	];
	if (portuguesePatterns.some((pattern) => pattern.test(lower))) {
		return 'pt';
	}

	// Default to English for ambiguous cases
	return 'en';
}

/**
 * Get combined n-gram set for a language (includes universal patterns)
 */
export function getCombinedBigrams(language: Language): Set<string> {
	const languageSpecific = LANGUAGE_BIGRAMS[language];
	const universal = LANGUAGE_BIGRAMS.universal;

	// Merge language-specific and universal
	return new Set([...languageSpecific, ...universal]);
}

/**
 * Get combined trigram set for a language
 */
export function getCombinedTrigrams(language: Language): Set<string> {
	const languageSpecific = LANGUAGE_TRIGRAMS[language];
	const universal = LANGUAGE_TRIGRAMS.universal;

	return new Set([...languageSpecific, ...universal]);
}

/**
 * Calculate multilingual n-gram score
 */
export function calculateMultilingualScore(
	text: string,
	detectedLanguage?: Language
): {
	language: Language;
	bigramScore: number;
	trigramScore: number;
	overallScore: number;
	isNatural: boolean;
} {
	// Detect language if not provided
	const language = detectedLanguage || detectLanguage(text);

	// Get appropriate n-gram sets
	const bigrams = getCombinedBigrams(language);
	const trigrams = getCombinedTrigrams(language);

	// Extract n-grams from text
	const textBigrams = extractNGrams(text, 2);
	const textTrigrams = extractNGrams(text, 3);

	// Count matches
	const matchedBigrams = textBigrams.filter((bg) => bigrams.has(bg)).length;
	const matchedTrigrams = textTrigrams.filter((tg) => trigrams.has(tg)).length;

	// Calculate scores
	const bigramScore = textBigrams.length > 0 ? matchedBigrams / textBigrams.length : 0;
	const trigramScore = textTrigrams.length > 0 ? matchedTrigrams / textTrigrams.length : 0;

	// Weighted average
	const overallScore = bigramScore * 0.6 + trigramScore * 0.4;

	// Adjusted threshold for non-English languages (more lenient)
	const threshold = language === 'en' ? 0.40 : 0.30;
	const isNatural = overallScore > threshold;

	return {
		language,
		bigramScore,
		trigramScore,
		overallScore,
		isNatural,
	};
}

/**
 * Extract n-grams from text (helper function)
 */
function extractNGrams(text: string, n: number): string[] {
	const ngrams: string[] = [];
	const cleaned = text.toLowerCase().replace(/[^a-z]/g, '');

	for (let i = 0; i <= cleaned.length - n; i++) {
		ngrams.push(cleaned.slice(i, i + n));
	}

	return ngrams;
}

/**
 * Get language name for display
 */
export function getLanguageName(lang: Language): string {
	const names: Record<Language, string> = {
		en: 'English',
		es: 'Spanish',
		fr: 'French',
		de: 'German',
		it: 'Italian',
		pt: 'Portuguese',
		romanized: 'Romanized',
		universal: 'Universal',
	};
	return names[lang];
}
