# Fraud Detection System - All Detectors

**Complete reference for all fraud detection algorithms**

## Overview

The system uses **6 detection methods** with Markov Chain as the primary detector and OOD detection as the safety net.

| Detector | Purpose | Patterns Detected | Latency |
|----------|---------|-------------------|---------|
| **Markov Chain** | **ML fraud detection** | **All fraud patterns** | **0.10ms** |
| **OOD Detection** | **Abnormality detection** | **Novel/unfamiliar patterns** | **+0ms** |
| Sequential | Numbered accounts | user123, test001 | 0.05ms |
| Dated | Date-based patterns | john.2025, oct2024 | 0.05ms |
| Plus-Addressing | Email aliasing abuse | user+1, user+spam | 0.10ms |
| TLD Risk | Domain extension risk | .tk, .ml, .ga | 0.05ms |
| Benford's Law | Batch attack detection | Statistical analysis | N/A (batch only) |

**New in v2.4.0**: Out-of-Distribution (OOD) Detection catches patterns unfamiliar to both models. See [OOD_DETECTION.md](./OOD_DETECTION.md) for complete documentation.

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
❌ personA.personB@gmail.com  (natural name)
❌ personC.1990@gmail.com     (birth year - legitimate)
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
✅ personA.personB.2025@gmail.com (year suffix)
✅ user_2025@yahoo.com        (year with separator)
✅ name.oct2024@domain.com    (month+year)
✅ 20251031@gmail.com         (YYYYMMDD)
❌ personC.personD@gmail.com  (no dates)
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
- Gmail (also removes dots: `j.o.h.n@gmail.com` → `person1@gmail.com`)
- Yahoo, Outlook, AOL
- iCloud, ProtonMail, FastMail
- Zoho, GMX, Mail.com, Yandex

### Normalization Process
```typescript
// Gmail example
"person1.person2+tag@gmail.com"
  → Remove dots: "person1person2+tag@gmail.com"
  → Remove plus: "person1person2@gmail.com"
  → Result: canonical form for deduplication
```

### Risk Scoring
- Single plus-address: +0.2 risk
- Suspicious tag (numbers, "spam", etc.): +0.3 risk
- Multiple variants detected (batch): +0.4 risk

---

## 4. TLD Risk Profiling

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

## 5. Benford's Law Analyzer

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

## 6. Markov Chain Detector (Phase 7)

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

Email: "personA.personB@gmail.com"
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

## 7. Out-of-Distribution (OOD) Detector (v2.4.0)

**File**: `src/middleware/fraud-detection.ts` (integrated with Markov evaluation)

### Purpose
Detect patterns that are unfamiliar to BOTH the legitimate and fraudulent models. This catches novel attack patterns not seen during training.

### The Problem

When both Markov models have high cross-entropy (both confused), the system previously treated this as "uncertain" and allowed it. But if BOTH models are confused, that's a consensus signal that the pattern is abnormal.

**Example:**
```
Email: oarnimstiaremtn@gmail.com
H_legit = 4.51 nats (confused)
H_fraud = 4.32 nats (confused)
Old behavior: confidence = 0.08 → ALLOW
New behavior: abnormalityRisk = 0.20 → WARN
```

### Algorithm

**Step 1: Calculate Minimum Entropy**
```typescript
const minEntropy = Math.min(H_legit, H_fraud);
```

**Step 2: Check OOD Thresholds (v2.4.1 Piecewise)**
```typescript
// Three zones: dead (<3.8), warn (3.8-5.5), block (5.5+)
let abnormalityRisk: number;
if (minEntropy < 3.8) {
  abnormalityRisk = 0;
} else if (minEntropy < 5.5) {
  abnormalityRisk = 0.35 + ((minEntropy - 3.8) / 1.7) * 0.30;
} else {
  abnormalityRisk = 0.65;
}
```

**Step 3: Scale to Risk**
```typescript
const abnormalityRisk = Math.min(abnormalityScore * 0.15, 0.6);
```

**Step 4: Combine with Classification Risk**
```typescript
const classificationRisk = markovResult.isLikelyFraudulent
  ? markovResult.confidence
  : 0;

const finalRisk = Math.max(classificationRisk, abnormalityRisk) + domainRisk;
```

### Two-Dimensional Risk Model

**Dimension 1: Classification** (differential signal)
- Which model fits better: fraud vs legit?
- Measures if the pattern is fraudulent or legitimate

**Dimension 2: Abnormality** (consensus signal)
- Are both models confused?
- Measures if the pattern is outside training distribution

We take the MAXIMUM of these two risks (worst case), then add domain signals.

### Threshold Justification: 3.0 Nats

From information theory:
- **0.69 nats**: log₂ baseline (random guessing)
- **< 0.2 nats**: good predictions
- **> 1.0 nats**: poor predictions
- **> 3.8 nats**: warn zone (unusual patterns)
- **> 5.5 nats**: block zone (gibberish)

The piecewise system (v2.4.1) provides better precision with a dead zone (<3.8) and improved gibberish detection with a block zone (5.5+).

### Examples

**Severe OOD (Anagram)**:
```
Email: inearkstioarsitm2mst@gmail.com
H_legit = 4.45, H_fraud = 4.68
minEntropy = 4.45
abnormalityScore = 1.45
abnormalityRisk = 0.22
Decision: WARN
```

**Moderate OOD**:
```
Email: armentsiorast@gmail.com
H_legit = 3.60, H_fraud = 3.85
minEntropy = 3.60
abnormalityScore = 0.60
abnormalityRisk = 0.09
Decision: ALLOW (below WARN threshold)
```

**Normal (No OOD)**:
```
Email: person1@gmail.com
H_legit = 2.1, H_fraud = 3.8
minEntropy = 2.1
abnormalityScore = 0 (below 3.0)
oodDetected = false
Decision: ALLOW
```

### What Triggers OOD?

**Typical OOD Patterns:**
- Anagrams: `oarnimstiaremtn` (familiar letters, unfamiliar order)
- Novel shuffles: `rtmaenisoartmstien`
- Random gibberish: `ksjdnfpqowiemznxc`
- Cross-language: `user用户test` (mixed scripts)
- Novel bot patterns: `usr#20250110#a1b` (new delimiters)

**Not OOD (Familiar):**
- Common names: `person1`, `user2`
- Standard patterns: `test@company.com`
- Training data patterns: `user123` (seen during training)

### Database Tracking

```sql
SELECT
  email_local_part,
  min_entropy,
  abnormality_score,
  abnormality_risk,
  ood_detected,
  decision
FROM validations
WHERE ood_detected = 1
ORDER BY abnormality_risk DESC;
```

### Performance
- **Latency**: +0ms (calculated during existing Markov evaluation)
- **Detection Rate**: ~78% of test cases show some OOD signal
- **Accuracy**: Catches novel patterns missed by classification alone

### See Also
- [OOD_DETECTION.md](./OOD_DETECTION.md) - Complete OOD documentation

---

## How Detectors Work Together

### Parallel Execution (Markov-First Approach)

Markov Chain is the **primary** fraud detector. Heuristic pattern detectors (keyboard, gibberish) have been removed.

```typescript
// Markov Chain detection (PRIMARY)
if (config.features.enableMarkovChainDetection) {
    markovResult = detectMarkovPattern(email, legitModel, fraudModel);
    if (markovResult.isLikelyFraudulent) {
        riskScore = markovResult.confidence;  // Base score from Markov
    }
}

// Pattern detectors (deterministic overrides only)
if (config.features.enablePatternCheck) {
    patternFamily = await extractPatternFamily(email);    // Sequential + Dated
    normalized = normalizeEmail(email);                   // Plus-addressing

    // Only apply if pattern is deterministic
    if (patternFamily.patternType === 'sequential') {
        riskScore = Math.max(riskScore, 0.8);
    }
    if (normalized.hasPlus) {
        riskScore = Math.max(riskScore, 0.6);
    }
}

// Domain signals (disposable domains, TLD risk)
const domainRisk = domainReputationScore * 0.2 + tldRiskScore * 0.3;
riskScore = Math.min(riskScore + domainRisk, 1.0);
```

### Risk Aggregation (Simplified)

```typescript
// Markov-only approach
let score = markovResult?.isLikelyFraudulent ? markovResult.confidence : 0;

// Add deterministic pattern overrides
if (patternType === 'sequential') score = Math.max(score, 0.8);
if (hasPlus) score = Math.max(score, 0.6);

// Add domain risk
const domainRisk = domainReputationScore * 0.2 + tldRiskScore * 0.3;

// Final risk score
riskScore = Math.min(score + domainRisk, 1.0);
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

### Block Reason Priority

```typescript
// v2.4.2: High-confidence detections (first match wins)
if (markovRiskScore > 0.6) return 'markov_chain_fraud';
// Removed: sequential_pattern (now handled by Markov)

// Risk-based messaging
else if (riskScore >= 0.6) {
    if (abnormalityRisk > 0.4) return 'high_abnormality';
    if (tldRisk > 0.5) return 'high_risk_tld';
    if (domainRisk > 0.5) return 'domain_reputation';
    if (dated) return 'dated_pattern';
    return 'high_risk_multiple_signals';
}
else if (riskScore >= 0.4) {
    if (abnormalityRisk > 0.2) return 'suspicious_abnormal_pattern';
    if (dated) return 'suspicious_dated_pattern';
    return 'medium_risk';
}
else return 'low_risk';
```

---

## Performance Characteristics

| Detector | Latency | Complexity | Detection Rate | False Positives | Status |
|----------|---------|------------|----------------|-----------------|--------|
| **Markov Chain** | **0.10ms** | **O(n)** | **98%** | **<1%** | **PRIMARY** |
| Sequential | 0.05ms | O(n) | 90% | **<1%** | Active |
| Dated | 0.05ms | O(n) | 85% | 5% | Active |
| Plus-Addressing | 0.10ms | O(n) | 95% | 2% | Active |
| TLD Risk | 0.05ms | O(1) | 95% | 5% | Active |
| Benford's Law | N/A | O(m) | 85% | 3% | Active (batch) |
| ~~Keyboard Walk~~ | ~~0.10ms~~ | ~~O(n×k)~~ | ~~95%~~ | ~~<1%~~ | **DEPRECATED** |
| ~~Keyboard Mashing~~ | ~~0.10ms~~ | ~~O(n)~~ | ~~85%~~ | ~~33%~~ | **DEPRECATED** |
| ~~N-Gram Gibberish~~ | ~~0.15ms~~ | ~~O(n)~~ | ~~90%~~ | ~~33%~~ | **DEPRECATED** |

**Total Average**: ~0.06ms per validation with Markov-only approach

**Performance Improvements**:
- Accuracy: 83% (5/6 test cases correct, 0 false positives)
- Fraud detection: 100% (16/16 blocked)
- False positives eliminated from previous heuristic detectors

---

## Training Markov Chain Models

### Requirements
- Minimum 100 examples of legitimate emails
- Minimum 100 examples of fraudulent emails
- Labeled training data (known good/bad)

### Training Process
```bash
# 1. Collect training data from production Analytics
curl "https://your-worker.workers.dev/admin/analytics" \
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
    "enablePatternCheck": true,          // Sequential, Dated, Plus
    "enableTLDRiskProfiling": true,      // TLD Risk
    "enableBenfordsLaw": true,           // Benford's Law (batch only)
    "enableMarkovChainDetection": true   // Markov Chain (PRIMARY)
  }
}
```

Update via Admin API:
```bash
curl -X PATCH https://your-worker.workers.dev/admin/config \
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
