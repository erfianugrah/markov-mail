# 📚 Documentation Index

**Complete documentation for Bogus Email Pattern Recognition - Fraud Detection API**

---

## 📖 Core Documentation

| Document | Description | Audience |
|----------|-------------|----------|
| **[Quick Start](QUICK_START.md)** | 5-minute deployment guide | Beginners |
| **[First Deployment](FIRST_DEPLOY.md)** | Complete setup walkthrough (15 min) | Beginners |
| **[Datasets Guide](DATASETS.md)** | Training data format and model training | ML Users, Data Scientists |
| **[Getting Started](GETTING_STARTED.md)** | Detailed setup, installation, deployment | Developers |
| **[API Reference](API.md)** | Endpoints, request/response formats | API Users |
| **[Architecture](ARCHITECTURE.md)** | System design and algorithms | Developers, Architects |
| **[Detectors](DETECTORS.md)** | Complete guide to all 8 fraud detectors | Developers, Data Scientists |
| **[Risk Scoring](SCORING.md)** | Complete scoring system with examples | Developers, Analysts |
| **[Configuration](CONFIGURATION.md)** | Configuration management via KV | DevOps |
| **[CLI Reference](CLI.md)** | Command-line interface for all operations | Developers, DevOps |
| **[Logging Standards](LOGGING_STANDARDS.md)** | Structured logging with Pino.js, event naming | Developers, DevOps |
| **[Analytics](ANALYTICS.md)** | Analytics Engine and dashboard | Analysts |
| **[Integration Guide](INTEGRATION_GUIDE.md)** | Integration examples | Developers |
| **[Testing](TESTING.md)** | Test suite and coverage | QA |
| **[System Status](SYSTEM_STATUS.md)** | Current deployment status | All |

---

## 📊 Project Status

**Production**: ✅ **Live at https://your-worker.workers.dev**

**Version**: 2.1.1 (2025-01-07)

**Active Detectors**: **8/8** ✅
- Markov Chain (N-grams), Keyboard Walk, Keyboard Mashing, Pattern Classification, N-Gram Analysis, TLD Risk, Plus-Addressing, Benford's Law

**Training Data**: 91,966 labeled emails (50.2K legit + 41.8K fraud)

**Performance**:
- Latency: ~35ms average
- Throughput: 14,000+ emails/second
- Uptime: 99.9%

---

## 🏗️ Documentation Structure

```
docs/
├── README.md                      # This file - documentation index
├── GETTING_STARTED.md             # Setup and quickstart
├── API.md                         # API reference
├── ARCHITECTURE.md                # System design
├── DETECTORS.md                   # All 8 detector algorithms
├── SCORING.md                     # Risk scoring system with examples
├── CONFIGURATION.md               # Config management
├── CLI.md                         # Command-line interface (29 commands)
├── LOGGING_STANDARDS.md           # Structured logging with Pino.js
├── ANALYTICS.md                   # Analytics & dashboard
├── INTEGRATION_GUIDE.md           # Integration examples
├── TESTING.md                     # Testing documentation
└── SYSTEM_STATUS.md               # Deployment status
```

---

## 🎯 Quick Start Guide

### For New Users (Start Here!)

1. **[Quick Start](QUICK_START.md)** - Fastest path: deployed in 5 minutes
2. **[First Deployment](FIRST_DEPLOY.md)** - Complete setup with explanations (15 minutes)
3. **[Datasets Guide](DATASETS.md)** - Train models with your data
4. **[API Reference](API.md)** - Use the fraud detection API

### For Developers

1. **[Getting Started](GETTING_STARTED.md)** - Detailed setup and development guide
2. **[Architecture](ARCHITECTURE.md)** - Learn the system design
3. **[Detectors](DETECTORS.md)** - Understand fraud detection algorithms
4. **[Risk Scoring](SCORING.md)** - Complete scoring system with examples

### For API Users

1. **[API Reference](API.md)** - Complete endpoint documentation
2. **[Integration Guide](INTEGRATION_GUIDE.md)** - Code examples
3. **[System Status](SYSTEM_STATUS.md)** - Production status and metrics

### For System Administrators

1. **[Configuration](CONFIGURATION.md)** - Manage settings
2. **[Analytics](ANALYTICS.md)** - Monitor system health
3. **[CLI Reference](CLI.md)** - Command-line operations
4. **[Logging Standards](LOGGING_STANDARDS.md)** - Structured logging guide

---

## 🔧 Key System Components

### Pattern Detectors (8 Active)

✅ **All detectors operational**:
- **Markov Chain (N-grams)** - PRIMARY: Trained on 91K emails with 2-gram & 3-gram models
- **Keyboard Walk** - Sequential keyboard keys across 8 layouts (QWERTY, Dvorak, Colemak, etc.)
- **Keyboard Mashing** - Region clustering detection (NEW in v2.1.1)
- **Pattern Classification** - Detects sequential, dated, and pattern families
- **N-Gram Analysis** - Gibberish detection with multi-language support
- **TLD Risk Scoring** - 143 TLDs categorized by fraud risk
- **Plus-Addressing** - Email normalization and plus-tag detection
- **Benford's Law** - Statistical batch anomaly detection

See [Detectors Guide](DETECTORS.md) for complete technical details

### Risk Scoring Strategy

**Markov-First Approach**:
1. **PRIMARY**: Markov model confidence (trained on 91K emails)
2. **OVERRIDES**: Deterministic pattern detections
   - Keyboard walk: 0.9
   - Keyboard mashing: 0.85
   - Sequential: 0.8
   - Plus-addressing: 0.6
3. **DOMAIN SIGNALS**: Disposable (0.95), Reputation (+0.2), TLD (+0.1)
4. **SUPPORTING**: Gibberish detection applied when Markov agrees

**Key Principle**: Trained models take precedence over heuristic detectors.

---

## 🔧 Command Line Interface

**29 commands across 5 categories** - See **[CLI Reference](CLI.md)** for complete documentation.

### Quick Reference

```bash
# Show all commands
npm run cli

# Training & Online Learning
npm run cli train:markov              # Train Markov models from CSV
npm run cli training:extract          # Extract data from Analytics Engine
npm run cli training:train            # Train from production data
npm run cli training:validate         # Validate before deployment

# Deployment
npm run cli deploy --minify           # Deploy to Cloudflare
npm run cli deploy:status             # Check deployment status

# Data Management (KV & Analytics)
npm run cli kv:list --binding CONFIG  # List KV keys
npm run cli kv:get <key>              # Get KV value
npm run cli analytics:query <sql>     # SQL queries
npm run cli analytics:stats --last 24 # Show statistics

# Testing
npm run cli test:api <email>          # Test API endpoint
npm run cli test:detectors            # Test pattern detectors
npm run cli test:generate --count 100 # Generate test data

# A/B Testing
npm run cli ab:create                 # Create experiment
npm run cli ab:analyze                # Analyze results
npm run cli ab:stop                   # Stop experiment

# Configuration
npm run cli config:list               # List all config
npm run cli config:sync --remote      # Sync to production
```

**For detailed usage, workflows, and examples:** See [CLI Reference](CLI.md)

---

## 📈 Detection Capabilities

**Fraud Patterns Detected** (8 active):
- ✅ Sequential numbering patterns
- ✅ Dated email patterns
- ✅ Keyboard walk patterns
- ✅ Gibberish strings (multi-language)
- ✅ Plus-addressing abuse
- ✅ Disposable domains (170+ services)
- ✅ High-risk TLDs (154 TLDs)
- ✅ Statistical anomalies (Benford's Law)
- ✅ Character transition patterns (Markov Chain)

**Whitelist Patterns** (reduces false positives):
- Business employee emails (`employee1@company.com`)
- Birth year patterns (`person1.person2@gmail.com`)
- Dev/test accounts (`dev1@company.com`)
- Semantic plus-addressing (`user+newsletter@gmail.com`)
- International name patterns
- Custom patterns (configurable via KV)

---

## 📊 Analytics Dashboard

**Access**: https://your-worker.workers.dev/analytics.html

**Features**:
- 22 interactive visualizations
- Custom SQL query builder
- Real-time metrics
- Historical analysis
- Export capabilities

See [Analytics Documentation](ANALYTICS.md)

---

## 🔐 Security & Privacy

- Admin API key protection
- No PII storage
- Email hashing in logs
- Rate limiting
- Input validation

---

## 📅 Version History

**Current Version**: 2.1.1 (2025-01-07)

**Major Updates**:
- **2.1.1** (2025-01-07): Keyboard mashing detector, 8 keyboard layouts, detector architecture cleanup
- **2.1.0** (2025-11-06): Pattern-based training (91K emails), Markov-educated gibberish detection
- **2.0.5** (2025-11-05): Trigram models, birth year protection, false positive reduction
- **2.0.4** (2025-11-05): Architecture mismatch fixes, detector hierarchy
- **1.4.0** (2025-11-02): Multi-language support, whitelist system
- **1.0.0** (2025-10-31): Initial production release

---

## 🆘 Support & Resources

**Documentation**:
- Start here: [Getting Started](GETTING_STARTED.md)
- API questions: [API Reference](API.md)
- System architecture: [Architecture](ARCHITECTURE.md)
- Integration: [Integration Guide](INTEGRATION_GUIDE.md)

**External Resources**:
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Analytics Engine](https://developers.cloudflare.com/analytics/analytics-engine/)
- [RFC 5322 - Email Format](https://tools.ietf.org/html/rfc5322)

---

**Production URL**: https://your-worker.workers.dev
**Last Updated**: 2025-01-07
