export interface FeatureVector {
	[key: string]: number;
}

export interface FeatureVectorInput {
	sequentialConfidence?: number;
	plusRisk?: number;
	localPartLength?: number;
	digitRatio?: number;
	nameSimilarityScore?: number;
	nameTokenOverlap?: number;
	nameInEmail?: boolean;
	geoLanguageMismatch?: boolean;
	geoTimezoneMismatch?: boolean;
	geoAnomalyScore?: number;
	mxHasRecords?: boolean;
	mxRecordCount?: number;
	mxProviderGoogle?: boolean;
	mxProviderMicrosoft?: boolean;
	mxProviderIcloud?: boolean;
	mxProviderYahoo?: boolean;
	mxProviderZoho?: boolean;
	mxProviderProton?: boolean;
	mxProviderSelfHosted?: boolean;
	mxProviderOther?: boolean;
	providerIsFree?: boolean;
	providerIsDisposable?: boolean;
	tldRisk?: number;
	domainReputationScore?: number;
	entropyScore?: number;
	linguistic?: {
		pronounceability?: number;
		vowelRatio?: number;
		maxConsonantCluster?: number;
		repeatedCharRatio?: number;
		syllableEstimate?: number;
		impossibleClusterCount?: number;
	};
	structure?: {
		hasWordBoundaries?: boolean;
		segmentCount?: number;
		avgSegmentLength?: number;
		segmentsWithoutVowelsRatio?: number;
	};
	statistical?: {
		uniqueCharRatio?: number;
		vowelGapRatio?: number;
		maxDigitRun?: number;
		bigramEntropy?: number;
	};
	ngram?: {
		bigramScore?: number;
		trigramScore?: number;
		overallScore?: number;
		confidence?: number;
		riskScore?: number;
		isNatural?: boolean;
	};
}

function sanitize(value: number | undefined, fallback = 0, clamp?: { min?: number; max?: number }): number {
	if (value === undefined || Number.isNaN(value) || !Number.isFinite(value)) {
		return fallback;
	}

	let result = value;
	if (clamp?.min !== undefined && result < clamp.min) {
		result = clamp.min;
	}
	if (clamp?.max !== undefined && result > clamp.max) {
		result = clamp.max;
	}
	return result;
}

export function buildFeatureVector(input: FeatureVectorInput): FeatureVector {
	const features: FeatureVector = {
		sequential_confidence: sanitize(input.sequentialConfidence, 0, { min: 0, max: 1 }),
		plus_risk: sanitize(input.plusRisk, 0, { min: 0, max: 1 }),
		local_length: sanitize(input.localPartLength, 0, { min: 0, max: 128 }),
		digit_ratio: sanitize(input.digitRatio, 0, { min: 0, max: 1 }),
		name_similarity_score: sanitize(input.nameSimilarityScore, 0, { min: 0, max: 1 }),
		name_token_overlap: sanitize(input.nameTokenOverlap, 0, { min: 0, max: 1 }),
		name_in_email: input.nameInEmail ? 1 : 0,
		geo_language_mismatch: input.geoLanguageMismatch ? 1 : 0,
		geo_timezone_mismatch: input.geoTimezoneMismatch ? 1 : 0,
		geo_anomaly_score: sanitize(input.geoAnomalyScore, 0, { min: 0, max: 1 }),
		mx_has_records: input.mxHasRecords ? 1 : 0,
		mx_record_count: sanitize(input.mxRecordCount, 0, { min: 0, max: 32 }),
		mx_provider_google: input.mxProviderGoogle ? 1 : 0,
		mx_provider_microsoft: input.mxProviderMicrosoft ? 1 : 0,
		mx_provider_icloud: input.mxProviderIcloud ? 1 : 0,
		mx_provider_yahoo: input.mxProviderYahoo ? 1 : 0,
		mx_provider_zoho: input.mxProviderZoho ? 1 : 0,
		mx_provider_proton: input.mxProviderProton ? 1 : 0,
		mx_provider_self_hosted: input.mxProviderSelfHosted ? 1 : 0,
		mx_provider_other: input.mxProviderOther ? 1 : 0,
		provider_is_free: input.providerIsFree ? 1 : 0,
		provider_is_disposable: input.providerIsDisposable ? 1 : 0,
		tld_risk_score: sanitize(input.tldRisk, 0, { min: 0, max: 1 }),
		domain_reputation_score: sanitize(input.domainReputationScore, 0, { min: 0, max: 1 }),
		entropy_score: sanitize(input.entropyScore, 0, { min: 0, max: 16 }),
	};

	if (input.linguistic) {
		features.pronounceability = sanitize(input.linguistic.pronounceability, 0, { min: 0, max: 1 });
		features.vowel_ratio = sanitize(input.linguistic.vowelRatio, 0, { min: 0, max: 1 });
		features.max_consonant_cluster = sanitize(input.linguistic.maxConsonantCluster, 0, { min: 0, max: 64 });
		features.repeated_char_ratio = sanitize(input.linguistic.repeatedCharRatio, 0, { min: 0, max: 1 });
		features.syllable_estimate = sanitize(input.linguistic.syllableEstimate, 0, { min: 0, max: 20 });
		features.impossible_cluster_count = sanitize(input.linguistic.impossibleClusterCount, 0, { min: 0, max: 20 });
	}

	if (input.structure) {
		features.has_word_boundaries = input.structure.hasWordBoundaries ? 1 : 0;
		features.segment_count = sanitize(input.structure.segmentCount, 0, { min: 0, max: 32 });
		features.avg_segment_length = sanitize(input.structure.avgSegmentLength, 0, { min: 0, max: 64 });
		features.segments_without_vowels_ratio = sanitize(
			input.structure.segmentsWithoutVowelsRatio,
			0,
			{ min: 0, max: 1 }
		);
	}

	if (input.statistical) {
		features.unique_char_ratio = sanitize(input.statistical.uniqueCharRatio, 0, { min: 0, max: 1 });
		features.vowel_gap_ratio = sanitize(input.statistical.vowelGapRatio, 0, { min: 0, max: 1 });
		features.max_digit_run = sanitize(input.statistical.maxDigitRun, 0, { min: 0, max: 64 });
		features.bigram_entropy = sanitize(input.statistical.bigramEntropy, 0, { min: 0, max: 16 });
	}

	if (input.ngram) {
		features.ngram_bigram_score = sanitize(input.ngram.bigramScore, 0, { min: 0, max: 1 });
		features.ngram_trigram_score = sanitize(input.ngram.trigramScore, 0, { min: 0, max: 1 });
		features.ngram_overall_score = sanitize(input.ngram.overallScore, 0, { min: 0, max: 1 });
		features.ngram_confidence = sanitize(input.ngram.confidence, 0, { min: 0, max: 1 });
		features.ngram_risk_score = sanitize(input.ngram.riskScore, 0, { min: 0, max: 1 });
		features.ngram_is_natural = input.ngram.isNatural ? 1 : 0;
	}

	return features;
}
