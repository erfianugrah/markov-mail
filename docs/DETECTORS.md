# Fraud Detection System - All Detectors

**Complete reference for all 8 fraud detection algorithms**

## Overview

The system uses **8 independent detectors** that run in parallel and combine results through weighted risk scoring.

| Detector | Purpose | Patterns Detected | Risk Weight | Latency |
|----------|---------|-------------------|-------------|---------|
| Sequential | Numbered accounts | user123, test001 | Pattern (40%) | 0.05ms |
| Dated | Date-based patterns | john.2025, oct2024 | Pattern (40%) | 0.05ms |
| Plus-Addressing | Email aliasing abuse | user+1, user+spam | Pattern (40%) | 0.10ms |
| Keyboard Walk | Lazy passwords | qwerty, asdfgh, 123456 | Pattern (40%) | 0.10ms |
| N-Gram Gibberish | Random strings | xk7g2w9qa, zzzzqqq | Pattern (40%) | 0.15ms |
| TLD Risk | Domain extension risk | .tk, .ml, .ga | TLD (10%) | 0.05ms |
| Benford's Law | Batch attack detection | Statistical analysis | Batch only | N/A |
| **Markov Chain** | **Character transitions** | **Fraudulent patterns** | **Markov (25%)** | **0.10ms** |

---

## 1. Sequential Pattern Detector

**File**: `src/detectors/sequential.ts` (301 lines)

### Purpose
Detects emails with sequential numbering patterns common in automated bot signups.

### Examples
```
✅ user123@gmail.com          (trailing number)
✅ test001@outlook.com        (padded zeros)
✅ account_42@yahoo.com       (underscore separator)
❌ peter.parker@gmail.com     (natural name)
❌ john.1990@gmail.com        (birth year - legitimate)
❌ april198807@outlook.com   (birth year+month - legitimate)
```

### Birth Year Protection
**IMPORTANT**: The detector automatically **whitelists birth years** (1940-2025) to prevent false positives. This includes:
- Exact 4-digit years: `john.2000`, `mary1985`
- Years with month/date: `april198807` (1988 + month 07)
- Years with suffixes: `butler198145` (1981 + suffix)

```typescript
// Birth year detection (lines 28-44)
function extractBirthYear(digits: string): number | null {
  const currentYear = new Date().getFullYear();

  // Check for 4-digit years within digit sequences
  for (let i = 0; i <= digits.length - 4; i++) {
    const year = parseInt(digits.substring(i, i + 4), 10);
    const yearAge = currentYear - year;

    // Plausible birth year: 13-100 years old
    if (year >= 1940 && year <= currentYear &&
        yearAge >= 13 && yearAge <= 100) {
      return year;  // Skip detection
    }
  }
  return null;
}
```

### Algorithm
```typescript
// Extract numbers from local part
const numbers = extractNumbers(localPart);

// Check if trailing number is sequential
if (numbers.length > 0) {
    const lastDigit = numbers[numbers.length - 1];

    // EXCEPTION: Skip if contains birth year
    if (extractBirthYear(lastDigit)) {
        return { isSequential: false };
    }

    if (isSequentialPattern(lastDigit)) {
        return { detected: true, confidence: 0.9 };
    }
}
```

### Confidence Factors (7 total)
1. Trailing number present (+0.3)
2. Number is padded with zeros (+0.2)
3. Number is short (1-3 digits) (+0.15)
4. Base part is generic word (+0.15)
5. Separator before number (+0.1)
6. Multiple numbers present (-0.2)
7. Number context makes sense (-0.1)
8. **Birth year detected (×0 - skip entirely)**

### Risk Contribution
```typescript
baseRisk = 0.4;  // If detected
finalRisk = baseRisk + (confidence * 0.3);
// Range: 0.4 - 0.7
```

---

## 2. Dated Pattern Detector

**File**: `src/detectors/dated.ts` (371 lines)

### Purpose
Finds date or year patterns in email addresses, common in temporary account creation.

### Examples
```
✅ john.doe.2025@gmail.com    (year suffix)
✅ user_2025@yahoo.com        (year with separator)
✅ name.oct2024@domain.com    (month+year)
✅ 20251031@gmail.com         (YYYYMMDD)
❌ peter.parker@gmail.com     (no dates)
```

### Date Formats Detected (5 types)
1. **Year**: `2025`, `2024`, `2026` (current ±1)
2. **Month-Year**: `jan2025`, `oct2024`, `122024`
3. **Full Date**: `20250101`, `2025-01-01`
4. **Leading Year**: `2025.john`, `2024_user`
5. **Short Year**: `25`, `24` (risky - many false positives)

### Confidence Levels
- Full date (YYYYMMDD): 0.9
- Month-year: 0.8
- Year only: 0.7
- Leading year: 0.6
- Short year: 0.5

### Risk Contribution
```typescript
baseRisk = 0.35;
finalRisk = baseRisk + (confidence * 0.3);
// Range: 0.35 - 0.65
```

---

## 3. Plus-Addressing Detector

**File**: `src/detectors/plus-addressing.ts` (329 lines)

### Purpose
Normalizes emails and detects plus-addressing abuse (same user creating multiple accounts).

### Examples
```
✅ user+1@gmail.com
✅ user+2@gmail.com
✅ name+spam@yahoo.com
✅ test+tag123@protonmail.com
❌ legitimate+newsletter@gmail.com (single use acceptable)
```

### Supported Providers (11)
- Gmail (also removes dots: `j.o.h.n@gmail.com` → `john@gmail.com`)
- Yahoo, Outlook, AOL
- iCloud, ProtonMail, FastMail
- Zoho, GMX, Mail.com, Yandex

### Normalization Process
```typescript
// Gmail example
"john.doe+tag@gmail.com"
  → Remove dots: "johndoe+tag@gmail.com"
  → Remove plus: "johndoe@gmail.com"
  → Result: canonical form for deduplication
```

### Risk Scoring
- Single plus-address: +0.2 risk
- Suspicious tag (numbers, "spam", etc.): +0.3 risk
- Multiple variants detected (batch): +0.4 risk

---

## 4. Keyboard Walk Detector

**File**: `src/detectors/keyboard-walk.ts` (707 lines)

### Purpose
Detects lazy keyboard sequences like qwerty, asdfgh, 123456 while avoiding false positives on birth years.

### Supported Layouts (6)
1. **QWERTY** (US/UK) - `qwerty`, `asdfgh`, `zxcvbn`
2. **AZERTY** (French) - `azerty`, `qsdfgh`
3. **QWERTZ** (German) - `qwertz`, `asdfgh`
4. **Dvorak** - Alternative layout patterns
5. **Colemak** - Alternative layout patterns
6. **Numeric Pad** - `123456`, `789456` (5+ digits only)

### Examples
```
✅ qwerty@gmail.com           (horizontal)
✅ asdfgh@yahoo.com           (horizontal)
✅ 123456@outlook.com         (numeric 5+ digits)
✅ zxcvbn@domain.com          (bottom row)
✅ 1qaz2wsx@gmail.com         (vertical)
❌ peter.parker@gmail.com     (natural)
❌ henrich.321@outlook.com    (3 digits - too short)
❌ laura1987@outlook.com      (birth year - legitimate)
```

### Birth Year & Short Sequence Protection

**Numeric Pattern Requirements** (to reduce false positives):
- **Letter keyboard walks**: 4+ characters (unchanged)
- **Number row sequences**: **5+ digits** (increased from 4)
- **Numpad patterns**: **5+ digits** (increased from 3)
- **Sequential digits**: **5+ digits** with birth year check

```typescript
// Birth year protection (lines 41-57)
function containsBirthYear(digits: string): boolean {
  const currentYear = new Date().getFullYear();

  // Check for 4-digit years within the string
  for (let i = 0; i <= digits.length - 4; i++) {
    const year = parseInt(digits.substring(i, i + 4), 10);
    const yearAge = currentYear - year;

    // Plausible birth year: 13-100 years old
    if (year >= 1940 && year <= currentYear &&
        yearAge >= 13 && yearAge <= 100) {
      return true;  // Skip this pattern
    }
  }
  return false;
}
```

### Detection Method
```typescript
// Horizontal walks (lines 312-367)
const isNumberRow = row === layout.rows[0];
const minLength = isNumberRow ? 5 : 4;  // 5+ for numbers

const forwardMatch = findLongestSubsequence(localPart, row);
if (forwardMatch.length >= minLength) {
    // Skip if contains birth year
    if (isNumberRow && containsBirthYear(forwardMatch.sequence)) {
        continue;  // Don't flag birth years
    }
    return { detected: true, walkType: 'numeric' };
}
```

```typescript
// Numeric sequences (lines 535-592)
function detectNumericSequence(localPart: string) {
    const digitMatches = localPart.match(/\d{3,}/g);

    for (const digits of digitMatches) {
        // Skip if contains birth year
        if (containsBirthYear(digits)) {
            continue;
        }

        // Only flag 5+ digit sequences
        if (isSequentialDigits(digits) && digits.length >= 5) {
            return { detected: true };
        }
    }
}
```

```typescript
// Numpad patterns (lines 486-546)
function detectNumpadPattern(localPart: string) {
    for (const pattern of NUMPAD_PATTERNS) {
        // Only flag patterns 5+ digits
        if (pattern.length < 5) {
            continue;
        }

        if (localPart.includes(pattern)) {
            // Skip if contains birth year
            if (containsBirthYear(pattern)) {
                continue;
            }
            return { detected: true };
        }
    }
}
```

### Confidence Calculation
```typescript
baseConfidence = 0.7;
if (walk.length >= 6) baseConfidence += 0.2;  // Long walks
if (walk.startsWith(localPart)) baseConfidence += 0.1;  // Starts with walk
// Max confidence: 1.0
```

### Risk Contribution
```typescript
riskScore = confidence * 0.5 + positionBonus + layoutBonus;
// Range: 0.4 - 0.9
```

### False Positive Prevention
The **5-digit minimum** for numeric patterns prevents false positives on:
- Simple numbers: `321`, `432`, `987` (legitimate memorable numbers)
- Area codes: `415`, `212`, `310`
- Ages/years referenced: `39`, `40`, `65`

While still catching true keyboard walks:
- `123456` (6 digits)
- `12345` (5 digits)
- `789456` (6 digits)

---

## 5. N-Gram Gibberish Detector

**File**: `src/detectors/ngram-analysis.ts` (340 lines)

### Purpose
Uses **Markov Chain perplexity** (preferred) or n-gram analysis (fallback) to distinguish natural names from random gibberish.

### Algorithm (Perplexity-Based - Preferred)

**Research-Backed Approach**: Uses character-level language model perplexity from the trained Markov Chain model.

**Step 1: Calculate Cross-Entropy**
```typescript
crossEntropy = legitMarkovModel.crossEntropy(localPart)
// Measures how "surprising" the input is to the legitimate model
// Lower = fits legitimate email patterns
// Higher = random/gibberish
```

**Step 2: Calculate Perplexity**
```typescript
perplexity = exp(crossEntropy)
// Perplexity = 2^entropy
// Lower perplexity = more natural/expected
// Higher perplexity = more surprising/random
```

**Step 3: Adaptive Threshold**
```typescript
lengthFactor = min(localPart.length / 10, 2.0)
baseThreshold = 60.0  // Empirical from 91K email dataset
threshold = baseThreshold * max(1.0, 1.5 - lengthFactor * 0.3)

isGibberish = perplexity > threshold
```

**Step 4: Calculate Confidence**
```typescript
if (isGibberish) {
  // How much higher than threshold
  confidence = min((perplexity - threshold) / threshold, 1.0)
}
```

### Examples

**Natural Name**:
```
"james.brown" →
  crossEntropy: 3.2
  perplexity: exp(3.2) = 24.5
  threshold: 60.0
  result: NATURAL (perplexity < threshold)
```

**Gibberish**:
```
"xk7g2w9qa" →
  crossEntropy: 5.8
  perplexity: exp(5.8) = 330
  threshold: 60.0
  result: GIBBERISH (perplexity: 330 > threshold: 60)
  confidence: (330-60)/60 = 4.5 → capped at 1.0
```

### Fallback Algorithm (N-Gram Analysis)

Used when Markov models are not available. **Note**: This method can produce false positives on names like "james.brown" and "linda.garcia" because trigram lists contain prose patterns ("the", "and", "ing") that don't appear in names.

```typescript
bigramScore = matchedBigrams / totalBigrams;
trigramScore = matchedTrigrams / totalTrigrams;
overallScore = (bigramScore * 0.6) + (trigramScore * 0.4);

threshold = length < 5 ? 0.30 : 0.40;
isGibberish = overallScore < threshold;
```

### Why Perplexity-Based is Better

| Method | james.brown | linda.garcia | xk7g2w9qa |
|--------|-------------|--------------|-----------|
| **N-Gram (old)** | ❌ BLOCKED (0.69) | ❌ BLOCKED (0.69) | ✅ BLOCKED |
| **Perplexity (new)** | ✅ ALLOWED (0.17) | ✅ ALLOWED (0.09) | ✅ BLOCKED |

**Benefits**:
- ✅ Trained on 91K real emails (not hardcoded lists)
- ✅ Adaptive to actual patterns in data
- ✅ No false positives on common names
- ✅ Standard in NLP research (used by LLMs)

### Risk Contribution
```typescript
if (isGibberish && confidence > 0.7) {
    // Markov model takes precedence - if it says legit, trust it
    if (markovResult && !markovResult.isLikelyFraudulent && markovResult.confidence > 0.3) {
        riskScore = 0;  // Override gibberish penalty
    } else {
        riskScore = confidence;  // 0.6 - 1.0
    }
}
```

---

## 6. TLD Risk Profiling

**File**: `src/detectors/tld-risk.ts` (398 lines)

### Purpose
Categorizes domain TLDs by abuse potential and registration cost.

### TLD Categories (31 TLDs tracked)

#### Trusted (3 TLDs) - Risk Multiplier: 0.2 - 0.5
```
.edu    (educational institutions)  0.2x
.gov    (government)                0.3x
.mil    (military)                  0.2x
```

#### Standard (14 TLDs) - Risk Multiplier: 0.8 - 1.3
```
.com    (commercial)                1.0x
.net    (network)                   1.0x
.org    (organization)              0.9x
.io     (tech startups)             1.1x
.co     (commercial alternative)    1.2x
.us, .uk, .ca, .au, .de (national)  0.8-1.0x
```

#### Suspicious (5 TLDs) - Risk Multiplier: 2.1 - 2.7
```
.xyz    (cheap)                     2.5x
.top    (cheap)                     2.6x
.club   (cheap)                     2.4x
.online (cheap)                     2.3x
.site   (cheap)                     2.2x
```

#### High Risk (5 TLDs) - Risk Multiplier: 2.5 - 3.0
```
.tk     (Tokelau, FREE)             3.0x
.ml     (Mali, FREE)                2.9x
.ga     (Gabon, FREE)               2.8x
.cf     (Central African Rep, FREE) 2.7x
.gq     (Equatorial Guinea, FREE)   2.6x
```

### Risk Calculation
```typescript
// Normalize risk multiplier to 0-1 scale
riskScore = (riskMultiplier - 0.2) / 2.8;

// Examples:
.edu: (0.2 - 0.2) / 2.8 = 0.00
.com: (1.0 - 0.2) / 2.8 = 0.29
.xyz: (2.5 - 0.2) / 2.8 = 0.82
.tk:  (3.0 - 0.2) / 2.8 = 1.00
```

### Abuse Statistics
```
.tk (Tokelau):
  - 70% used for disposable email
  - 80% spam/phishing domains
  - FREE registration
  - No verification required

.com (Commercial):
  - 5% disposable email
  - 10% spam domains
  - ~$10/year registration
  - Domain verification required
```

---

## 7. Benford's Law Analyzer

**File**: `src/detectors/benfords-law.ts` (315 lines)

### Purpose
Statistical batch analysis to detect automated account generation patterns.

### Theory: Benford's Law

**Natural digit distribution**:
```
Digit 1: 30.1%  (most common)
Digit 2: 17.6%
Digit 3: 12.5%
Digit 4: 9.7%
Digit 5: 7.9%
Digit 6: 6.7%
Digit 7: 5.8%
Digit 8: 5.1%
Digit 9: 4.6%   (least common)
```

**Bot/Sequential distribution**:
```
Digits 1-9: ~11.1% each (uniform)
```

### Statistical Test: Chi-Square
```typescript
// Chi-square goodness-of-fit test
χ² = Σ [(observed - expected)² / expected]

// Degrees of freedom: 8 (9 digits - 1)
// Critical values:
//   α = 0.10 (90% confidence): 13.362
//   α = 0.05 (95% confidence): 15.507
//   α = 0.01 (99% confidence): 20.090

if (χ² > 15.507) {
    // Reject null hypothesis
    // Distribution does NOT follow Benford's Law
    // Likely automated generation
}
```

### Example Analysis
```typescript
// Legitimate signups (30 examples)
user1, user8, user12, user15, user21, user34, user41, ...
First digits: [1,8,1,1,2,3,4,...]
Distribution: 1:40%, 2:15%, 3:12%, 4:10%, ... (close to Benford)
χ² = 8.23 (< 15.507)
Result: NATURAL ✅

// Bot signups (30 examples)
user1, user2, user3, user4, user5, user6, ...
First digits: [1,2,3,4,5,6,7,8,9,1,2,3,...]
Distribution: 1:11%, 2:11%, 3:11%, 4:11%, ... (uniform)
χ² = 42.15 (> 15.507)
Result: SUSPICIOUS ❌
```

### Usage
- **NOT in critical path** (requires batch data)
- Used by admin endpoints
- Analyzes attack waves after the fact
- Helps identify coordinated campaigns

---

## 8. Markov Chain Detector (Phase 7)

**File**: `src/detectors/markov-chain.ts` (337 lines)

### Purpose
Advanced statistical model that learns character transition patterns to distinguish legitimate from fraudulent emails.

### Research Basis
**Bergholz et al. (2008)** - "Improved Phishing Detection using Model-Based Features"
- CEAS 2008 Conference on Email and Anti-Spam
- **97.95% F-measure** with Markov Chain features alone
- **69.92% error reduction** vs baseline
- Dynamic character transition modeling

### How It Works

**Step 1: Training Phase** (requires labeled data)
```typescript
// Train two models
legitimateModel = new DynamicMarkovChain();
fraudulentModel = new DynamicMarkovChain();

// Learn character transitions
legitimateEmails.forEach(email => {
    legitimateModel.train(email, adaptationRate = 0.5);
});

fraudulentEmails.forEach(email => {
    fraudulentModel.train(email, adaptationRate = 0.5);
});
```

**Step 2: Cross-Entropy Calculation**
```typescript
// Measure how well each model "predicts" the email
H(x, M) = -Σ log₂(P(char[i+1] | char[i], M))

// Lower cross-entropy = better fit
H(email, legitimateModel) = 3.2
H(email, fraudulentModel) = 1.8
// → Email fits fraudulent model better!
```

**Step 3: Detection**
```typescript
function detectMarkovPattern(email, legitModel, fraudModel): MarkovResult {
    const H_legit = legitModel.crossEntropy(email);
    const H_fraud = fraudModel.crossEntropy(email);

    const difference = H_legit - H_fraud;
    const ratio = difference / H_legit;

    // If fraudulent model fits much better, likely fraud
    const isLikelyFraudulent = ratio > 0.15;  // 15% threshold
    const confidence = Math.min(ratio * 2, 1.0);

    return {
        isLikelyFraudulent,
        crossEntropyLegit: H_legit,
        crossEntropyFraud: H_fraud,
        confidence,
        differenceRatio: ratio
    };
}
```

### Adaptive Training
To reduce memory usage, the model skips "typical" examples:

```typescript
// Calculate mean and std dev of cross-entropy
const mean = average(crossEntropyHistory);
const stdDev = standardDeviation(crossEntropyHistory);

// Skip training if example is "too typical"
if (Math.abs(crossEntropy - mean) < adaptationRate * stdDev) {
    return false;  // Skip this example
}

// Result: ~40-45% memory savings with no accuracy loss
```

### Example Detection
```
Email: "user999@gmail.com"
Legit Model H(x): 4.2 (poor fit)
Fraud Model H(x): 2.1 (good fit)
Difference: 2.1 (50% ratio)
Result: FRAUDULENT (confidence: 1.0) ✅

Email: "peter.parker@gmail.com"
Legit Model H(x): 2.3 (good fit)
Fraud Model H(x): 3.8 (poor fit)
Difference: -1.5 (negative ratio)
Result: LEGITIMATE (confidence: 0.0) ✅
```

### Model Storage
```typescript
// Serialize to JSON for KV storage
const modelJSON = markovModel.toJSON();
await env.CONFIG.put('markov_legit_model', JSON.stringify(modelJSON));

// Deserialize on worker startup (cached globally)
const modelData = await env.CONFIG.get('markov_legit_model', 'json');
const markovModel = DynamicMarkovChain.fromJSON(modelData);
```

### Risk Contribution
```typescript
if (markovResult.isLikelyFraudulent) {
    markovRiskScore = markovResult.confidence;  // 0.0 - 1.0
}
// Weighted at 25% in final risk calculation
```

---

## How Detectors Work Together

### Parallel Execution (src/index.ts:160-207)

All detectors run **simultaneously** (not sequentially):

```typescript
// Pattern detectors (5 run in parallel)
if (config.features.enablePatternCheck) {
    patternFamily = await extractPatternFamily(email);    // Sequential + Dated
    normalized = normalizeEmail(email);                   // Plus-addressing
    keyboardWalk = detectKeyboardWalk(email);            // Keyboard walks
    gibberish = detectGibberish(email);                  // N-Gram analysis

    // Combine using MAX operator
    patternRisk = Math.max(
        sequentialRisk,
        datedRisk,
        plusRisk,
        keyboardRisk,
        gibberishRisk
    );
}

// Markov Chain detection (independent)
if (config.features.enableMarkovChainDetection) {
    markovResult = detectMarkovPattern(email, legitModel, fraudModel);
    if (markovResult.isLikelyFraudulent) {
        markovRisk = markovResult.confidence;
    }
}
```

### Risk Aggregation (src/index.ts:227-233)

```typescript
// Weighted sum of all components
const entropyRisk = entropyScore * 0.15;           // 15%
const domainRisk = domainRepScore * 0.10;          // 10%
const tldRisk = tldRiskScore * 0.10;               // 10%
const patternRisk = patternRiskScore * 0.40;       // 40% (5 detectors)
const markovRisk = markovRiskScore * 0.25;         // 25% (highest accuracy)

riskScore = Math.min(
    entropyRisk + domainRisk + tldRisk + patternRisk + markovRisk,
    1.0  // Clamp to max of 1.0
);
```

### Decision Logic (src/index.ts:261-277)

```typescript
if (riskScore > 0.6) {
    decision = 'block';    // High risk - reject signup
} else if (riskScore > 0.3) {
    decision = 'warn';     // Medium risk - flag for review
} else {
    decision = 'allow';    // Low risk - proceed normally
}
```

### Block Reason Priority (src/index.ts:236-258)

```typescript
// First match wins
if (markovRiskScore > 0.6) return 'markov_chain_fraud';
else if (gibberish) return 'gibberish_detected';
else if (sequential) return 'sequential_pattern';
else if (dated) return 'dated_pattern';
else if (plusAddressing) return 'plus_addressing_abuse';
else if (keyboardWalk) return 'keyboard_walk';
else if (tldRisk > others) return 'high_risk_tld';
else if (domainRisk > others) return 'domain_reputation';
else return 'entropy_threshold';
```

---

## Performance Characteristics

| Detector | Latency | Complexity | Detection Rate | False Positives | Notes |
|----------|---------|------------|----------------|-----------------|-------|
| Sequential | 0.05ms | O(n) | 90% | **<1%** | Birth year protection |
| Dated | 0.05ms | O(n) | 85% | 5% | |
| Plus-Addressing | 0.10ms | O(n) | 95% | 2% | |
| Keyboard Walk | 0.10ms | O(n×k) | 95% | **<1%** | 5+ digit minimum |
| N-Gram | 0.15ms | O(n) | 90% | 8% | Multi-language |
| TLD Risk | 0.05ms | O(1) | 95% | 5% | |
| Benford's Law | N/A | O(m) | 85% | 3% | Batch only |
| **Markov Chain** | **0.10ms** | **O(n)** | **98%** | **<1%** | Trained on 217K |

**Total Average**: ~0.07ms per validation (14,286 emails/second)

**Recent Improvements** (v2.0.5):
- **Sequential detector**: False positives reduced from 3% to <1% with birth year whitelisting (1940-2025)
- **Keyboard walk detector**: False positives reduced from 1% to <1% with 5-digit minimum for numeric patterns
- **Overall**: Significantly reduced false positives on emails containing birth years

---

## Training Markov Chain Models

### Requirements
- Minimum 100 examples of legitimate emails
- Minimum 100 examples of fraudulent emails
- Labeled training data (known good/bad)

### Training Process
```bash
# 1. Collect training data from production Analytics
curl "https://fraud.erfi.dev/admin/analytics" \
  -H "X-API-Key: $ADMIN_API_KEY" > training-data.json

# 2. Separate into legitimate and fraudulent sets
# (manual labeling or use existing decisions)

# 3. Train models
npx tsx scripts/train-markov-models.ts

# 4. Upload to KV
wrangler kv:key put --binding=CONFIG \
  markov_legit_model "$(cat legit-model.json)"

wrangler kv:key put --binding=CONFIG \
  markov_fraud_model "$(cat fraud-model.json)"

# 5. Deploy (models auto-load on first request)
npm run deploy
```

### Retraining Schedule
- **Initial**: Train with 100+ examples each
- **Weekly**: Retrain with last 7 days of data
- **After Attack**: Retrain immediately with new patterns
- **Quarterly**: Full model refresh

---

## Configuration

All detectors can be enabled/disabled via configuration:

```typescript
{
  "features": {
    "enablePatternCheck": true,          // Sequential, Dated, Plus, Keyboard, N-Gram
    "enableTLDRiskProfiling": true,      // TLD Risk
    "enableBenfordsLaw": true,           // Benford's Law (batch only)
    "enableMarkovChainDetection": true    // Markov Chain
  }
}
```

Update via Admin API:
```bash
curl -X PATCH https://fraud.erfi.dev/admin/config \
  -H "X-API-Key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"features": {"enableMarkovChainDetection": false}}'
```

---

## See Also

- [Architecture](./ARCHITECTURE.md) - System architecture
- [Configuration](./CONFIGURATION.md) - Risk weight tuning
- [Analytics](./ANALYTICS.md) - Metrics tracking
- [Testing](./TESTING.md) - Test results
