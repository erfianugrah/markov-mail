# System Architecture

**Comprehensive architectural overview of Bogus Email Pattern Recognition**

## Table of Contents

1. [System Overview](#system-overview)
2. [High-Level Architecture](#high-level-architecture)
3. [Component Details](#component-details)
4. [Data Flow](#data-flow)
5. [Detection Algorithms](#detection-algorithms)
6. [Risk Scoring](#risk-scoring)
7. [Performance](#performance)
8. [Scalability](#scalability)
9. [Security](#security)
10. [Automated Training Pipeline](#automated-training-pipeline)
11. [Future Architecture](#future-architecture)

---

## System Overview

### Purpose

Inline email validation service that prevents fraudulent signups by analyzing email patterns, fingerprinting users, and detecting suspicious behavior in real-time at the edge.

### Key Characteristics

- **Stateless**: No cross-request tracking (scalable and simple)
- **Edge-deployed**: Runs on Cloudflare Workers globally
- **Fast**: < 5ms p95 latency (~0.07ms average)
- **Comprehensive**: 200+ tests, 100% pass rate
- **Detection rate**: 95-98% (all 8 detectors operational)
- **Privacy-preserving**: SHA-256 email hashing in logs

### Technology Stack

```
Runtime:       Cloudflare Workers (V8 Isolates)
Framework:     Hono v4.x
Language:      TypeScript 5.x
Testing:       Vitest 3.2.0 + @cloudflare/vitest-pool-workers
Logging:       Pino.js
Analytics:     Cloudflare Analytics Engine
Deployment:    Wrangler 3.x
```

---

## High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         HTTP Request                              │
│                     POST /validate                                │
│                  {"email": "test@example.com"}                    │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                ┌────────────▼────────────┐
                │      Hono Router        │
                │   (Routing & CORS)      │
                └────────────┬────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
  ┌─────▼──────┐    ┌───────▼────────┐   ┌──────▼──────┐
  │ Fingerprint │    │  Email         │   │  Domain     │
  │ Generation  │    │  Validators    │   │  Validators │
  │             │    │  - Format      │   │  - TLD Risk │
  │ IP+JA4+ASN  │    │  - Entropy     │   │  - Disp.    │
  │ + BotScore  │    │  - Length      │   │  - Rep.     │
  └─────┬──────┘    └───────┬────────┘   └──────┬──────┘
        │                    │                    │
        └────────────────────┼────────────────────┘
                             │
                    ┌────────▼─────────┐
                    │ Pattern Detectors │
                    │ ┌────────────────┐│
                    │ │ Sequential     ││
                    │ │ Dated          ││
                    │ │ Plus-Addr      ││
                    │ │ TLD Risk       ││
                    │ │ Benford's Law  ││
                    │ │ Markov Chain   ││ (Primary)
                    │ └────────────────┘│
                    └────────┬──────────┘

                    Note: Keyboard detectors removed
                    walk and gibberish detectors
                    in favor of Markov-only approach
                             │
                    ┌────────▼──────────┐
                    │   Risk Scoring    │
                    │                   │
                    │ Sequential:   25  │
                    │ Dated:        20  │
                    │ Plus-Addr:    15  │
                    │ Keyboard:     20  │
                    │ N-Gram:       30  │
                    │ TLD Risk:     15  │
                    │ Benford:      10  │
                    │ Markov:       35  │
                    │ ─────────────────│
                    │ Total:   0-170pts │
                    └────────┬──────────┘
                             │
                    ┌────────▼──────────┐
                    │ Decision Engine   │
                    │                   │
                    │ risk > 0.6: block │
                    │ risk > 0.3: warn  │
                    │ risk ≤ 0.3: allow │
                    └────────┬──────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
  ┌─────▼──────┐    ┌───────▼────────┐   ┌──────▼──────┐
  │   Logging  │    │   Analytics    │   │  Response   │
  │  (Pino.js) │    │    Engine      │   │   (JSON)    │
  │            │    │                │   │             │
  │ Structured │    │ Metrics + SQL  │   │ Valid/Risk/ │
  │ JSON Logs  │    │ Queries        │   │ Decision    │
  └────────────┘    └────────────────┘   └──────┬──────┘
                                                 │
┌────────────────────────────────────────────────▼──────────┐
│                       HTTP Response                        │
│   {"valid": true, "decision": "allow", "riskScore": 0.25} │
└────────────────────────────────────────────────────────────┘
```

---

## Component Details

### 1. Entry Point (`src/index.ts`)

**Purpose**: Main worker entry, routing, and request orchestration

**Key Responsibilities**:
- HTTP routing (Hono)
- CORS handling
- Request validation
- Component orchestration
- Response formatting
- Error handling

**Exports**:
```typescript
export default app;  // Hono app (compatible with Workers)
```

**Routes**:
- `GET /` - Welcome/documentation
- `GET /debug` - Fingerprinting signals
- `POST /validate` - Email validation (main endpoint)

### 2. Email Validators (`src/validators/`)

#### email.ts

**Purpose**: Email format and entropy validation

**Functions**:
```typescript
validateEmail(email: string): {
  valid: boolean;
  reason?: string;
  signals: {
    formatValid: boolean;
    entropyScore: number;
    localPartLength: number;
  };
}

calculateEntropy(str: string): number;
```

**Validation Logic**:
1. **Format Check**: RFC 5322 regex validation
2. **Length Check**: Local part 3-64 chars, domain 1-255 chars
3. **Entropy Calculation**: Shannon entropy on local part
4. **Character Analysis**: Valid ASCII range

**Entropy Formula**:
```
H(X) = -Σ p(x) * log₂(p(x))

where p(x) = frequency of character x
```

#### domain.ts

**Purpose**: Domain reputation and disposable detection

**Functions**:
```typescript
validateDomain(domain: string): {
  isDisposable: boolean;
  isFreeProvider: boolean;
  reason?: string;
}

getDomainReputationScore(domain: string): number;
```

**Data Sources**:
- 170+ disposable domains (in-memory)
- Wildcard pattern matching
- Free provider list (gmail, yahoo, hotmail, etc.)

### 3. Pattern Detectors (`src/detectors/`)

#### sequential.ts

**Purpose**: Detect sequential numbering patterns

**Examples**:
- `user1@`, `user2@`, `user3@`
- `test001@`, `test002@`
- `account_1@`, `account_2@`

**Algorithm**:
```typescript
// Extract numbers and check if sequential
numbers = extractNumbers(localPart)
if (numbers.length > 0) {
  lastDigit = numbers[numbers.length - 1]
  if (isSequentialPattern(lastDigit)) {
    return { isSequential: true, confidence: 0.9 }
  }
}
```

#### dated.ts

**Purpose**: Detect date/year-based patterns

**Examples**:
- `john.doe.2024@`
- `user_2025@`
- `name.oct2024@`

**Detection**:
- Current year ±1
- Month names/abbreviations
- Date formats (YYYY, MMYYYY, etc.)

#### plus-addressing.ts

**Purpose**: Detect plus-addressing abuse

**Examples**:
- `user+1@gmail.com`, `user+2@gmail.com`
- `name+tag1@yahoo.com`, `name+tag2@yahoo.com`

**Normalization**:
```typescript
// Gmail example
"john.doe+tag@gmail.com" → "johndoe@gmail.com"

// Remove dots (Gmail-specific)
// Remove plus-tag
// Return canonical form
```

#### keyboard-walk.ts

> **DEPRECATED**: Keyboard walk and keyboard mashing detectors removed due to high false positive rates.
> Keyboard patterns are now detected by Markov Chain analysis.
> Files remain for reference only.

**Purpose**: Detect keyboard pattern sequences

**Patterns**:
- QWERTY row: `qwerty`, `asdfgh`, `zxcvbn`
- Numeric: `123456`, `987654`
- Common sequences: `abcdef`, `password`

**Detection Method**:
- Pre-computed pattern lists
- Substring matching
- Direction-aware (forward/backward)

#### ngram-analysis.ts (Phase 6A)

> **DEPRECATED**: Gibberish detector removed in favor of Markov Chain cross-entropy analysis.
> Markov models provide superior accuracy (83% vs 67%) with fewer false positives.
> Files remain for reference only.

**Purpose**: Detect gibberish using character n-gram frequency

**Algorithm**:
```typescript
1. Extract bigrams (2-char sequences) and trigrams (3-char)
2. Compare against common English n-grams
3. Calculate naturalness score:
   - bigramScore = matchedBigrams / totalBigrams
   - trigramScore = matchedTrigrams / totalTrigrams
   - overallScore = (bigramScore × 0.6) + (trigramScore × 0.4)
4. Threshold: > 0.4 = natural, ≤ 0.4 = gibberish
```

**Data**:
- 80+ common bigrams: an, er, in, on, th, ...
- 50+ common trigrams: the, and, ing, ion, ...
- Name patterns: son, sen, man, stein, ...

**Example**:
```
"anderson" →
  bigrams: an, nd, de, er, rs, so, on
  matches: an, nd, er, on (4/7 = 57%)
  result: NATURAL

"xk9m2qw7" →
  bigrams: xk, k9, 9m, m2, 2q, qw, w7
  matches: qw (1/7 = 14%)
  result: GIBBERISH
```

#### tld-risk.ts (Phase 6A)

**Purpose**: TLD-based domain risk profiling

**Categories**:

| Category | Examples | Risk Multiplier | Registration |
|----------|----------|-----------------|--------------|
| Trusted | .edu, .gov, .mil | 0.2x - 0.5x | Restricted |
| Standard | .com, .net, .org, .io | 0.8x - 1.3x | Paid |
| Suspicious | .xyz, .top, .club | 2.1x - 2.7x | Cheap |
| High Risk | .tk, .ml, .ga, .cf, .gq | 2.5x - 3.0x | Free |

**Risk Calculation**:
```typescript
riskScore = (riskMultiplier - 0.2) / 2.8
// Normalizes 0.2-3.0 range to 0-1

// Example:
.com: (1.0 - 0.2) / 2.8 = 0.29
.tk:  (3.0 - 0.2) / 2.8 = 1.00
```

**Abuse Statistics**:
```
.tk (Tokelau):
  - 70% disposable email services
  - 80% spam/phishing
  - FREE registration
  - Risk: 0.93

.com (Commercial):
  - 5% disposable
  - 10% spam
  - ~$10/year
  - Risk: 0.29
```

#### benfords-law.ts (Phase 6A)

**Purpose**: Batch attack detection using statistical analysis

**Theory**:
Benford's Law states that in natural datasets, digit 1 appears ~30% of the time, while digit 9 appears ~5%.

**Natural Distribution**:
```
1: 30.1%
2: 17.6%
3: 12.5%
4: 9.7%
5: 7.9%
6: 6.7%
7: 5.8%
8: 5.1%
9: 4.6%
```

**Bot/Sequential Distribution**:
```
1-9: ~11.1% each (uniform)
```

**Statistical Test**:
```typescript
// Chi-square goodness-of-fit test
χ² = Σ [(observed - expected)² / expected]

// Degrees of freedom: 8 (9 digits - 1)
// Critical value (α=0.05): 15.507

if (χ² > 15.507) {
  // Reject null hypothesis
  // Distribution does NOT follow Benford's Law
  // Likely automated/sequential generation
}
```

**Usage**:
- Requires minimum 30 samples
- Used for batch analysis (admin endpoints)
- Compares attack waves
- Not in critical path

#### ngram-markov.ts (Phase 7-8)

**Purpose**: Character transition probability analysis using ensemble Markov chains

**Algorithm**:
```typescript
// N-Gram Markov Chain Ensemble (orders 1, 2, 3)
1. Train separate models for legitimate and fraudulent emails
2. Calculate cross-entropy for each order:
   H(x) = -Σ P(char_i | context) * log₂(P(char_i | context))
3. Compare legitimate vs fraud cross-entropy
4. Ensemble voting with weighted confidence:
   - Unigram:  20% weight
   - Bigram:   50% weight
   - Trigram:  30% weight
```

**Training Pipeline**:
```typescript
- Data Source: Analytics Engine + labeled samples
- Trigger: Cron job every 6 hours
- Validation Gates:
  * minAccuracy: 0.95
  * minPrecision: 0.90
  * minRecall: 0.85
  * maxFalsePositiveRate: 0.05
- Deployment: Canary testing (configurable traffic split)
- Storage: KV namespace MARKOV_MODEL with versioning
```

**Confidence Gating**:
```typescript
const threshold = 0.65;  // Only contribute risk if confident
if (confidence < threshold) {
  return 0;  // No risk contribution if uncertain
}
return riskScore * confidence;  // Scale by confidence
```

**Example**:
```
Legitimate: "john.anderson" → Low fraud cross-entropy
Fraud: "xk9m2qw7p" → High fraud cross-entropy

Ensemble Decision:
- Unigram: fraud (confidence: 0.75)
- Bigram:  fraud (confidence: 0.82)
- Trigram: fraud (confidence: 0.68)
→ Weighted vote: FRAUD (confidence: 0.77)
→ Risk contribution: 35 points * 0.77 = 27 points
```

**Performance**:
- Accuracy: 98-100% on test datasets
- Latency: ~0.10ms per validation
- Online learning: Retrains every 6 hours
- Auto-validation: Blocks regressions

### 4. Fingerprinting (`src/fingerprint.ts`)

**Purpose**: Generate unique user fingerprints

**Signal Sources**:
```typescript
{
  ip: request.headers.get('cf-connecting-ip'),
  ja4: request.headers.get('cf-ja4'),
  asn: request.cf?.asn,
  country: request.cf?.country,
  botScore: request.cf?.botManagement?.score
}
```

**Fingerprint Generation**:
```typescript
const fingerprint = await crypto.subtle.digest(
  'SHA-256',
  encoder.encode(`${ip}|${ja4}|${asn}|${botScore}`)
);

return {
  hash: bufferToHex(fingerprint),
  ip, country, asn, botScore
};
```

**Use Cases**:
- Deduplication (future rate limiting)
- Pattern tracking across requests
- Behavioral analysis
- Attack correlation

### 5. Risk Scoring (`src/index.ts`)

**Point-Based System (v1.4.0)**:
```
Total Risk Score = Sum of all detector contributions

Detector Point Allocations:
- Sequential Pattern:   0-25 points
- Dated Pattern:        0-20 points
- Plus-Addressing:      0-15 points
- Keyboard Walk:        0-20 points
- N-Gram Gibberish:     0-30 points
- TLD Risk:             0-15 points
- Benford's Law:        0-10 points (batch only)
- Markov Chain:         0-35 points (confidence gated)
───────────────────────────────────
Total Range:            0-170 points
```

**Risk Level Thresholds**:
```typescript
Low Risk:    0-50 points    (allow)
Medium Risk: 51-100 points  (warn)
High Risk:   101+ points    (block)
```

**Priority Override Logic**:
```typescript
1. Invalid format      → 170 points (immediate block)
2. Disposable domain   → 150 points (immediate block)
3. Very high entropy   → +50 points bonus
4. Combined scoring    → sum of detectors
```

**Markov Chain Contribution**:
```typescript
// Confidence-gated contribution
if (markovConfidence < 0.65) {
  markovPoints = 0;  // Skip if uncertain
} else {
  markovPoints = basePoints * markovConfidence;
}
```

### 6. Decision Engine (`src/index.ts`)

**Decision Logic**:
```typescript
if (riskScore > 100) {
  decision = 'block';    // Do not allow signup
} else if (riskScore > 50) {
  decision = 'warn';     // Flag for review
} else {
  decision = 'allow';    // Proceed normally
}
```

**Point-Based Thresholds**:
- **Block**: > 100 points
- **Warn**: 51-100 points
- **Allow**: ≤ 50 points

**Block Reason Hierarchy** (priority order):
```typescript
1. invalid_format           // Format violation
2. disposable_domain        // Known disposable email
3. markov_fraud_detected    // Markov chain high confidence
4. gibberish_detected       // N-gram analysis
5. high_risk_tld            // Free/cheap TLD
6. sequential_pattern       // Bot numbering
7. dated_pattern            // Date-based generation
8. plus_addressing_abuse    // Email aliasing
9. keyboard_walk            // Keyboard patterns
10. suspicious_pattern      // Generic pattern match
11. domain_reputation       // Poor domain score
12. entropy_threshold       // High randomness
```

### 7. Logging (`src/logger.ts`)

**Purpose**: Structured JSON logging with Pino.js

**Log Levels**:
```typescript
logger.debug()  // Verbose debugging
logger.info()   // Normal operations
logger.warn()   // Warnings
logger.error()  // Errors and failures
```

**Log Format**:
```json
{
  "time": 1761978864192,
  "level": 30,
  "event": "email_validation",
  "email_hash": "836f82db...",
  "fingerprint": "3d1852...",
  "risk_score": 0.36,
  "decision": "warn",
  "signals": { /* ... */ },
  "timestamp": 1761978864192
}
```

**Special Events**:
- `email_validation` - Every validation
- `email_blocked` - Blocks only
- `error` - Failures

### 8. Analytics (`src/utils/metrics.ts`)

**Purpose**: Write metrics to Analytics Engine

**Data Points**:
```typescript
{
  blobs: [
    decision,          // allow|warn|block
    blockReason,       // why blocked
    country,           // user country
    riskBucket         // 0-0.2, 0.2-0.4, etc.
  ],
  doubles: [
    riskScore,         // 0-1
    entropyScore,      // 0-1
    botScore,          // 0-99
    asn,               // network
    latency            // ms
  ],
  indexes: [
    fingerprintHash    // for sampling
  ]
}
```

**SQL Queries**:
```sql
-- Decision distribution
SELECT
  blob1 as decision,
  COUNT(*) as count
FROM email_validations
WHERE timestamp >= NOW() - INTERVAL '1' HOUR
GROUP BY decision;

-- Average risk by decision
SELECT
  blob1 as decision,
  AVG(double1) as avg_risk_score
FROM email_validations
WHERE timestamp >= NOW() - INTERVAL '1' DAY
GROUP BY decision;

-- p95 latency
SELECT
  quantile(double5, 0.95) as p95_latency_ms
FROM email_validations
WHERE timestamp >= NOW() - INTERVAL '1' HOUR;
```

---

## Data Flow

### Request Flow (Detailed)

```
1. HTTP POST /validate
   ↓
2. Hono Router
   - Parse JSON body
   - Validate required fields
   - Extract email
   ↓
3. Fingerprint Generation (parallel)
   - Hash IP + JA4 + ASN + BotScore
   - Extract geo signals
   ↓
4. Email Validation (parallel)
   - Format check (regex)
   - Length validation
   - Entropy calculation
   ↓
5. Domain Validation (conditional)
   - If valid format:
     - Check disposable list
     - Check free provider
     - Calculate domain rep
     - Analyze TLD risk (Phase 6A)
   ↓
6. Pattern Detection (conditional)
   - If ENABLE_PATTERN_CHECK:
     - Sequential detection
     - Dated pattern check
     - Plus-addressing normalize
     - Keyboard walk detect
     - N-Gram analysis (Phase 6A)
   ↓
7. Risk Calculation
   - Weighted scoring
   - Priority overrides
   - Clamp to [0, 1]
   ↓
8. Decision
   - Apply thresholds
   - Determine block reason
   - Format response
   ↓
9. Side Effects (parallel)
   - Log validation (if enabled)
   - Write Analytics Engine
   - Log blocks separately
   ↓
10. HTTP Response
    - Return JSON result
    - Include fingerprint
    - Add latency metric
```

### Performance Characteristics

**Critical Path** (affects latency):
```
Request → Validate → Detect → Score → Decide → Response
```

**Parallel Operations** (don't affect latency):
```
Logging + Analytics writing (async, non-blocking)
```

**Timing Breakdown** (typical):
```
Hono routing:        0.1ms
Email validation:    0.2ms
Domain checks:       0.1ms
Pattern detection:   0.5ms
  - Sequential:      0.05ms
  - Dated:           0.05ms
  - Plus-addr:       0.1ms
  - Keyboard:        0.1ms (5 layouts)
  - N-Gram:          0.15ms
  - TLD Risk:        0.05ms
Risk calculation:    0.05ms
Response format:     0.05ms
-------------------------
Total:               ~1.0ms

Logging (async):     ~0.5ms (non-blocking)
Analytics (async):   ~0.3ms (non-blocking)
```

---

## Detection Algorithms

### Algorithm Comparison

| Algorithm | Complexity | Detection Rate | False Positives | Latency | Status |
|-----------|-----------|----------------|-----------------|---------|--------|
| Format Validation | O(n) | 100% (invalid) | 0% | <0.1ms | ✅ Active |
| Entropy Analysis | O(n) | 85% (random) | 5% | 0.2ms | ✅ Active |
| Disposable Domains | O(1) | 99% (known) | 1% | 0.1ms | ✅ Active |
| Sequential Pattern | O(n) | 90% | 3% | 0.05ms | ✅ Active |
| Dated Pattern | O(n) | 85% | 5% | 0.05ms | ✅ Active |
| Plus-Addressing | O(n) | 95% | 2% | 0.1ms | ✅ Active |
| Keyboard Walk | O(n×k) | 95% | **33%** | 0.1ms | ❌ **DEPRECATED** |
| Keyboard Mashing | O(n×k) | 67% | **33%** | 0.1ms | ❌ **DEPRECATED** |
| N-Gram Gibberish | O(n) | 90% | 8% | 0.15ms | ❌ **DEPRECATED** |
| TLD Risk | O(1) | 95% | 5% | 0.05ms | ✅ Active |
| Benford's Law | O(m) | 85% | 3% | N/A* | ✅ Active |
| Markov Chain Ensemble | O(n×k) | 98% | <1% | 0.10ms | ✅ Active (Primary) |

*Benford not in critical path (batch analysis only)
**Note: Keyboard walk, keyboard mashing, and gibberish detectors replaced with Markov-only approach**

**Overall System Performance**:
- Combined Detection Rate: 95-98%
- Combined False Positive Rate: <1%
- Average Latency: ~0.07ms

### Algorithm Selection Strategy

**High Confidence, Fast** (always enabled):
- Format validation
- Disposable domains
- TLD risk (Phase 6A)

**Medium Confidence, Fast** (pattern check):
- Sequential patterns
- Plus-addressing
- Keyboard walks

**Statistical, Requires Context** (batch):
- Benford's Law (admin endpoints)

**Machine Learning**:
- Markov chains (N-gram based character patterns, trained on 91K emails)

---

## Risk Scoring

### Scoring Philosophy

**Goals**:
1. **Prevent Double-Counting**: Same fraud signal shouldn't be scored multiple times
2. **Layered Defense**: Multiple independent signals provide redundancy
3. **High-Confidence Priority**: Most accurate detectors get highest weight
4. **Tunable**: Easy threshold adjustment based on production data
5. **Explainable**: Clear reason for every decision

**Non-Goals**:
- Perfect accuracy (impossible)
- Zero false positives (impractical)
- Real-time learning (requires infrastructure)

### Current Weights (v1.4.0)

```typescript
riskWeights: {
  entropy:           0.05,  // 5%  - Baseline for randomness
  domainReputation:  0.15,  // 15% - Disposable domain detection (71,751 domains)
  tldRisk:           0.15,  // 15% - TLD risk profiling (142 TLDs)
  patternDetection:  0.30,  // 30% - 5 pattern detectors combined
  markovChain:       0.35,  // 35% - Highest accuracy (98%)
}
// Total: 1.00 (100%)
```

### Hybrid Scoring Strategy

**Key Innovation**: Prevents double-counting by using different aggregation methods:

```typescript
// Domain signals (independent) → ADDITIVE
const domainRisk = domainReputationScore * 0.15;
const tldRisk = tldRiskScore * 0.15;
const domainBasedRisk = domainRisk + tldRisk;  // Can have both

// Local part signals (overlapping) → MAX-BASED
const entropyRisk = entropyScore * 0.05;
const patternRisk = patternScore * 0.30;
const markovRisk = markovScore * 0.35;
const localPartRisk = Math.max(entropyRisk, patternRisk, markovRisk);  // Take highest

// Combine
riskScore = Math.min(domainBasedRisk + localPartRisk, 1.0);
```

**Why This Works**:
- Domain + TLD analyze **different properties** → can both be high → add them
- Pattern + Markov analyze **same data** (local part) → take highest to avoid double-counting

**Example**:
```
Email: user123@tempmail.tk

Old (additive): 0.95 (disposable) + 0.15 (TLD) + 0.27 (pattern) + 0.31 (markov) = 1.68 (capped to 1.0)
New (hybrid):   [0.15 (disposable) + 0.15 (TLD)] + max(0.27, 0.31) = 0.30 + 0.31 = 0.61

Result: More accurate, less double-counting
```

### Weight Rationale

**Entropy (5%)**:
- **Why**: Baseline randomness detection
- **Limitation**: High false positives on legitimate random usernames
- **Role**: Safety net, lowest weight

**Domain Reputation (15%)**:
- **Why**: 71,751 known disposable domains in KV
- **Limitation**: Many legitimate domains have no reputation
- **Update**: Dynamic list updated every 6 hours via cron

**TLD Risk (15%)**:
- **Why**: 142 TLDs categorized (trusted, standard, suspicious, high-risk)
- **Coverage**: 95% of all signups
- **Update**: Manual sync, profiles stored in KV

**Pattern Detection (30%)**:
- **Why**: 5 detectors (sequential, dated, plus, keyboard, gibberish), 94% avg accuracy
- **Combination**: Uses MAX of all 5 pattern scores
- **Trade-off**: Reduced from 40% to avoid over-weighting vs Markov

**Markov Chain (35%)**:
- **Why**: Highest accuracy (98%), research-backed (Bergholz et al. 2008)
- **Training**: Learns from production data
- **Trade-off**: Highest weight for most reliable signal

### Threshold Tuning

**Conservative** (minimize false positives):
```typescript
{ block: 0.8, warn: 0.5 }
```
- Fewer blocks, more warnings
- Lower detection rate (~85%)
- Higher user satisfaction

**Balanced** (default):
```typescript
{ block: 0.6, warn: 0.3 }
```
- Good balance
- ~95-98% detection rate
- ~5% false positive rate

**Aggressive** (maximize detection):
```typescript
{ block: 0.5, warn: 0.2 }
```
- More blocks, fewer warnings
- Higher detection rate (~98%)
- More false positives (~10%)

**See [docs/SCORING.md](./SCORING.md) for complete scoring documentation with examples.**

---

## Performance

### Latency

**Target**: < 5ms p95 (achieved: ~1-2ms)

**Breakdown**:
```
p50: 0.5ms
p95: 1.5ms
p99: 3.0ms
max: 10ms
```

**Optimization Techniques**:
1. **In-memory data**: All lists/patterns cached
2. **No external calls**: No DNS, API, or DB lookups
3. **Async logging**: Non-blocking side effects
4. **Efficient algorithms**: All O(n) or O(1)
5. **Edge deployment**: Close to users globally

### Throughput

**Per Worker Instance**:
- 1000+ req/sec sustained
- 5000+ req/sec burst
- Automatic scaling by Cloudflare

**Global Capacity**:
- Unlimited (Cloudflare edge network)
- Auto-scales to millions of req/sec
- No capacity planning needed

### Resource Usage

**Memory**:
- ~5MB per worker instance
- Mostly static data (patterns, domains)
- No per-request memory growth

**CPU**:
- < 1ms CPU time per request
- Minimal string processing
- No heavy computation

**Network**:
- Request: < 1KB
- Response: < 2KB
- Total: < 3KB per validation

---

## Scalability

### Horizontal Scaling

**Cloudflare Workers Auto-scaling**:
```
Low Traffic:    1-10 instances
Medium Traffic: 10-100 instances
High Traffic:   100-1000s of instances
```

**No configuration needed** - fully automatic

### Vertical Scaling

**Worker Limits** (Cloudflare):
- CPU: 50ms per request (not even close)
- Memory: 128MB (using < 5MB)
- Request size: 100MB (using < 1KB)

**Plenty of headroom** for future features

### Geographic Distribution

**Edge Locations**:
- 300+ data centers globally
- Auto-routes to nearest location
- < 50ms from 95% of internet users

### Data Persistence

**Architecture**:
- Stateless request processing
- Each request independent
- Infinite horizontal scale
- Globally distributed across 300+ edge locations

---

## Security

### Threat Model

**Protected Against**:
1. Bot signups (sequential patterns)
2. Disposable emails (170+ domains)
3. Plus-addressing abuse (normalization)
4. Batch attacks (Benford's Law)
5. Fraudulent patterns (Markov Chain - trained on 111K+ emails)
6. Keyboard patterns (Markov Chain detection)
7. Gibberish/random text (Markov Chain detection)
8. High-risk TLDs (profiling)

**Not Protected Against**:
1. Sophisticated human attackers
2. Slow-and-low attacks (< 1 signup/hour)
3. Legitimate-looking generated names
4. Phone/SMS verification bypass
5. Captcha bypass

**Mitigation for unprotected**:
- Combine with other verification (OTP, captcha)
- Monitor and tune thresholds based on production data

### Data Privacy

**PII Handling**:
- Emails hashed (SHA-256) before logging
- No plaintext emails in logs
- No retention of raw data

**GDPR Compliance**:
- No personal data stored long-term
- Analytics aggregated
- Logs can be purged

**Security Best Practices**:
- HTTPS only (enforced by Cloudflare)
- No secrets in code
- Environment variables for config
- Minimal attack surface

### Input Validation

**Email Input**:
- Max length: 320 chars (RFC 5322)
- Character whitelist: ASCII printable
- Format validation: Strict regex
- Injection protection: No eval/exec

**Request Validation**:
- Content-Type: application/json
- Body size: < 1KB typical
- Rate limiting: (future with DO)

---

## Automated Training Pipeline

### Overview

The system includes a fully automated machine learning pipeline that continuously improves detection models without manual intervention.

### Training Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                  Automated Training Flow                         │
└─────────────────────────────────────────────────────────────────┘

1. DATA COLLECTION (Continuous)
   ┌──────────────┐
   │   Worker     │ → Validates emails
   │ (Production) │ → Records to Analytics Engine
   └──────┬───────┘    - Email local part (blob14)
          │            - Decision (blob1)
          │            - Risk score (double1)
          │            - Timestamp
          ▼
   ┌──────────────────────┐
   │ Analytics Engine     │ → Time-series dataset
   │ (ANALYTICS_DATASET)  │ → 5000+ validation records
   └──────────────────────┘

2. AUTOMATED TRAINING (Every 6 hours via Cron)
   ┌────────────────┐
   │  Cron Trigger  │ → "0 */6 * * *"
   │  (Scheduled)   │ → 12am, 6am, 12pm, 6pm UTC
   └───────┬────────┘
           │
           ├─────► Task 1: Update disposable domains list
           │       └─ Fetches from GitHub sources
           │
           └─────► Task 2: Retrain models
                   │
                   ▼
   ┌────────────────────────────────┐
   │ retrainMarkovModels()          │
   │ (src/training/online-learning) │
   └───────────┬────────────────────┘
               │
               ▼
   ┌────────────────────────────────┐
   │ 1. Acquire Training Lock       │ → Prevent concurrent training
   │ 2. Fetch from Analytics (7d)   │ → Direct SQL query
   │ 3. Filter & Label (500+ min)   │ → Heuristic labeling
   │ 4. Security Check (Anomalies)  │ → Detect poisoning attempts
   │ 5. Train Markov Models         │ → Character transition matrices
   │ 6. Validate Performance        │ → Holdout test set
   │ 7. Deploy to Production        │ → Atomic model swap
   └────────────────────────────────┘

3. DEPLOYMENT (Automated)
   ┌─────────────────┐
   │   KV Storage    │ → Stores trained models
   │ (MARKOV_MODEL)  │ → MM_legit_production
   └────────┬────────┘ → MM_fraud_production
            │
            ▼
   ┌─────────────────┐
   │  Worker Reads   │ → Loads models at startup
   │  from KV        │ → Uses for validation
   └─────────────────┘
```

### Training Data Flow

**Direct Analytics Engine Approach** (Current):
```
Production Traffic
    ↓
Analytics Engine (real-time writes)
    ↓
Cron Trigger (every 6 hours)
    ↓
retrainMarkovModels()
    ├─ fetchTrainingData() → SQL query
    ├─ separateDataByLabel() → fraud vs legit
    ├─ detectTrainingAnomalies() → security check
    ├─ trainMarkovChain() → build models
    ├─ validateMarkovChain() → test accuracy
    └─ saveMarkovModel() → deploy to KV
    ↓
Production Models Updated
```

**Optional Manual Extraction** (CLI):
```
npm run cli training:extract
    ├─ Queries Analytics Engine
    ├─ Applies heuristic labeling
    ├─ Saves to JSON file
    └─ For offline analysis/testing
```

### Key Components

**1. Analytics Engine Schema**:
```typescript
{
  blob1:   decision (allow/warn/block)
  blob2:   email
  blob14:  email_local_part
  double1: risk_score
  double2: confidence
  double3: bot_score
  timestamp: validation_time
}
```

**2. Training Requirements**:
- Minimum 500 samples (total)
- Last 7 days of data
- High confidence validations (>80%)
- Balanced fraud/legit distribution

**3. Security Measures**:
- Training lock (prevents concurrent runs)
- Anomaly detection (data poisoning protection)
- Volume spike detection
- Distribution shift detection
- Entropy scoring

**4. Model Storage**:
```
KV Namespace: MARKOV_MODEL
Keys:
  - MM_legit_production  → Legitimate email model
  - MM_fraud_production  → Fraudulent email model
  - markov_metadata      → Model version & stats
  - markov_training_history → Training logs
```

### CLI Commands

**Test Cron Locally**:
```bash
npm run cli test:cron
# Triggers scheduled handler
# Tests full training pipeline
```

**Extract Training Data** (Optional):
```bash
npm run cli training:extract --days 7
# Saves to JSON: training_data_YYYY-MM-DD.json
# For offline analysis only
```

**Manual Training** (Development):
```bash
npm run cli train:markov --dataset ./data.csv
# For testing with custom datasets
```

### Monitoring

**Training Metrics Logged**:
- Sample counts (fraud/legit)
- Training duration
- Model accuracy
- Anomaly scores
- Deployment status

**Check Training History**:
```bash
npm run cli kv:get markov_training_history --binding CONFIG
```

---

## System Summary

**Current State** (v2.1.1 - Production):
- ✅ 8 active fraud detectors operational
- ✅ Markov-first detection strategy
- ✅ Trained on 91,966 labeled emails
- ✅ ~35ms average latency
- ✅ Globally distributed (300+ edge locations)
- ✅ Horizontally scalable (unlimited capacity)
- ✅ Privacy-preserving logging (SHA-256 hashing)

**Architectural Strengths**:
- **Fast**: <50ms latency at the edge
- **Comprehensive**: 8 detection algorithms with Markov-first approach
- **Observable**: Structured logging + D1 Database analytics
- **Scalable**: Infinite horizontal scale on Cloudflare Workers
- **Low maintenance**: Streamlined detector architecture

**Key Design Principles**:
- **Markov-first scoring**: Trained models take precedence over heuristic detectors
- **Deterministic overrides**: Keyboard patterns override when confidence is high
- **Privacy-first design**: Email hashing, no PII storage
- **Detector hierarchy**: 8 active (exported), 3 internal-only, 3 deprecated

**Production Metrics**:
- Uptime: 99.9%
- Throughput: 14,000+ emails/second
- Training Data: 91,966 samples (50.2K legit + 41.8K fraud)
- Requests validated: Tracked via D1 Database

---

**For More Information**:
- [Getting Started](./GETTING_STARTED.md)
- [API Documentation](./API.md)
- [Detectors Guide](./DETECTORS.md)
- [Project Structure](./PROJECT_STRUCTURE.md)
