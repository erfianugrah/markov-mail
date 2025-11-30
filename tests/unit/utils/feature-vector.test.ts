import { describe, it, expect } from 'vitest';
import { buildFeatureVector } from '../../../src/utils/feature-vector';

describe('buildFeatureVector', () => {
	it('sanitizes values and encodes booleans as 0/1', () => {
		const vector = buildFeatureVector({
			sequentialConfidence: 1.2,
			plusRisk: -0.5,
			localPartLength: 200,
			digitRatio: 2,
			nameSimilarityScore: 1.5,
			nameTokenOverlap: -1,
			nameInEmail: true,
			geoLanguageMismatch: true,
			geoTimezoneMismatch: true,
			geoAnomalyScore: 1.4,
			mxHasRecords: true,
			mxRecordCount: 40,
			mxProviderGoogle: true,
			mxProviderMicrosoft: false,
			mxProviderIcloud: false,
			mxProviderYahoo: true,
			mxProviderZoho: false,
			mxProviderProton: false,
			mxProviderSelfHosted: true,
			mxProviderOther: true,
			providerIsFree: true,
			providerIsDisposable: false,
			tldRisk: 1.5,
			domainReputationScore: -0.3,
			entropyScore: 25,
			linguistic: {
				pronounceability: 0.5,
				vowelRatio: 1.5,
				maxConsonantCluster: 80,
				repeatedCharRatio: -1,
				syllableEstimate: 40,
				impossibleClusterCount: 30,
			},
			structure: {
				hasWordBoundaries: true,
				segmentCount: 50,
				avgSegmentLength: -2,
				segmentsWithoutVowelsRatio: 3,
			},
			statistical: {
				uniqueCharRatio: -1,
				vowelGapRatio: 2,
				maxDigitRun: 100,
			},
		});

		expect(vector.sequential_confidence).toBe(1);
		expect(vector.plus_risk).toBe(0);
		expect(vector.local_length).toBe(128);
		expect(vector.digit_ratio).toBe(1);
		expect(vector.name_similarity_score).toBe(1);
		expect(vector.name_token_overlap).toBe(0);
		expect(vector.name_in_email).toBe(1);
		expect(vector.geo_language_mismatch).toBe(1);
		expect(vector.geo_timezone_mismatch).toBe(1);
		expect(vector.geo_anomaly_score).toBe(1);
		expect(vector.mx_has_records).toBe(1);
		expect(vector.mx_record_count).toBe(32);
		expect(vector.mx_provider_google).toBe(1);
		expect(vector.mx_provider_yahoo).toBe(1);
		expect(vector.mx_provider_self_hosted).toBe(1);
		expect(vector.mx_provider_other).toBe(1);
		expect(vector.provider_is_free).toBe(1);
		expect(vector.provider_is_disposable).toBe(0);
		expect(vector.tld_risk_score).toBe(1);
		expect(vector.domain_reputation_score).toBe(0);
		expect(vector.entropy_score).toBe(16);
		expect(vector.max_consonant_cluster).toBe(64);
		expect(vector.syllable_estimate).toBe(20);
		expect(vector.segments_without_vowels_ratio).toBe(1);
		expect(vector.max_digit_run).toBe(64);
	});

	it('provides zeros when optional blocks are missing', () => {
		const vector = buildFeatureVector({});
		expect(vector.sequential_confidence).toBe(0);
		expect(vector.plus_risk).toBe(0);
		expect(vector.local_length).toBe(0);
		expect(vector.domain_reputation_score).toBe(0);
		expect(vector.name_similarity_score).toBe(0);
		expect(vector.geo_anomaly_score).toBe(0);
		expect(vector.mx_has_records).toBe(0);
	});

	it('maps n-gram analysis signals', () => {
		const vector = buildFeatureVector({
			ngram: {
				bigramScore: 0.85,
				trigramScore: 0.65,
				overallScore: 1.2,
				confidence: -0.5,
				riskScore: 1.4,
				isNatural: true,
			},
		});

		expect(vector.ngram_bigram_score).toBeCloseTo(0.85);
		expect(vector.ngram_trigram_score).toBeCloseTo(0.65);
		expect(vector.ngram_overall_score).toBe(1);
		expect(vector.ngram_confidence).toBe(0);
		expect(vector.ngram_risk_score).toBe(1);
		expect(vector.ngram_is_natural).toBe(1);
	});
});
