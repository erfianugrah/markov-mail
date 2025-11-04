# Live Production Test Results

**Date**: 2025-01-04
**Endpoint**: https://your-worker.workers.dev/validate
**Test Cases**: 45 (19 legitimate, 20 fraud, 6 edge cases)
**Mode**: Enforcement (blocking enabled)

## Executive Summary

✅ **Perfect Fraud Detection**: 100% recall (0 false negatives)
⚠️ **High False Positives**: 9 legitimate users blocked (47% of legit tests)
📊 **Overall Accuracy**: 73.3%

**Key Finding**: The system is **too aggressive** on temporal patterns (years/dates in emails), blocking legitimate birth years while perfectly catching fraud timestamps.

---

## Detailed Results

### Overall Metrics

| Metric | Value | Interpretation |
|--------|-------|----------------|
| **Total Tests** | 45 | Hand-crafted, real-world patterns |
| **Passed** | 33 (73.3%) | Correct decisions |
| **Failed** | 12 (26.7%) | Incorrect decisions |
| **Avg Latency** | 20ms | Excellent performance |

### Confusion Matrix

| | Predicted Fraud | Predicted Legit |
|---|---|---|
| **Actually Fraud** | 20 (TP) | 0 (FN) |
| **Actually Legit** | 9 (FP) | 10 (TN) |

### Statistical Metrics

- **Precision**: 69.0% - Of all blocked emails, 69% were actually fraud
- **Recall**: 100.0% - Of all fraud, we caught 100%
- **F1 Score**: 81.6% - Harmonic mean (balance of precision/recall)

**Interpretation**:
- ✅ **Perfect recall** = No fraud gets through (security goal achieved)
- ⚠️ **Low precision** = Too many false alarms (user experience issue)

---

## Category Breakdown

### ✅ Perfect Detection (100% Accuracy)

| Category | Pass Rate | Count | Examples |
|----------|-----------|-------|----------|
| **Legitimate Names** | 100% (5/5) | ✅ | person1.person2@gmail.com, personI.personJ@outlook.com |
| **Sequential Fraud** | 100% (6/6) | ✅ | user1@, user123@, test001@ |
| **Keyboard Walks** | 100% (4/4) | ✅ | qwerty123@, asdfgh@, 123456789@ |
| **Gibberish** | 100% (3/3) | ✅ | xkjgh2k9qw@, asdfjkl123@ |
| **Disposable Domains** | 100% (4/4) | ✅ | test@tempmail.com, user@guerrillamail.com |
| **Dated Fraud** | 100% (3/3) | ✅ | user2025@, test_jan2025@, signup20250104@ |
| **Edge: Admin** | 100% (1/1) | ✅ | admin@startup.io |
| **Edge: Test** | 100% (1/1) | ✅ | test@company.com |

### ⚠️ High False Positives

| Category | Pass Rate | Count | Issue |
|----------|-----------|-------|-------|
| **Birth Years** | **0% (0/3)** | ❌❌❌ | sarah1990@, john.smith.1985@, mike_1988@ |
| **Numbers in Email** | **0% (0/2)** | ❌❌ | alice42@, bob007@ |
| **High-Risk TLDs** | **0% (0/2)** | ❌❌ | contact@business.xyz, info@company.top |
| **Professional** | **25% (1/4)** | ❌❌❌ | contact@, info@, support@ |
| **Plus Addressing** | **50% (1/2)** | ❌ | john+test1@gmail.com |

### 🟡 Mixed Results

| Category | Pass Rate | Count | Notes |
|----------|-----------|-------|-------|
| **International Names** | 80% (4/5) | ⚠️ | Failed: yuki.tanaka@gmail.com (Japanese) |

---

## Failed Test Analysis

### False Positives (Legit Blocked)

#### 1. Birth Year Patterns (0% pass rate)
```
❌ sarah1990@outlook.com         Expected: allow, Got: block
❌ john.smith.1985@gmail.com     Expected: allow, Got: block
❌ mike_1988@yahoo.com           Expected: allow, Got: block
```

**Root Cause**: Dated pattern detector flags all years within ±5 of current year, catching fraud timestamps (2024, 2025) but also birth years (1985-1995) from Millennials and Gen X users.

**Impact**: High - affects large demographic (ages 30-45)

**Recommendation**: Implement age-aware algorithm (see BIRTH_YEAR_VS_FRAUD_TIMESTAMP_RESEARCH.md)

#### 2. Memorable Numbers (0% pass rate)
```
❌ alice42@gmail.com             Expected: allow, Got: block (score: 0.00)
❌ bob007@outlook.com            Expected: allow, Got: block (score: 0.00)
```

**Root Cause**: Any numeric sequence triggers suspicion. Cultural references (007, 42) treated same as fraud patterns (user123).

**Impact**: Medium - common personalization technique

**Recommendation**: Consider number context (2-3 digits vs. sequential patterns)

#### 3. Professional/Generic Addresses (25% pass rate)
```
❌ contact@business.io           Expected: allow, Got: block
❌ info@startup.com              Expected: allow, Got: block
❌ support@service.net           Expected: allow, Got: block
✅ j.smith@company.com           Expected: allow, Got: allow
```

**Root Cause**: Generic words like "contact", "info", "support" pattern-match to test/bot accounts.

**Impact**: Medium - B2B use cases

**Recommendation**: Context matters - corporate domains should whitelist these

#### 4. High-Risk TLDs (0% pass rate)
```
❌ contact@business.xyz          Expected: allow, Got: block
❌ info@company.top              Expected: allow, Got: block
```

**Root Cause**: TLD risk scoring is aggressive on newer gTLDs (.xyz, .top).

**Impact**: Low - newer businesses using modern TLDs

**Recommendation**: TLD risk should be additive, not blocking on its own

#### 5. Plus Addressing (50% pass rate)
```
❌ john+test1@gmail.com          Expected: allow, Got: block
✅ sarah+spam@outlook.com        Expected: allow, Got: allow (inconsistent)
```

**Root Cause**: Plus addressing treated as suspicious behavior.

**Impact**: Low - power users, but debatable if should be allowed

**Recommendation**: Keep current behavior or make configurable

#### 6. International Name (80% pass rate)
```
❌ yuki.tanaka@gmail.com         Expected: allow, Got: block (Japanese name)
```

**Root Cause**: Markov Chain trained primarily on Western names.

**Impact**: Medium - internationalization issue

**Recommendation**: Improve training data diversity

---

## Performance Analysis

### Latency Distribution
```
Min:     12ms
Max:     22ms
Avg:     20ms
P95:     ~21ms
P99:     ~22ms
```

**Assessment**: ✅ Excellent - Well under <50ms target

### Throughput
```
45 requests @ 100ms interval = 7.5 requests/second
No rate limiting triggered
No errors
```

**Assessment**: ✅ Stable - Production-ready performance

---

## Comparison to Goals

| Metric | Goal | Current | Status |
|--------|------|---------|--------|
| False Negative Rate | <1% | **0%** | ✅ Exceeds |
| False Positive Rate | <10% | **47%** | ❌ Too High |
| Latency | <50ms | **20ms** | ✅ Exceeds |
| Accuracy | >90% | **73.3%** | ❌ Below Target |
| Fraud Detection | >95% | **100%** | ✅ Exceeds |

**Overall**: Security goals achieved, but user experience needs improvement.

---

## Recommendations

### Priority 1: High Impact 🔥
1. **Implement Age-Aware Birth Year Algorithm**
   - Impact: +15-20% accuracy improvement
   - Effort: Medium (algorithm design complete)
   - Risk: Low (other detectors still catch fraud)

### Priority 2: Medium Impact 🔧
2. **Context-Aware Number Detection**
   - Distinguish cultural references (42, 007) from sequential fraud (123, 001)
   - Impact: +2-4% accuracy improvement

3. **Corporate Domain Heuristics**
   - Allow generic names (contact@, info@) on established corporate domains
   - Impact: +4-6% accuracy improvement

### Priority 3: Low Impact 💡
4. **TLD Risk Scoring Refinement**
   - Make TLD risk additive rather than blocking
   - Impact: +2-4% accuracy improvement

5. **International Name Training**
   - Expand Markov Chain training data with non-Western names
   - Impact: +1-2% accuracy improvement

### Monitoring & A/B Testing
- Deploy changes with A/B experiments
- Monitor false positive/negative rates
- Adjust thresholds based on production data

---

## Test Dataset Quality

### Strengths ✅
1. **Hand-crafted** - Not circular (not generated by our detectors)
2. **Real-world patterns** - Based on actual fraud observations
3. **Demographic diversity** - International names, age ranges, domains
4. **Edge cases included** - Professional emails, cultural references

### Limitations ⚠️
1. **Sample size** - Only 45 cases (need 100s for statistical confidence)
2. **No bulk patterns** - Doesn't test batch fraud detection
3. **Static dataset** - Fraudsters evolve, needs regular updates
4. **Domain bias** - Heavy focus on Gmail/Outlook/Yahoo

### Future Enhancements
1. Expand to 100+ test cases per category
2. Add real production data (anonymized)
3. Include adversarial examples (sophisticated fraud)
4. Test batch/campaign patterns
5. Add temporal testing (same email at different times)

---

## Conclusion

The fraud detection system demonstrates **excellent security** (100% fraud detection) but needs **refinement for user experience** (47% false positive rate on legitimate users).

**Primary Issue**: Temporal pattern detection is too broad, catching birth years alongside fraud timestamps.

**Solution Path**: Age-aware algorithmic approach that distinguishes:
- **Fraud**: Recent years (0-2 years old) = timestamps
- **Legit**: Historical years (13-65 years old) = birth years

**Expected Outcome**: 85-90% overall accuracy while maintaining 95-100% fraud detection rate.

---

**Next Steps**:
1. ✅ Research completed - See BIRTH_YEAR_VS_FRAUD_TIMESTAMP_RESEARCH.md
2. ⏳ Algorithm implementation
3. ⏳ Unit test coverage for new logic
4. ⏳ A/B testing in production
5. ⏳ Re-run live tests to validate improvements

---

**Appendix A: Full Test Case List**

Available in CLI command:
```bash
npm run cli test:live --verbose
```

**Appendix B: Raw Test Data**

See: `/cli/commands/test-live.ts` - `TEST_CASES` array

---

**Document Version**: 1.0
**Status**: Final
**Distribution**: Engineering team, product review
