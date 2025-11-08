# 🧪 Testing Documentation

**Comprehensive testing guide for Bogus Email Pattern Recognition**

---

## 📊 Test Status

**Current Status**: ⚠️ **388 tests passing (84.9%)**

| Metric | Value | Status |
|--------|-------|--------|
| **Total Tests** | 457 tests | - |
| **Passing** | 388 passing | ⚠️ 84.9% |
| **Failing** | 66 failing | ⚠️ Needs attention |
| **Skipped** | 3 skipped | - |
| **Detection Rate** | 97.0% (E2E) | ✅ Exceeds 80% target |
| **Duration** | ~11.2 seconds | ⚠️ Slower due to failures |

**Known Issues**:
- `bun:test` module resolution errors (3 unhandled errors)
- Some training flow tests need updates after architecture changes
- Test suite expanded significantly since last documentation update

---

## 🚀 Quick Start

### Run All Tests
```bash
npm test
```

### Run E2E Tests
```bash
# Run all E2E tests (fraud detection + API endpoints)
npm run test:e2e

# Test against production
WORKER_URL=https://your-worker.workers.dev npm run test:e2e
```

### Run Performance Tests
```bash
# Run performance and load tests
npm run test:performance

# Test with specific grep pattern
npm run test:performance -- --grep "latency"
```

---

## 📦 Test Suite Structure

### Unit Tests (157 tests)
Location: `tests/unit/`

**Email Validator Tests** (`validators/email.test.ts`)
- Format validation (RFC 5322)
- Disposable domain detection
- Free provider detection
- Plus addressing detection
- Domain reputation scoring

**Pattern Detector Tests** (`detectors/pattern-detectors.test.ts`)
- Sequential patterns (user1, user2, etc.)
- Dated patterns (john.doe.2024)
- Keyboard walk patterns (qwerty, asdfgh)
- Plus addressing (+spam, +test)
- Gibberish detection

**N-gram Analysis Tests** (`detectors/ngram-analysis.test.ts`)
- Bigram frequency analysis
- Trigram patterns
- Entropy calculation
- Randomness detection

**Benford's Law Tests** (`detectors/benfords-law.test.ts`)
- First digit distribution analysis
- Numeric pattern detection
- Statistical anomaly detection

**TLD Risk Tests** (`detectors/tld-risk.test.ts`)
- Top-level domain risk scoring
- ccTLD analysis
- New gTLD detection

### Integration Tests (130 tests)
Location: `tests/integration/`

**Validation Endpoint Tests** (`validate-endpoint.test.ts`)
- API request/response validation
- Error handling
- Rate limiting
- Performance benchmarks

**Comprehensive Validation Tests** (`comprehensive-validation.test.ts`)
- End-to-end email validation
- Real-world email patterns
- Edge cases
- Multi-factor scoring

**Fraudulent Email Tests** (`fraudulent-emails.test.ts`)
- Pattern-specific detection
- Fraud type classification
- Risk scoring accuracy

---

## 🎯 Fraud Pattern Testing

### Pattern Types Tested

**1. Sequential Patterns**
```
user1@example.com
user2@example.com
person1.person2@company.com
```

**2. Dated Patterns**
```
john.doe.2024@example.com
personG.personH@company.com
```

**3. Keyboard Walk Patterns**
```
qwerty123@example.com
asdfgh@test.com
12345678@domain.com
```

**4. Gibberish Patterns**
```
xkjfhsd@example.com
zzqwpoi@test.com
```

**5. Plus Addressing Abuse**
```
user+spam@gmail.com
user+test123@outlook.com
```

**6. Random Number Suffixes**
```
user_472910@example.com
john_smith_8372@company.com
```

**7. Underscore Sequential**
```
user_1@example.com
john_smith_001@test.com
```

**8. Simple Patterns**
```
test@example.com
admin@company.com
```

**9. Dictionary + Numbers**
```
apple123@example.com
banana456@test.com
```

**10. Mixed Patterns**
Combinations of the above patterns

### Fraudulent Email Generator

**Script**: `scripts/generate-fraudulent-emails.js`

**Usage**:
```bash
# Generate 200 fraudulent emails
node scripts/generate-fraudulent-emails.js 200

# Output: data/fraudulent-emails.json
```

**Features**:
- 11 fraud pattern types
- Legitimate domain usage (gmail, yahoo, outlook, etc.)
- Realistic naming conventions
- Varied complexity levels

**Output Format**:
```json
{
  "metadata": {
    "generated": "2025-11-01T12:00:00.000Z",
    "count": 200,
    "version": "1.0.0"
  },
  "emails": [
    {
      "email": "user123@gmail.com",
      "pattern": "sequential",
      "expectedRisk": "high",
      "notes": "Sequential numbering pattern"
    }
  ]
}
```

---

## 📈 Test Results

### Latest 1000-Email Test

**Date**: 2025-11-01
**Detection System**: Phase 6A + Sequential Enhancement (v1.1.0)

**Overall Performance**: ✅ **97.0% Detection Rate**

| Decision | Count | Percentage |
|----------|-------|------------|
| **Detected (warn/block)** | **970** | **97.0%** |
| Warned | 934 | 93.4% |
| Blocked | 36 | 3.6% |
| Allowed (Missed) | 30 | 3.0% |

**By Pattern Type**:

| Pattern | Total | Detected | Rate |
|---------|-------|----------|------|
| Sequential | 147 | 143 | 97.3% |
| Sequential Padded | 151 | 144 | 95.4% |
| Dated | 140 | 140 | 100% |
| Gibberish | 145 | 145 | 100% |
| Keyboard Walk | 149 | 149 | 100% |
| Plus Addressing | 137 | 136 | 99.3% |
| Name Sequential | 131 | 113 | 86.3% |

**Risk Score Distribution**:

| Range | Count | Percentage |
|-------|-------|------------|
| 0.8-1.0 (Very High) | 36 | 3.6% |
| 0.6-0.8 (High) | 516 | 51.6% |
| 0.4-0.6 (Medium) | 418 | 41.8% |
| 0.2-0.4 (Low) | 25 | 2.5% |
| 0.0-0.2 (Very Low) | 5 | 0.5% |

**Key Findings**:
- ✅ Exceeds 80% target by 17 percentage points
- ✅ Very low false negative rate (3.0%)
- ✅ Conservative blocking approach (3.6%)
- ✅ Consistent detection across pattern types
- ⚠️ Name sequential patterns need improvement (86.3%)

---

## 🔧 Test Scripts

### Available Test Scripts

**1. Unit + Integration Tests**
```bash
npm test
# Runs: vitest (287 tests)
```

**2. Specific Detector Testing**
```bash
node scripts/test-detectors.js
# Interactive detector testing
```

**3. E2E Testing**
```bash
npm run test:e2e
# Tests API endpoints and fraud detection
# Runs all E2E test suites
```

**4. Performance Testing**
```bash
npm run test:performance
# Load testing, latency metrics, throughput
# Sequential and parallel processing tests
```

**5. Production Testing**
```bash
WORKER_URL=https://your-worker.workers.dev npm run test:e2e
# Test against production deployment
```

**6. Utility Scripts**
```bash
# Generate test data
node scripts/generate-fraudulent-emails.js 200

# Quick detector testing
node scripts/test-detectors.js
```

---

## 📋 Test Configuration

### Vitest Configuration

**File**: `vitest.config.ts`

```typescript
export default defineWorkersConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
      },
    },
  },
});
```

### Environment Variables

**File**: `.dev.vars` (for local testing)

```bash
ADMIN_API_KEY=your-secret-key
ORIGIN_URL=http://localhost:8787
CLOUDFLARE_ACCOUNT_ID=your-account-id
CLOUDFLARE_API_TOKEN=your-api-token
```

---

## 🎯 Writing New Tests

### Unit Test Example

```typescript
import { describe, it, expect } from 'vitest';
import { detectSequentialPattern } from '../src/detectors/sequential';

describe('Sequential Pattern Detection', () => {
  it('should detect user123 pattern', () => {
    const result = detectSequentialPattern('user123@example.com');
    expect(result.detected).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it('should not detect legitimate email', () => {
    const result = detectSequentialPattern('person1.person2@company.com');
    expect(result.detected).toBe(false);
  });
});
```

### Integration Test Example

```typescript
import { describe, it, expect, env } from 'vitest';

describe('POST /validate', () => {
  it('should validate email and return risk score', async () => {
    const response = await env.SELF.fetch('https://example.com/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.com' }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty('riskScore');
    expect(data).toHaveProperty('decision');
  });
});
```

---

## 🐛 Debugging Tests

### Run Specific Test File
```bash
npx vitest tests/unit/detectors/sequential.test.ts
```

### Run Tests in Watch Mode
```bash
npm test -- --watch
```

### Run Tests with Coverage
```bash
npx vitest --coverage
```

### Debug with Logs
```bash
# Enable debug logging
DEBUG=* npm test
```

---

## 📊 Performance Benchmarks

### Test Execution Speed

| Test Suite | Duration | Performance |
|------------|----------|-------------|
| Email Validator | ~626ms | ✅ Fast |
| N-gram Analysis | ~958ms | ✅ Fast |
| Benford's Law | ~1060ms | ✅ Fast |
| Pattern Detectors | ~991ms | ✅ Fast |
| TLD Risk | ~1112ms | ✅ Fast |
| **Total** | **~3.8s** | **✅ Excellent** |

### Validation Performance

| Metric | Value | Target |
|--------|-------|--------|
| Avg Latency | 33ms | <100ms ✅ |
| P50 Latency | 28ms | <50ms ✅ |
| P95 Latency | 45ms | <100ms ✅ |
| P99 Latency | 67ms | <200ms ✅ |
| Throughput | ~30 req/s | >10 req/s ✅ |

---

## 🔍 Test Coverage

### Coverage by Component

| Component | Unit Tests | Integration Tests | Total |
|-----------|------------|-------------------|-------|
| Email Validator | 20 | 15 | 35 |
| Pattern Detectors | 37 | 25 | 62 |
| N-gram Analysis | 29 | 10 | 39 |
| Benford's Law | 34 | 8 | 42 |
| TLD Risk | 37 | 12 | 49 |
| API Endpoints | 0 | 60 | 60 |
| **Total** | **157** | **130** | **287** |

### Critical Paths Covered

- ✅ Email format validation (RFC 5322)
- ✅ Pattern detection (all 7 types)
- ✅ Risk scoring algorithm
- ✅ Decision engine (allow/warn/block)
- ✅ Configuration management
- ✅ Analytics logging
- ✅ Error handling
- ✅ API endpoints
- ✅ Authentication

---

## 🎓 Best Practices

### Test Organization
1. **Group by component**: Unit tests mirror source structure
2. **Descriptive names**: Use "should..." pattern
3. **Single assertion**: Focus tests on one behavior
4. **Setup/teardown**: Use beforeEach/afterEach for shared setup

### Test Data
1. **Fixtures**: Reusable test data in `tests/fixtures/`
2. **Realistic data**: Use real-world examples
3. **Edge cases**: Test boundary conditions
4. **Invalid inputs**: Test error handling

### Continuous Testing
1. **Run before commit**: Ensure all tests pass
2. **Watch mode**: Use during development
3. **CI integration**: Automated testing on push
4. **Coverage tracking**: Monitor test coverage

---

## 📚 Additional Resources

- **Test Files**: `tests/` directory
- **Test Scripts**: `scripts/` directory
- **Test Data**: `data/` directory (gitignored)
- **API Documentation**: `docs/API.md`
- **Architecture**: `docs/ARCHITECTURE.md`

---

## 🔄 Continuous Improvement

---

**Last Updated**: 2025-01-07
**Test Suite Version**: 2.0.0
**Detection System**: Phase 6A Enhanced + Automated Training
**Total Test Files**: 22 files (14 failing, 8 passing)
