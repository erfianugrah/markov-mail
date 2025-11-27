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
| **[CLI Reference](../cli/README.md)** | Command-line interface for all operations | Developers, DevOps |
| **[Logging Standards](LOGGING_STANDARDS.md)** | Structured logging with Pino.js, event naming | Developers, DevOps |
| **[Analytics](ANALYTICS.md)** | D1 metrics + dashboard queries | Analysts |
| **[Integration Guide](INTEGRATION_GUIDE.md)** | Integration examples | Developers |
| **[Testing](TESTING.md)** | Test suite and coverage | QA |
| **[System Status](SYSTEM_STATUS.md)** | Current deployment status | All |

---

## 📊 Project Status

**Production**: ✅ **Live at https://your-worker.workers.dev**

**Version**: 2.4.2 (2025-01-12)

**Detection Stack**:
- **Primary**: Markov Chain ensemble (2-gram + 3-gram) with OOD detection
- **Deterministic**: Pattern classification (dated + high-confidence sequential patterns feed scoring, lighter hits stay telemetry-only), plus-addressing risk scorer
- **Domain Signals**: TLD risk profiles + disposable domain reputation
- **Batch**: Benford's Law (offline/batch analysis)
- **Deprecated**: Keyboard Walk, Keyboard Mashing, N-Gram Gibberish remain disabled

**Training Data**: 91K+ legit + 41K+ fraud samples (latest Markov models)

**Performance**:
- Latency: ~35ms average
- Storage: Cloudflare D1 (validations, admin, training, AB tests)
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
├── ../cli/README.md               # Command-line interface (43 commands)
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
3. **[CLI Reference](../cli/README.md)** - Command-line operations
4. **[Logging Standards](LOGGING_STANDARDS.md)** - Structured logging guide

---

## 🔧 Key System Components

### Detection Stack (v2.4.2)

- **Markov Chain (2-gram + 3-gram)** – Primary scoring, cross-entropy, and OOD detection (with short-local clamp that zeroes abnormality risk for ≤4 character locals and ramps 5‑12). Logistic calibration is treated as a boost on top of Markov confidence, never a replacement.
- **Pattern Classification** – Extracts sequential/dated/simple families; dated patterns always score, sequential patterns feed scoring only when confidence clears configured thresholds (legit ≤3-digit suffixes stay observability-only)
- **Plus-Addressing Risk Scorer** – Normalizes aliases and assigns 0.2‑0.9 risk when abuse is detected
- **Disposable/TLD Signals** – KV-backed disposable list + TLD risk profiles
- **Benford's Law** – Optional batch analysis for large datasets
- **Deprecated** – Keyboard walk/mashing + standalone gibberish detectors remain disabled (Markov covers them)
- **A/B Experiments** – KV-driven overrides for treatment variants without redeploying

See [Detectors Guide](DETECTORS.md) for complete technical details.

### Experiment Controls

- Create/stop experiments via CLI (`npm run cli ab:create`, `ab:status`, `ab:stop`)
- Worker middleware applies variant overrides automatically and logs `experiment_id`, `variant`, and `bucket` to D1
- Dashboard overview + explorer fetch experiment status from `/admin/ab-test/status`
- Programmatic status: `curl -H "X-API-Key:..." https://your-worker.dev/admin/ab-test/status`

### Risk Scoring Strategy

**Two-Dimensional Markov Approach (v2.4.x)**:
1. **Classification Risk** – Fraud vs legit cross-entropy difference
2. **Abnormality Risk** – OOD detection using min(H_legit, H_fraud) with piecewise thresholds (3.8 warn / 5.5 block)
3. **Deterministic Signals** – Dated patterns (0.2‑0.9), sequential overrides for high-confidence automation (0.45‑0.95), plus-addressing risk helper (0.2 base + suspicious tag/group boosts)
4. **Domain Signals** – `riskWeights.domainReputation` (default 0.2) + `riskWeights.tldRisk` (0.3)

Final score = `max(classificationRisk, abnormalityRisk)` + domain signals (+ ensemble boost when Markov + TLD agree). See [SCORING.md](SCORING.md) for full details.

---

## 🔧 Command Line Interface

**43 commands across 6 categories** - See **[CLI Reference](../cli/README.md)** for complete documentation.

### Quick Reference

```bash
# Show all commands
npm run cli

# Training & Online Learning
npm run cli train:markov              # Train Markov models from CSV
npm run cli training:extract          # Pull validations from D1 for offline training
npm run cli training:train            # Train from production data
npm run cli training:validate         # Validate before deployment

# Deployment
npm run cli deploy --minify           # Deploy to Cloudflare
npm run cli deploy:status             # Check deployment status

# Data Management (KV & D1)
npm run cli kv:list --binding CONFIG  # List KV keys
npm run cli kv:get <key>              # Get KV value
npm run cli analytics:query <sql>     # Run D1 SQL via /admin/analytics
npm run cli analytics:stats --last 24 # Built-in analytics summaries

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

**For detailed usage, workflows, and examples:** See [CLI Reference](../cli/README.md)

---

## 📈 Detection Capabilities

**Fraud Patterns Detected**:
- ✅ Markov ensemble (2-gram + 3-gram) with OOD detection
- ✅ Sequential overrides for high-confidence automation (0.45‑0.95 risk once threshold met)
- ✅ Dated pattern overrides (0.2‑0.9 confidence)
- ✅ Plus-addressing alias abuse (0.2‑0.9 risk)
- ✅ Disposable domains (71K+ services) and domain reputation scoring
- ✅ TLD risk profiling (143+ TLD categories)
- ✅ Benford's Law (batch analysis)
- ⚠️ Keyboard/gibberish heuristics remain telemetry-only; rely on Markov for enforcement

**False-Positive Guardrails**:
- Professional mailbox detection (info@, support@, admin@, etc.)
- Birth-year awareness inside sequential detector
- Professional-domain risk dampening factors
- Configurable action overrides (`allow`, `warn`, `block`)

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

**Current Version**: 2.4.2 (2025-01-12)

**Recent Highlights**:
- **2.4.2** (2025-01-12): Two-dimensional scoring clarifications, plus-addressing risk helper, tunable domain weights, D1-only metrics
- **2.4.1** (2025-01-12): Piecewise OOD thresholds (3.8/5.5 nats) + ood_zone analytics
- **2.4.0** (2025-01-10): Two-dimensional risk model + abnormality tracking columns
- **2.3.x**: Ensemble (2-gram + 3-gram) Markov models, enhanced telemetry

---

## 🆘 Support & Resources

**Documentation**:
- Start here: [Getting Started](GETTING_STARTED.md)
- API questions: [API Reference](API.md)
- System architecture: [Architecture](ARCHITECTURE.md)
- Integration: [Integration Guide](INTEGRATION_GUIDE.md)

**External Resources**:
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)
- [RFC 5322 - Email Format](https://tools.ietf.org/html/rfc5322)

---

**Production URL**: https://your-worker.workers.dev
**Last Updated**: 2025-01-12
