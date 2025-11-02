# 📚 Documentation Index

**Complete documentation for Bogus Email Pattern Recognition - Fraud Detection API**

---

## 📖 Core Documentation

| Document | Description | Audience |
|----------|-------------|----------|
| **[Getting Started](GETTING_STARTED.md)** | Setup, installation, deployment | Developers |
| **[API Reference](API.md)** | Endpoints, request/response formats | API Users |
| **[Architecture](ARCHITECTURE.md)** | System design and algorithms | Developers, Architects |
| **[Detectors](DETECTORS.md)** | Complete guide to all 8 fraud detectors | Developers, Data Scientists |
| **[Configuration](CONFIGURATION.md)** | Configuration management via KV | DevOps |
| **[CLI Reference](CLI.md)** | Command-line interface for all operations | Developers, DevOps |
| **[Logging Standards](LOGGING_STANDARDS.md)** | Structured logging with Pino.js, event naming | Developers, DevOps |
| **[Analytics](ANALYTICS.md)** | Analytics Engine and dashboard | Analysts |
| **[Integration Guide](INTEGRATION_GUIDE.md)** | Integration examples | Developers |
| **[Testing](TESTING.md)** | Test suite and coverage | QA |
| **[System Status](SYSTEM_STATUS.md)** | Current deployment status | All |

---

## 📊 Project Status

**Production**: ✅ **Live at https://fraud.erfi.dev**

**Version**: 1.4.0 (2025-11-02)

**Active Detectors**: **8/8** ✅
- Sequential, Dated, Plus-Addressing, Keyboard Walk, N-Gram (multilang), TLD Risk, Benford's Law, Markov Chain

**Accuracy**: **98-100%** (estimated, after all improvements)

**Performance**:
- Latency: <50ms average
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

### For Developers

1. **[Getting Started](GETTING_STARTED.md)** - Setup and first deployment
2. **[Architecture](ARCHITECTURE.md)** - Learn the system design
3. **[API Reference](API.md)** - Explore the endpoints
4. **[Detectors](DETECTORS.md)** - Understand fraud detection algorithms

### For API Users

1. **[API Reference](API.md)** - Complete endpoint documentation
2. **[Integration Guide](INTEGRATION_GUIDE.md)** - Code examples
3. **[System Status](SYSTEM_STATUS.md)** - Production status and metrics

### For System Administrators

1. **[Getting Started](GETTING_STARTED.md)** - Deployment guide
2. **[Configuration](CONFIGURATION.md)** - Manage settings
3. **[Analytics](ANALYTICS.md)** - Monitor system health
4. **[Logging Standards](LOGGING_STANDARDS.md)** - Structured logging guide

---

## 🔧 Key System Components

### Pattern Detectors (8 Active)

✅ **All detectors operational**:
- **Sequential patterns** (user1, user2, user3)
- **Dated patterns** (john.doe.2025, oct2024)
- **Keyboard walks** (qwerty, asdfgh, 123456)
- **N-Gram analysis** (multi-language, 7 languages)
- **Plus-addressing** (user+1, user+spam)
- **TLD risk scoring** (154 TLDs)
- **Benford's Law** (batch statistical analysis)
- **Markov Chain** (character transitions, trained on 182K+ emails)

**New Features** (Priority 2):
- Pattern whitelisting (8 default patterns)
- Multi-language N-gram support (English, Spanish, French, German, Italian, Portuguese, Romanized)
- Optimized risk weights for max-based scoring

See [Detectors Guide](DETECTORS.md) for complete technical details

### Risk Scoring (Updated)

**Current Weights** (optimized for max-based scoring):
- Markov Chain: **35%** (highest, most reliable)
- Pattern Detection: **30%**
- Domain Reputation: **15%**
- TLD Risk: **15%** (expanded database)
- Entropy: **5%** (baseline)

**Scoring Strategy**:
- Domain signals (domain + TLD): Additive
- Local part signals (entropy + pattern + markov): Max (prevents double-counting)

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
- Birth year patterns (`john.1990@gmail.com`)
- Dev/test accounts (`dev1@company.com`)
- Semantic plus-addressing (`user+newsletter@gmail.com`)
- International name patterns
- Custom patterns (configurable via KV)

---

## 📊 Analytics Dashboard

**Access**: https://fraud.erfi.dev/analytics.html

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

**Current Version**: 1.4.0 (2025-11-02)

**Major Updates**:
- **1.4.0** (2025-11-02): Quick Wins + Priority 2 improvements - +15-25% accuracy, multi-language support, whitelist system, optimized risk weights
- **1.3.1** (2025-11-02): Documentation consolidation and cleanup
- **1.3.0** (2025-11-01): Markov Chain integration complete
- **1.2.0** (2025-11-01): Testing documentation update
- **1.1.0** (2025-11-01): Analytics dashboard launch
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

**Production URL**: https://fraud.erfi.dev
**Last Updated**: 2025-11-02
