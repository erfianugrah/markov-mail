# Detectors - Feature Extraction Reference

**Version**: 3.0.0
**Last Updated**: 2025-11-30

## Overview

Detectors are **feature extractors**, not risk scorers. They analyze email addresses and related metadata to produce numeric or boolean features that feed into the Random Forest / Decision Tree models. All detector outputs must be registered in `src/utils/feature-vector.ts` to be available for training and inference.

**Architecture**: `Detectors → Features → buildFeatureVector() → Model (RF/DT) → Risk Score`

## Design Principles

1. **Features, not scores**: Detectors return raw measurements (entropy, length, ratios), not risk assessments
2. **Domain-independent**: Features work across languages and email providers
3. **Type safety**: All features defined in `FeatureVectorInput` interface
4. **Graceful degradation**: Missing/optional features (like MX lookups) handled via fallbacks

## Detector Categories

### 1. Sequential Pattern Detection
**Source**: `src/detectors/sequential.ts`

Detects automated account creation patterns with sequential numbering.

**Examples**:
- `user1@gmail.com`, `user2@gmail.com`, `user3@gmail.com`
- `test_account_001@outlook.com`, `test_account_002@outlook.com`
- `demo123@yahoo.com`, `demo124@yahoo.com`

**Features Produced**:
- `sequential_confidence` (0-1): Likelihood of being sequential
  - 1.0 = Clear sequential pattern (e.g., "user123", "test001")
  - 0.5-0.8 = Ambiguous (digits could be birth year or sequential)
  - 0.0 = No sequential pattern detected

**Detection Logic**:
- Extracts base pattern (e.g., "user" from "user123")
- Checks against common sequential bases (test, user, account, demo, etc.)
- Distinguishes birth years (1940-2025) from sequential IDs
- Rewards leading zeros ("001" vs "1") as stronger signal

**Used By**: Primary fraud signal - automated bot registrations

---

### 2. Plus-Addressing Analysis
**Source**: `src/detectors/plus-addressing.ts`

Analyzes Gmail-style plus-addressing (`user+tag@gmail.com`) for abuse patterns.

**Examples**:
- `john+spam@gmail.com` → Base: `john@gmail.com`
- `test+disposable123@outlook.com` → Suspicious tag length

**Features Produced**:
- `plus_risk` (0-1): Risk score based on tag characteristics
  - Long random tags (>8 chars) = higher risk
  - Multiple segments = higher risk
  - Normalized base email returned for deduplication

**Detection Logic**:
- Splits on `+` delimiter (Gmail, Outlook, Yahoo support)
- Analyzes tag length, segment count, randomness
- Returns canonical base address for grouping

**Used By**: Detecting disposable/throwaway account variations

---

### 3. Linguistic Features
**Source**: `src/detectors/linguistic-features.ts`

Extracts phonetic and structural properties of the local part (before `@`).

**Features Produced** (via `linguistic` namespace):

| Feature | Type | Description | Range |
|---------|------|-------------|-------|
| `pronounceability` | number | Phonetic naturalness (consonant cluster analysis) | 0-1 |
| `vowel_ratio` | number | Ratio of vowels to total letters | 0-1 |
| `max_consonant_cluster` | number | Longest consonant run (e.g., "schw" = 4) | 0-64 |
| `repeated_char_ratio` | number | Ratio of repeated characters (e.g., "aaa") | 0-1 |
| `syllable_estimate` | number | Estimated syllable count | 0-32 |
| `impossible_cluster_count` | number | Count of unpronounceable clusters | 0-16 |

**Detection Logic**:
- Vowel/consonant identification (handles semi-vowels: y, w)
- Common consonant clusters recognized (sch, thr, str, etc.)
- Syllable estimation via vowel groups
- Pronounceability heuristic: penalizes long consonant clusters

**Used By**: Distinguishing real names from random gibberish (e.g., "john.smith" vs "xkzqwrtpl")

---

### 4. Structural Features
**Source**: `src/detectors/linguistic-features.ts` (via `structure` namespace)

Analyzes word boundaries and segmentation patterns.

**Features Produced** (via `structure` namespace):

| Feature | Type | Description | Example |
|---------|------|-------------|---------|
| `has_word_boundaries` | boolean | Contains dots/underscores/hyphens | `john.doe` = true |
| `segment_count` | number | Number of segments split by boundaries | `a.b.c` = 3 |
| `avg_segment_length` | number | Average length per segment | `john.doe` = 4 |
| `segments_without_vowels_ratio` | number | Ratio of segments lacking vowels | 0-1 |

**Detection Logic**:
- Splits on word boundary chars (`.`, `_`, `-`)
- Counts segments and analyzes each
- Calculates average lengths
- Flags segments without vowels (suspicious)

**Used By**: Detecting structured names (legitimate) vs unsegmented gibberish (fraud)

---

### 5. Statistical Features
**Source**: `src/detectors/linguistic-features.ts` (via `statistical` namespace)

Extracts entropy and character distribution metrics.

**Features Produced** (via `statistical` namespace):

| Feature | Type | Description | Range |
|---------|------|-------------|-------|
| `unique_char_ratio` | number | Ratio of unique chars to total | 0-1 |
| `vowel_gap_ratio` | number | Ratio of max vowel gap to length | 0-1 |
| `max_digit_run` | number | Longest consecutive digit sequence | 0-128 |
| `bigram_entropy` | number | Shannon entropy of character bigrams | 0-~7 |

**Detection Logic**:
- Calculates Shannon entropy on bigrams (2-char sequences)
- Tracks character uniqueness and diversity
- Measures digit clustering
- Identifies vowel deserts (long consonant stretches)

**Used By**: Information-theoretic fraud detection (random strings have high entropy)

---

### 6. N-Gram Analysis (Multilingual)
**Source**: `src/detectors/ngram-multilang.ts`, `src/detectors/ngram-analysis.ts`

Evaluates how “natural” the local part looks across seven language models (EN, ES, FR, DE, IT, PT, Romanized). The detector now emits dedicated features rather than acting as a placeholder.

**Features Produced**:

| Feature | Type | Description | Range |
|---------|------|-------------|-------|
| `ngram_bigram_score` | number | Percentage of matching language bigrams | 0-1 |
| `ngram_trigram_score` | number | Percentage of matching language trigrams | 0-1 |
| `ngram_overall_score` | number | Weighted blend of bigram/trigram hits | 0-1 |
| `ngram_confidence` | number | Confidence derived from sample size | 0-1 |
| `ngram_risk_score` | number | Inverted naturalness (1 = gibberish) | 0-1 |
| `ngram_is_natural` | flag | 1 if local part resembles natural language | 0/1 |

**Detection Logic**:
- Detects most likely language using frequency analysis
- Scores how many bigrams/trigrams fall inside that language’s corpus
- Produces risk score inversely proportional to naturalness
- Confidence scales with available n-grams (short strings remain low-risk)

**Models**:
- Baked-in character frequency tables (no external service calls)
- Same logic shared between runtime detector and feature exporter

**Used By**: Feature vector powering Random Forest / Decision Tree models, plus runtime heuristics inside `pattern-family`.

---

### 7. Pattern Family Detection
**Source**: `src/detectors/pattern-family.ts`

Hashes email structure to detect bulk account creation with similar patterns.

**Features Produced**:
- Pattern family hashes (not directly in feature vector)
- Used for grouping and batch analysis

**Detection Logic**:
- Replaces digits with `#`, letters with `a`, special chars normalized
- `john123@gmail.com` → `aaaa###@gmail.com`
- Groups emails with same structure
- Useful for detecting coordinated fraud campaigns

**Used By**: Offline analysis and fraud campaign detection

---

### 8. TLD Risk Profiling
**Source**: `src/detectors/tld-risk.ts`

Assigns risk scores based on Top-Level Domain abuse statistics.

**Features Produced**:
- `tld_risk_score` (0-1): TLD-based risk assessment
- `domain_reputation_score` (0-1): Combined domain + TLD risk

**Risk Categories**:
- **Trusted** (0.0-0.3): .edu, .gov, .mil (restricted registration)
- **Standard** (0.3-0.5): .com, .net, .org (paid, established)
- **Suspicious** (0.5-0.7): .info, .biz, .xyz (cheap, higher abuse)
- **High Risk** (0.7-1.0): .tk, .ml, .ga, .cf (free, disposable havens)

**TLD Profiles** (143 total):
```typescript
{
  tld: 'edu',
  category: 'trusted',
  disposableRatio: 0.01,
  spamRatio: 0.02,
  riskMultiplier: 0.5,
  registrationCost: 'restricted',
}
```

**Used By**: Domain-based filtering (free TLDs correlated with fraud)

---

### 9. Identity Signals (Name Similarity)
**Source**: `src/utils/identity-signals.ts`

Compares submission name to email address for consistency.

**Features Produced**:

| Feature | Type | Description | Example |
|---------|------|-------------|---------|
| `name_similarity_score` | number | Levenshtein distance normalized | 0-1 |
| `name_token_overlap` | number | Token-level overlap (Jaccard) | 0-1 |
| `name_in_email` | boolean | Exact name substring match | true/false |

**Detection Logic**:
- Normalizes both name and email (lowercase, remove punctuation)
- Calculates string similarity (Levenshtein)
- Tokenizes and compares word-level overlap
- Checks for exact substring matches

**Examples**:
- ✅ Name: "John Smith", Email: "john.smith@gmail.com" → High similarity
- ❌ Name: "Alice Johnson", Email: "xkzqwrtpl@hotmail.com" → Low similarity

**Used By**: Detecting stolen identity / mismatched credentials

---

### 10. Geo-Consistency Signals
**Source**: `src/utils/geo-signals.ts`

Analyzes geographic metadata for anomalies (requires Cloudflare request.cf data).

**Features Produced**:

| Feature | Type | Description | Example |
|---------|------|-------------|---------|
| `geo_language_mismatch` | boolean | Browser lang ≠ country lang | true/false |
| `geo_timezone_mismatch` | boolean | Timezone ≠ country TZ | true/false |
| `geo_anomaly_score` | number | Combined geo inconsistency | 0-1 |

**Detection Logic**:
- Compares `Accept-Language` header to country
- Validates timezone against geographic location
- Flags VPN/proxy indicators (timezone mismatches)

**Example Anomalies**:
- Country: Japan, Language: English, Timezone: US/Pacific → Suspicious
- Country: France, Language: French, Timezone: Europe/Paris → Legitimate

**Used By**: Detecting geo-spoofing and VPN-based fraud

---

### 11. MX Record Analysis
**Source**: `src/services/mx-resolver.ts`

Resolves DNS MX records to validate email deliverability and identify providers.

**Features Produced**:

| Feature | Type | Description |
|---------|------|-------------|
| `mx_has_records` | boolean | Domain has MX records |
| `mx_record_count` | number | Number of MX records (0-32) |
| `mx_provider_google` | boolean | Uses Google Workspace |
| `mx_provider_microsoft` | boolean | Uses Microsoft 365 |
| `mx_provider_icloud` | boolean | Uses iCloud Mail |
| `mx_provider_yahoo` | boolean | Uses Yahoo Mail |
| `mx_provider_zoho` | boolean | Uses Zoho Mail |
| `mx_provider_proton` | boolean | Uses ProtonMail |
| `mx_provider_self_hosted` | boolean | Custom/self-hosted |
| `mx_provider_other` | boolean | Other providers |

**Detection Logic**:
- DNS lookup for MX records
- Pattern matching against known provider signatures
- Well-known provider cache (19 common domains) for speed
- Parallel fetching with 500 concurrency limit

**Provider Signatures**:
```typescript
'google.com': /google\.com$/i,
'outlook.com': /outlook\.com$/i,
'zoho.com': /zoho\.com$/i,
```

**Used By**: Validating email authenticity (no MX = likely invalid domain)

---

### 12. Benford's Law Analysis
**Source**: `src/detectors/benfords-law.ts`

Batch-level statistical analysis for detecting synthetic datasets.

**Theory**: In natural data, leading digits follow Benford's distribution (1 appears ~30%, 9 appears ~4.6%). Fraudulent data often has uniform digit distribution.

**Features Produced**:
- Not used in per-email scoring (batch analysis only)
- Outputs chi-squared statistics for dataset validation

**Detection Logic**:
- Extracts first digits from numeric sequences in emails
- Compares distribution to Benford's expected frequencies
- High chi-squared = synthetic/fabricated data

**Used By**: Offline fraud detection and dataset validation

---

## Feature Integration

### Feature Vector Pipeline

```typescript
// 1. Detectors extract raw signals
const linguistic = analyzeLinguisticFeatures(localPart);
const sequential = detectSequentialPattern(localPart);
const tld = assessTLDRisk(domain);

// 2. Signals combined into FeatureVectorInput
const input: FeatureVectorInput = {
  sequentialConfidence: sequential.confidence,
  plusRisk: plusAnalysis.risk,
  linguistic: {
    pronounceability: linguistic.pronounceability,
    vowelRatio: linguistic.vowelRatio,
    // ...
  },
  tldRisk: tld.riskScore,
  // ...
};

// 3. buildFeatureVector() normalizes and validates
const features = buildFeatureVector(input);
// Output: { sequential_confidence: 0.85, plus_risk: 0.2, ... }

// 4. Model evaluates feature vector
const result = evaluateRandomForest(features);
// Output: { score: 0.92, reason: "high_sequential_confidence" }
```

### Feature Count (45 Total)

| Category | Count | Examples |
|----------|-------|----------|
| Sequential/Pattern | 2 | `sequential_confidence`, `plus_risk` |
| Linguistic | 6 | `pronounceability`, `vowel_ratio`, `max_consonant_cluster` |
| Structural | 4 | `has_word_boundaries`, `segment_count`, `avg_segment_length` |
| Statistical | 4 | `unique_char_ratio`, `bigram_entropy`, `max_digit_run` |
| N-gram | 6 | `ngram_*` scores + `ngram_is_natural` |
| Identity | 3 | `name_similarity_score`, `name_token_overlap`, `name_in_email` |
| Geo | 3 | `geo_language_mismatch`, `geo_timezone_mismatch`, `geo_anomaly_score` |
| MX | 9 | `mx_has_records`, `mx_provider_*` (8 providers) |
| Domain | 3 | `tld_risk_score`, `domain_reputation_score`, `provider_is_free` |
| Basic | 5 | `local_length`, `digit_ratio`, `entropy_score`, etc. |

**Full List**: See `src/utils/feature-vector.ts`

---

## Adding New Detectors

To add a new detector:

1. **Create detector file**: `src/detectors/my-detector.ts`
   ```typescript
   export interface MyDetectorResult {
     myFeature: number;  // 0-1 normalized
   }

   export function analyzeMyFeature(email: string): MyDetectorResult {
     // ... detection logic
     return { myFeature: 0.75 };
   }
   ```

2. **Update FeatureVectorInput**: `src/utils/feature-vector.ts`
   ```typescript
   export interface FeatureVectorInput {
     // ... existing features
     myFeature?: number;  // Add optional field
   }
   ```

3. **Map to feature vector**: `src/utils/feature-vector.ts:buildFeatureVector()`
   ```typescript
   export function buildFeatureVector(input: FeatureVectorInput): FeatureVector {
     const features: FeatureVector = {
       // ... existing mappings
       my_feature: sanitize(input.myFeature, 0, { min: 0, max: 1 }),
     };
     return features;
   }
   ```

4. **Integrate in middleware**: `src/middleware/fraud-detection.ts`
   ```typescript
   const myResult = analyzeMyFeature(email);
   const featureInput: FeatureVectorInput = {
     // ... existing features
     myFeature: myResult.myFeature,
   };
   ```

5. **Retrain models**: Include new feature in training
   ```bash
   npm run cli features:export  # Regenerate features
   npm run cli model:train -- --n-trees 20 --upload  # Retrain RF
   ```

---

## Deprecated Detectors (Removed in v3.0)

The following detectors were removed as part of the v3.0 ML-first architecture:

- ❌ `keyboard-mashing.ts` → Replaced by `linguistic-features` (pronounceability)
- ❌ `keyboard-walk.ts` → Replaced by `linguistic-features` (impossible clusters)
- ❌ Direct risk scoring → All detectors now produce features only

**Migration**: Feature-based approach allows the model to learn optimal weights, rather than hardcoded risk formulas.

---

## Performance Notes

### Fast Detectors (< 1ms)
- Sequential pattern detection
- Plus-addressing normalization
- Linguistic feature extraction
- TLD risk lookup

### Moderate Detectors (1-10ms)
- N-gram entropy calculation
- Pattern family hashing
- Identity signal comparison

### Slow Detectors (10-1000ms)
- **MX record resolution** (DNS lookup, 50-200ms per domain)
  - Mitigated via well-known provider cache
  - Parallel fetching (500 concurrent)
  - Training optimization: 17x speedup (50min → 3min)

### Optimization Strategy
1. **Cache aggressively**: Well-known MX providers, TLD profiles
2. **Batch operations**: MX lookups parallelized during training
3. **Skip expensive features**: Use `--skip-mx` flag for fast iteration
4. **Lazy evaluation**: Only compute features needed by active models

---

## References

- [Feature Vector Definition](../src/utils/feature-vector.ts) - Complete feature list
- [Model Training](./MODEL_TRAINING_v3.md) - How features feed into RF/DT
- [Configuration](./CONFIGURATION.md) - Thresholds and model settings
- [Scoring Logic](./SCORING.md) - How features become risk scores

---

## Changelog

### v3.0.0 (2025-11-30)
- ✅ Converted all detectors to feature extractors (removed direct scoring)
- ✅ Added MX resolver with provider identification (9 features)
- ✅ Added identity signals (name similarity)
- ✅ Added geo-consistency signals
- ✅ Removed keyboard-mashing and keyboard-walk (merged into linguistic)
- ✅ Unified architecture: Detectors → Features → Model → Score

### v2.x
- Legacy risk-scoring architecture (deprecated)
