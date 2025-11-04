# Birth Year vs. Fraud Timestamp Detection Research

## Problem Statement

Our current dated pattern detector flags ALL year patterns in email addresses as suspicious, causing **false positives** on legitimate users who include their birth year in their email address (e.g., `sarah1990@outlook.com`, `john.smith.1985@gmail.com`).

**Test Results:**
- Birth year patterns: **0% pass rate** (all blocked)
- Number patterns: **0% pass rate** (all blocked)
- Current year patterns: **100% detection** (correct)

## Current Algorithm Analysis

### What It Does Well ✅
1. Detects current/recent years (2024, 2025) with high confidence
2. Detects month-year patterns (jan2025, oct2024)
3. Detects full date stamps (20250104)
4. Adjusts confidence based on year position (trailing vs. leading)

### The Problem ⚠️
```typescript
// Line 64: Only considers years within ±5 of current year
if (year >= currentYear - 5 && year <= currentYear + 5) {
  // Flags as suspicious
}
```

**Issue**: This catches years 2020-2030 (in 2025), which includes:
- ❌ Fraud: `user2025@gmail.com` (signup timestamp)
- ✅ **BUT ALSO** Legit: `sarah1990@gmail.com` (birth year from millennials)

The algorithm cannot distinguish **temporal fraud indicators** (current/recent years) from **legitimate personal identifiers** (birth years).

## Research Findings

### 1. Email Age Detection (Industry Standard)

**Key Insight**: Professional fraud detection services focus on **email account age**, not embedded years in the address itself.

- Aged email addresses = higher quality users
- Fresh emails with current timestamps = suspicious
- But: Email age is a "well-educated guess," not precise

**Limitation**: Doesn't help us with the year-in-address problem.

### 2. Birth Year Plausibility Ranges

**Standard UX Practice**:
- Minimum age: 13 years (COPPA compliance)
- Maximum age: 100-120 years differential
- Birth year range: ~1905-2012 (for 2025)

**Internet Usage Demographics**:
- Most active users: Born 1960-2010
- Peak signup demographic: Ages 18-45 (born ~1980-2007)
- Millennials (1981-1996) commonly use birth years in emails

### 3. Temporal Pattern Recognition

**Fraud Pattern Characteristics**:
1. **Current/recent years** - Timestamp-based generation
   - `user2025@`, `signup2024@`, `test_jan2025@`
   - Very recent to signup date

2. **Sequential year increments** in batch
   - `john.doe.2024@`, `john.doe.2025@`, `john.doe.2026@`
   - Multiple accounts with incrementing years

3. **Month-year combinations** matching signup period
   - `user_nov2024@` created in November 2024
   - `signup_dec2024@` created in December 2024

**Legitimate Pattern Characteristics**:
1. **Birth years** - Historical personal identifiers
   - `sarah1985@`, `mike1992@`, `personC.personD@`
   - Always in the past (15-60 years ago)

2. **Memorable numbers** unrelated to years
   - `bob007@`, `alice42@`, `neo1999@` (Matrix reference)
   - Cultural/personal significance

3. **Consistent over time**
   - User with birth year email doesn't change pattern
   - Not correlated with signup date

## Proposed Algorithm: Age-Aware Temporal Analysis

### Core Principle
**Temporal Distance from Current Date** = Primary fraud indicator

```
Fraud Risk = f(year_recency, position, context)

Where:
  year_recency = abs(year - current_year)
  position = {trailing, middle, leading}
  context = {full_date, month_year, year_only}
```

### Algorithm Logic

```typescript
function calculateYearRisk(year: number, context: Context): RiskScore {
  const currentYear = new Date().getFullYear();
  const yearAge = currentYear - year;

  // 1. TEMPORAL DISTANCE CLASSIFICATION
  if (year > currentYear) {
    // Future year = VERY HIGH RISK (impossible birth year)
    return { risk: 0.95, reason: 'future_year', confidence: 1.0 };
  }

  if (yearAge <= 2) {
    // 0-2 years old = VERY HIGH RISK (timestamp pattern)
    // e.g., 2024, 2025 in 2025 = likely fraud
    return { risk: 0.90, reason: 'recent_timestamp', confidence: 0.95 };
  }

  if (yearAge >= 13 && yearAge <= 65) {
    // 13-65 years old = PLAUSIBLE BIRTH YEAR RANGE
    // e.g., 1960-2012 in 2025 = could be birth year
    // Ages 13-65 = reasonable internet user demographics

    if (context === 'month_year' || context === 'full_date') {
      // But month+year or full date is still suspicious
      // sarah_jan1990@ is weird, sarah1990@ is normal
      return { risk: 0.75, reason: 'dated_but_formatted', confidence: 0.7 };
    }

    // Just a year in plausible birth range = LOW RISK
    return { risk: 0.20, reason: 'plausible_birth_year', confidence: 0.5 };
  }

  if (yearAge >= 66 && yearAge <= 100) {
    // 66-100 years old = ELDERLY RANGE (less common but possible)
    // e.g., 1925-1959 in 2025
    return { risk: 0.40, reason: 'elderly_birth_year', confidence: 0.6 };
  }

  if (yearAge > 100) {
    // >100 years old = IMPLAUSIBLE
    // e.g., 1924 or earlier in 2025
    return { risk: 0.80, reason: 'implausible_age', confidence: 0.8 };
  }

  // 3-12 years old = YOUNG USER RANGE (suspicious but possible)
  // e.g., 2013-2022 in 2025 = too young for account creation
  return { risk: 0.70, reason: 'underage_year', confidence: 0.7 };
}
```

### Risk Zones Visualization

```
        RISK
         ↑
    1.0  |  ████████████████ Future Years (2026+)
         |
    0.9  |  ████████████████ Very Recent (2023-2025)
         |
    0.8  |  ████████         Ancient (pre-1925)
         |
    0.7  |  ████████         Too Young (2013-2022)
         |
    0.6  |  ██████           Elderly But Possible (1925-1959)
         |
    0.4  |
         |
    0.2  |  ████             SAFE ZONE (1960-2012)
         |                   ↑ Birth Year Range
    0.0  |____|____|____|____|____|____|____|____→
         1900 1940 1980 2020 2060                Years
               ←--Birth Years--→  ←-Fraud-→
```

### Contextual Confidence Adjustments

**Increase Risk If:**
1. **Full date format** - `user_20241031@` (+0.2 risk)
2. **Month + year** - `user_jan2025@` (+0.15 risk)
3. **Leading position** - `2024.person1.person2@` (+0.1 risk, unusual)
4. **With separators** - `user.2025.test@` (+0.1 risk)

**Decrease Risk If:**
1. **Simple trailing year** - `sarah1990@` (-0.1 risk)
2. **In birth year range (13-65 years ago)** (-0.2 risk)
3. **Long base name** - `firstname.lastname.1985@` (-0.05 risk)

## Implementation Strategy

### Phase 1: Enhanced Year Classification
```typescript
enum YearCategory {
  FUTURE_YEAR,           // >current_year
  FRAUD_TIMESTAMP,       // 0-2 years old
  UNDERAGE,              // 3-12 years old
  PLAUSIBLE_BIRTH_YEAR,  // 13-65 years old ← NEW
  ELDERLY_BIRTH_YEAR,    // 66-100 years old ← NEW
  ANCIENT_IMPLAUSIBLE    // >100 years old
}
```

### Phase 2: Context-Aware Risk Scoring
- Year-only in birth range → Low risk (0.2)
- Month-year in birth range → Medium risk (0.6)
- Full-date in birth range → High risk (0.8)
- Recent years (0-2 years) → Very high risk (0.9)

### Phase 3: Batch Analysis Enhancement
If multiple emails in a signup batch:
- Same base pattern + incrementing years → HIGH RISK
- Same base pattern + same birth year → LOW RISK
- Random bases + random birth years → MEDIUM RISK

## Expected Improvements

### Current State (v2.0.1)
- Birth year false positive rate: **100%** (9/9 blocked)
- Fraud detection rate: **100%** (20/20 caught)
- Overall accuracy: **73.3%**

### Projected State (with algorithm)
- Birth year false positive rate: **0-20%** (0-2/9 blocked)
- Fraud detection rate: **95-100%** (19-20/20 caught)
- Overall accuracy: **85-90%**

### Trade-offs
- **Risk**: May allow some sophisticated fraudsters using birth-year-like timestamps
  - Mitigation: Combine with other signals (Markov, keyboard walks, etc.)

- **Benefit**: Stops blocking legitimate users born 1960-2012
  - Impact: Millennials (1981-1996) can use their birth year
  - Impact: Gen X (1965-1980) can use their birth year
  - Impact: Gen Z (1997-2012) can use their birth year

## Recommendations

### 1. Implement Age-Aware Algorithm ✅ **Priority**
Replace simple "±5 years" rule with demographic-aware birth year logic.

### 2. Multi-Signal Approach ✅ **Current Best Practice**
Never rely on year detection alone:
- Markov Chain (primary detector)
- Keyboard walks (high confidence)
- Gibberish detection
- Disposable domains
- Year patterns (supporting signal)

### 3. Batch Context Analysis ✅ **Future Enhancement**
- Analyze patterns across multiple signups
- Detect incrementing year sequences
- Flag coordinated timestamp-based campaigns

### 4. Continuous Monitoring ✅ **Production Practice**
- A/B test algorithm changes
- Monitor false positive/negative rates
- Adjust thresholds based on real data

## References

1. **Email Age Detection**: AtData, IPQS Email Age Checker
2. **Age Validation UX**: Stack Exchange UX discussions on age gates
3. **Fraud Pattern Recognition**: FraudLabs Pro, Softjourn Pattern Recognition
4. **Temporal Analysis**: TimeTrail (ArXiv 2308.14215) - Financial Fraud Patterns
5. **Demographics**: US Internet usage statistics (Pew Research)

## Test Cases for Validation

### Should ALLOW (Birth Years)
```
✓ sarah1990@outlook.com         (1990 = 35 years old, millennial)
✓ john.smith.1985@gmail.com     (1985 = 40 years old, gen X)
✓ mike_1988@yahoo.com           (1988 = 37 years old, millennial)
✓ alice1995@hotmail.com         (1995 = 30 years old, millennial)
✓ bob1970@gmail.com             (1970 = 55 years old, gen X)
```

### Should BLOCK (Fraud Timestamps)
```
✓ user2025@gmail.com            (current year = timestamp)
✓ test_jan2025@outlook.com      (month+year = campaign)
✓ signup20250104@yahoo.com      (full date = automated)
✓ account2024@gmail.com         (recent year = fraud)
✓ member2026@hotmail.com        (future year = impossible)
```

### Edge Cases
```
? alice42@gmail.com             (42 = not a year, cultural reference)
? bob007@outlook.com            (007 = not a year, James Bond)
? john2015@gmail.com            (2015 = 10 years old, underage but possible)
? sarah2012@yahoo.com           (2012 = 13 years old, minimum age)
```

---

**Document Version**: 1.0
**Date**: 2025-01-04
**Author**: Research based on live production testing (45 test cases)
**Status**: Pending Implementation
