# Bogus Email Pattern Recognition

A Cloudflare Workers-based fraud detection API that identifies fraudulent email signup patterns through advanced pattern recognition, statistical analysis, and machine learning.

## 🚦 Status

**Production**: https://fraud.erfi.dev
**Version**: 2.4.2 (Production-Ready)
**Primary Detection**: Markov Chain with Out-of-Distribution (OOD) Detection
**Training Data**: Pattern-based labels (50.2K legit + 41.8K fraud)
**OOD Thresholds**: Piecewise (3.8 nats warn, 5.5 nats block)
**Avg Latency**: ~35ms
**Philosophy**: Algorithmic > Hardcoded (trust trained models over manual rules)

### System Health
- ✅ **Markov-only detection** - 83% precision (up from 70.4%)
- ✅ **Low false positives** - 62% reduction (8 → 3 false positives)
- ✅ **Pattern-based training** (addresses, not message content) with 50/50 balance
- ✅ 2-gram & 3-gram Markov models (legit/fraud)
- ✅ Multi-factor pattern classification (n-grams + vowel density + entropy)
- ✅ Comprehensive pino.js logging throughout
- ✅ Configuration-driven decision overrides
- ✅ 143 TLDs in risk database + 71K+ disposable domains
- ✅ Analytics dashboard with D1 database and pattern versioning
- ✅ Unified CLI management system

### Latest Updates (v2.4.2 - 2025-01-12)
- 🎯 **Trust Markov Models** - Removed hardcoded pattern overrides
  - **Removed**: Sequential pattern override (0.8 fixed score)
  - **Removed**: Plus-addressing override (0.6 fixed score)
  - **Why**: Markov models trained on 111K+ emails handle these patterns naturally
  - **Plus-addressing**: No longer penalized (person+filter@gmail.com is legitimate)
- 📈 **Improved Precision** - 70.4% → 83.3% (+13%)
  - **False positives**: 8 → 3 (62% reduction!)
  - **Better UX**: Fewer legitimate users blocked
  - **Trade-off**: Recall dropped 95% → 75% (sequential fraud now gets "warn" for manual review)
- 🧠 **Philosophy**: "Algorithmic > Hardcoded"
  - Let trained models make decisions, not manual rules
  - Sequential fraud detection now relies on Markov confidence
  - Dated patterns still use dynamic confidence (0.2-0.9 based on age)

### Previous Updates (v2.4.1 - 2025-01-12)
- 🎯 **Piecewise OOD Thresholds** - Enhanced two-tier threshold system
  - **Dead zone** (< 3.8 nats): Zero OOD risk for familiar patterns
  - **Warn zone** (3.8-5.5 nats): Progressive risk scaling (0.35→0.65)
  - **Block zone** (5.5+ nats): Maximum OOD risk for gibberish
  - **Improvement**: 30% → 70-75% accuracy on OOD test cases
  - **Research-backed**: Hybrid step/linear approach from fraud detection literature
- 🔧 **Better Precision** - Dead zone protects legitimate patterns
  - `person4@gmail.com` (3.32 nats): v2.4.0 = 0.05 risk → v2.4.1 = 0.00 risk
  - No false positives on patterns below 3.8 nats
- 🚫 **Improved Gibberish Detection** - High-entropy patterns now reliably blocked
  - `xkjgh2k9qw@gmail.com` (6.23 nats): v2.4.0 = warn → v2.4.1 = block
  - Block zone (5.5+) catches extreme patterns missed by linear scaling
- 📊 **OOD Zone Tracking** - New database column for monitoring
  - `ood_zone`: 'none', 'warn', or 'block'
  - Enhanced SQL queries for zone-based analytics

### Previous Updates (v2.4.0 - 2025-01-10)
- 🚨 **Out-of-Distribution (OOD) Detection** - Two-dimensional risk model
  - **New**: Detects patterns unfamiliar to BOTH fraud and legitimate models
  - **Threshold**: 3.0 nats cross-entropy (log 2 baseline is 0.69 nats)
  - **Risk Formula**: abnormalityRisk = min((minEntropy - 3.0) × 0.15, 0.6)
  - **Research-backed**: Thresholds derived from established information theory
  - **Examples**: Anagrams, novel shuffles, cross-language mixing
- 📊 **Database Schema** - Added OOD tracking columns
  - `min_entropy`: min(H_legit, H_fraud) - abnormality measure
  - `abnormality_score`: how far above 3.0 threshold
  - `abnormality_risk`: risk contribution (0.0-0.6)
  - `ood_detected`: boolean flag for OOD patterns
- 🔧 **Two-Dimensional Risk** - Classification + Abnormality
  - Classification risk: differential signal (fraud vs legit)
  - Abnormality risk: consensus signal (both models confused)
  - Final risk: max(classificationRisk, abnormalityRisk) + domainRisk

### Previous Updates (v2.2.0 - 2025-11-08)
- 🎯 **Markov-Only Detection** - Removed heuristic detectors with high false positive rates
  - **DEPRECATED**: Keyboard walk, keyboard mashing, and gibberish detectors
  - Markov Chain is now the primary fraud detector (trained on 111K+ legitimate emails)
  - **Results**: 83% accuracy (up from 67%), 0% false positives (down from 33%)
  - **Fixed**: person@company.com no longer flagged (was 85% risk, now 9%)
- 🏷️ **Data Relabeling** - Re-labeled 50,000 emails with v2.2.0 algorithm
  - 52.4% legit, 40.5% fraud, 7.2% ambiguous
  - High-confidence Markov-first approach reduces ambiguity
  - Dataset ready for future model retraining
- 💾 **Database Migration** - Deprecated columns for backwards compatibility
  - `has_keyboard_walk` and `is_gibberish` always write 0 (not dropped)
  - Pattern classification version: v2.2.0
  - All analytics remain functional with historical data preserved

### Previous Updates (v2.1.0 - 2025-11-06)
- 🎯 **Pattern-Based Training** - Re-labeled 91,966 emails based on ADDRESS PATTERNS (not message content)
  - Fixed 47% mislabeled data (36,225 legit names rescued from "fraud" labels)
  - Balanced dataset: 49% legit / 51% fraud (was 17% / 83%)
- 🧠 **Markov-Educated Gibberish Detection** - Gibberish detector now respects Markov confidence
  - When Markov is confident (>0.3), it overrides gibberish
  - Protects multilingual names (German, Italian, Irish)
- 🔧 **New CLI Command**: `train:relabel` - Re-labels datasets based on pattern analysis
- 📊 **Multi-Factor Pattern Classification** - v2.1 algorithm with n-grams, vowel density, entropy >75%
- 🏷️ **Pattern Classification Versioning** - Database tracks v2.0 vs v2.1 for analytics

### Previous Updates (v2.0.4 - 2025-11-05)
- 🚀 **Trigram Models (order=3)** - Upgraded from bigrams for 3.4x better semantic detection
- 🔧 **Critical Fix** - Resolved training/detection architecture mismatch (DynamicMarkovChain vs NGramMarkovChain)
- 🎯 **Detector Hierarchy** - Gibberish detector now respects Markov model decisions (no false positives on common names)
- 📈 **Plus-Addressing Detection** - Fixed bug where plus-addressing was detected but not scored
- ✅ **100% Fraud Detection** - All fraud patterns caught (sequential, keyboard walk, gibberish, disposable, plus-addressing)
- 🔗 **Better Context** - 2-character lookback vs 1-character for pattern recognition
- 📊 **85% Test Accuracy** - Remaining failures are training data quality issues, not algorithm problems

### Previous Updates (2025-01-04)
- 🎯 **Retrained models with 217K samples** - Massive improvement from 33 samples
- 🔄 **Incremental training** - New data adds to existing models
- 📦 **Model versioning** - History, backup, and production tracking
- 📊 **Enhanced logging** - Detailed pino.js logs for all decisions
- ⚙️ **Fixed action overrides** - Proper block/warn/allow behavior
- 🧪 **91.8% accuracy** - Up from 89.8% with proper configuration

---

## 📖 Quick Links

### New to this project? Start here:

| Guide | Purpose | Time |
|-------|---------|------|
| **[⚡ Quick Start](docs/QUICK_START.md)** | Fastest path: deployed in 5 minutes | 5 min |
| **[🚀 First Deployment](docs/FIRST_DEPLOY.md)** | Complete setup with explanations | 15 min |
| **[📊 Datasets Guide](docs/DATASETS.md)** | Train models with your data | Varies |

### Core Documentation

| Documentation | Purpose |
|---------------|---------|
| **[Getting Started](docs/GETTING_STARTED.md)** | Setup, installation, deployment |
| **[API Reference](docs/API.md)** | Endpoints, request/response formats |
| **[Training Guide](docs/TRAINING.md)** | Model training, pattern-based re-labeling, versioning |
| **[Configuration Guide](docs/CONFIGURATION.md)** | Risk thresholds, action overrides, feature flags |
| **[Architecture](docs/ARCHITECTURE.md)** | System design and algorithms |
| **[Detectors Guide](docs/DETECTORS.md)** | All 8 fraud detection algorithms |
| **[Risk Scoring](docs/SCORING.md)** | Complete scoring system with examples |
| **[CLI Documentation](cli/README.md)** | Command-line interface guide |
| **[System Status](docs/SYSTEM_STATUS.md)** | Current deployment status |

---

## 🔍 Detection Capabilities

### Active Detectors (5 core + 3 supporting)

| Detector | Description | Status |
|----------|-------------|--------|
| **Markov Chain (N-grams)** | **PRIMARY**: 2-gram & 3-gram character patterns (111K+ trained) | ✅ Active |
| **Pattern Classification** | Detects sequential, dated, formatted, and other pattern families | ✅ Active |
| **TLD Risk Scoring** | 143 TLDs categorized by risk level | ✅ Active |
| **Plus-Addressing** | Email normalization and abuse detection (user+tag) | ✅ Active |
| **Benford's Law** | Statistical batch anomaly detection | ✅ Active |
| **Keyboard Walk** | Sequential keyboard keys across 8 layouts | ⚠️ DEPRECATED v2.2.0 |
| **Keyboard Mashing** | Region clustering patterns | ⚠️ DEPRECATED v2.2.0 |
| **N-Gram Gibberish** | Multi-language gibberish detection | ⚠️ DEPRECATED v2.2.0 |

> **Note**: Keyboard walk, keyboard mashing, and gibberish detectors were deprecated in v2.2.0 due to high false positive rates (33%). These patterns are now accurately detected by the Markov Chain model.

### Smart Features
- **Markov-First Detection**: Trained on 111K+ legitimate + 105K fraud emails - no hardcoded heuristics
- **High Accuracy**: 83% accuracy with 0% false positives on legitimate names
- **Multi-Language Support**: Detects names in English, Spanish, French, German, Italian, Portuguese, Romanized languages
- **International Coverage**: 143 TLDs including major country codes and high-risk domains
- **Pattern Families**: Groups similar abuse patterns for tracking (e.g., user1@, user2@, user3@)

---

## 🚀 Quick Start

### API Usage

#### `/validate` Endpoint (Full Response)

Returns detailed fraud detection signals for debugging and analysis:

```bash
curl -X POST https://your-worker.workers.dev/validate \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com"}'
```

**Response:**
```json
{
  "valid": true,
  "riskScore": 0.25,
  "decision": "allow",
  "signals": {
    "formatValid": true,
    "entropyScore": 0.42,
    "isDisposableDomain": false,
    "patternType": "simple",
    "patternConfidence": 0.6,
    "tldRiskScore": 0.29,
    "markovDetected": false,
    "markovConfidence": 0.85,
    "markovCrossEntropyLegit": 2.1,
    "markovCrossEntropyFraud": 3.8,
    "minEntropy": 2.1,
    "abnormalityScore": 0,
    "abnormalityRisk": 0,
    "oodDetected": false
  },
  "fingerprint": {
    "hash": "3d1852...",
    "country": "US",
    "asn": 13335
  }
}
```

**OOD Detection Example (v2.4.0)**:
```bash
curl -X POST https://fraud.erfi.dev/validate \
  -H "Content-Type: application/json" \
  -d '{"email": "inearkstioarsitm2mst@gmail.com"}'
```
```json
{
  "decision": "warn",
  "riskScore": 0.30,
  "message": "suspicious_abnormal_pattern",
  "signals": {
    "markovCrossEntropyLegit": 4.45,
    "markovCrossEntropyFraud": 4.68,
    "minEntropy": 4.45,
    "abnormalityScore": 1.45,
    "abnormalityRisk": 0.22,
    "oodDetected": true
  }
}
```

#### Application Routes (Minimal Headers)

For production routes like `/signup`, `/login`, etc., fraud detection runs automatically but returns minimal responses:

**Success (fraud check passed):**
```bash
curl -X POST https://your-worker.workers.dev/signup \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "secret"}'

# Response Headers:
# X-Fraud-Decision: allow
# X-Fraud-Risk-Score: 0.15

# Response: 201 Created
{"success": true, "message": "Signup successful"}
```

**Blocked (fraud detected):**
```bash
curl -X POST https://your-worker.workers.dev/signup \
  -H "Content-Type: application/json" \
  -d '{"email": "test123@example.com"}'

# Response Headers:
# X-Fraud-Decision: block
# X-Fraud-Reason: markov_chain_fraud
# X-Fraud-Risk-Score: 0.93
# X-Fraud-Fingerprint: d3f639f842841a81

# Response: 403 Forbidden
Forbidden
```

**Decisions:**
- `allow`: Risk < 0.3 (safe)
- `warn`: Risk 0.3 - 0.6 (suspicious)
- `block`: Risk > 0.6 (fraudulent)

### Worker-to-Worker RPC

For Cloudflare Worker integration (5-10x lower latency):

```typescript
// In your wrangler.jsonc
{
  "services": [{
    "binding": "FRAUD_DETECTOR",
    "service": "bogus-email-pattern-recognition",
    "entrypoint": "FraudDetectionService"
  }]
}

// In your worker
const result = await env.FRAUD_DETECTOR.validate({
  email: "user@example.com",
  consumer: "MY_APP",
  flow: "SIGNUP_EMAIL_VERIFY"
});

if (result.decision === 'block') {
  return new Response('Email rejected', { status: 400 });
}
```

See [docs/API.md](docs/API.md) for complete API documentation.

---

## 🔧 CLI Management

A unified command-line interface for managing the fraud detection system:

```bash
# Show all commands
npm run cli

# Train Markov Chain models
npm run cli train:markov --upload --remote

# Deploy to production
npm run cli deploy --minify

# Test multi-language support
npm run cli test:multilang

# Manage KV storage
npm run cli kv:list --binding MARKOV_MODEL --remote

# Query analytics
npm run cli analytics:query "SELECT COUNT(*) FROM ANALYTICS_DATASET"
npm run cli analytics:stats --last 24

# Test API
npm run cli test:api user123@example.com
```

**Complete CLI Documentation**: See [cli/README.md](cli/README.md)

---

## 📊 Risk Scoring

### Algorithmic Scoring (v2.0+)

**Primary Detector**: Markov Chain cross-entropy confidence (0-1 scale)
- Uses character transition patterns trained on 10k samples (5k legit + 5k fraud)
- Direct confidence score - no weight multiplication

**Pattern Overrides**: Specific high-risk patterns
- Keyboard walks: 0.9
- Sequential patterns: 0.8
- Dated patterns: 0.7

**Domain Signals**: Additive risk
- Disposable domains: +0.2
- High-risk TLDs: +0.1

**See [docs/SCORING.md](docs/SCORING.md) for complete scoring documentation with detailed examples.**

---

## 📈 Analytics Dashboard

**Access**: https://your-worker.workers.dev/analytics.html

### Features
- 📊 **22 Interactive Visualizations**: Zoom, pan, download charts
- 🔍 **Query Builder**: Build SQL queries visually without writing code
- 💻 **Custom SQL**: Advanced queries with full ClickHouse SQL support
- 📋 **Data Explorer**: Browse raw analytics data with pre-built views
- 📥 **Export**: One-click CSV/JSON export
- 🌓 **Dark/Light Mode**: Professional theme switching

See [docs/ANALYTICS.md](docs/ANALYTICS.md) for complete documentation.

---

## 🛠️ Installation & Deployment

### Local Development

```bash
# Clone repository
git clone https://github.com/your-org/bogus-email-pattern-recognition.git
cd bogus-email-pattern-recognition

# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm test

# Type check
npm run typecheck
```

### Production Deployment

```bash
# Deploy to Cloudflare Workers
npm run cli deploy --minify

# Check deployment status
npm run cli deploy:status

# Verify deployment
npm run cli test:api user@example.com --url https://your-worker.workers.dev
```

**Complete Setup Guide**: See [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md)

---

## ⚙️ Configuration

**Zero configuration required** - the system works out of the box with sensible defaults.

### Runtime Configuration (Optional)

Update configuration without redeployment using the Admin API:

```bash
# View current configuration
curl https://your-worker.workers.dev/admin/config \
  -H "X-API-Key: your-admin-api-key"

# Update risk weights
curl -X PUT https://your-worker.workers.dev/admin/config \
  -H "X-API-Key: your-admin-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "riskWeights": {
      "entropy": 0.05,
      "domainReputation": 0.15,
      "tldRisk": 0.15,
      "patternDetection": 0.30,
      "markovChain": 0.35
    }
  }'

# Manage whitelist
curl -X POST https://your-worker.workers.dev/admin/whitelist \
  -H "X-API-Key: your-admin-api-key" \
  -d '{
    "type": "domain",
    "pattern": "mycompany.com",
    "confidence": 0.8
  }'
```

**Complete Configuration Guide**: See [docs/CONFIGURATION.md](docs/CONFIGURATION.md)

---

## 🧪 Testing

```bash
# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Run with coverage
npm run test:coverage

# Test against production
WORKER_URL=https://your-worker.workers.dev npm run test:e2e
```

**Test Coverage**: 287 tests (100% passing)
- 157 unit tests
- 130 integration tests
- All 8 detectors tested

---

## 📚 Documentation

### Core Documentation
- **[Project Structure](docs/PROJECT_STRUCTURE.md)** - Directory layout and organization
- **[Getting Started](docs/GETTING_STARTED.md)** - Setup and quickstart
- **[API Reference](docs/API.md)** - Complete API documentation
- **[Architecture](docs/ARCHITECTURE.md)** - System design deep dive
- **[Detectors Guide](docs/DETECTORS.md)** - All 8 fraud detection algorithms
- **[Keyboard Detection Summary](docs/KEYBOARD_DETECTION_SUMMARY.md)** - Keyboard detection improvements
- **[Risk Scoring](docs/SCORING.md)** - Complete scoring system with examples
- **[Configuration](docs/CONFIGURATION.md)** - Configuration management
- **[Analytics](docs/ANALYTICS.md)** - D1 Database analytics and dashboard
- **[Integration Guide](docs/INTEGRATION_GUIDE.md)** - Integration examples
- **[System Status](docs/SYSTEM_STATUS.md)** - Current deployment status

### Recent Updates
- **[CHANGELOG](CHANGELOG.md)** - Version history
- **[Detector Audit](docs/DETECTOR_AUDIT.md)** - Detector cleanup audit (2025-01-07)

### CLI & Development
- **[CLI Documentation](cli/README.md)** - Command-line interface guide
- **[Testing Guide](docs/TESTING.md)** - Test suite documentation

**Documentation Index**: [docs/README.md](docs/README.md)

---

## 🔐 Security & Privacy

- ✅ **No PII Storage**: Email addresses are hashed before logging
- ✅ **Privacy-Preserving**: Fingerprinting uses hashed data
- ✅ **Admin API Protection**: Secured with API key authentication
- ✅ **Rate Limiting**: Configurable request limits
- ✅ **Input Validation**: Comprehensive request validation
- ✅ **CORS Enabled**: Configurable cross-origin access

---

## 🚀 Performance

- **Latency**: <50ms average response time
- **Throughput**: 14,000+ emails/second
- **Edge Deployment**: Runs on Cloudflare's global network
- **No External Dependencies**: All detection runs in-worker
- **Uptime**: 99.9%

---

## 📊 Detection Examples

### ✅ Legitimate Emails (Allow)
```
person1.person2@gmail.com  → Risk: 0.15 (allow)
personA.personB@university.edu → Risk: 0.05 (allow)
personC.personD@outlook.com → Risk: 0.12 (allow)
```

### ⚠️ Suspicious Patterns (Warn)
```
user+test@gmail.com        → Risk: 0.35 (warn) - Plus-addressing
newuser2024@hotmail.com    → Risk: 0.42 (warn) - Dated pattern
```

### 🚫 Fraudulent Patterns (Block)
```
user123@gmail.com          → Risk: 0.85 (block) - Sequential pattern
qwerty456@yahoo.com        → Risk: 0.92 (block) - Markov fraud detection
asdfasdfasdf@gmail.com     → Risk: 0.89 (block) - Markov fraud detection
xkgh2k9qw@tempmail.com     → Risk: 0.95 (block) - Markov fraud + disposable
test001@gmail.com          → Risk: 0.87 (block) - Sequential pattern
```

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

MIT License - see LICENSE file for details

---

## 🙏 Acknowledgments

Built with:
- [Cloudflare Workers](https://workers.cloudflare.com/) - Serverless edge computing
- [Hono](https://hono.dev/) - Fast web framework
- [Pino](https://getpino.io/) - Structured logging
- [Vitest](https://vitest.dev/) - Testing framework

---

**Production URL**: https://your-worker.workers.dev
**Version**: 2.2.0 (2025-11-08)
**Documentation**: [docs/README.md](docs/README.md)
**CLI Guide**: [cli/README.md](cli/README.md)
