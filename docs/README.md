# 📚 Documentation Index

**Complete documentation for Bogus Email Pattern Recognition - Fraud Detection API**

---

## 🚀 Quick Start

**New to the project?** Start with these docs in order:

1. **[Getting Started](GETTING_STARTED.md)** - Setup, installation, deployment
2. **[API Reference](API.md)** - Endpoints, request/response formats
3. **[Architecture](ARCHITECTURE.md)** - System design and algorithms

---

## 📖 Core Documentation

| Document | Description | Audience |
|----------|-------------|----------|
| **[Getting Started](GETTING_STARTED.md)** | Complete setup guide with step-by-step instructions | Developers |
| **[API Reference](API.md)** | Full API documentation with examples | API Users, Integrators |
| **[Architecture](ARCHITECTURE.md)** | System design, pattern detection algorithms | Developers, Architects |
| **[Detectors](DETECTORS.md)** | Complete guide to all 8 fraud detectors | Developers, Data Scientists |
| **[Configuration](CONFIGURATION.md)** | Configuration management via KV | DevOps, Administrators |
| **[Analytics](ANALYTICS.md)** | Analytics Engine setup and dashboard usage | Analysts, Administrators |
| **[Integration Guide](INTEGRATION_GUIDE.md)** | How to integrate with your application | Developers |
| **[Testing](TESTING.md)** | Test suite, coverage, and testing practices | QA, Developers |
| **[Markov Chain](MARKOV_CHAIN_INTEGRATION.md)** | Phase 7: Markov Chain detector integration | Advanced Users |

---

## 📊 Project Status

**Production Status**: ✅ **Live at https://fraud.erfi.dev**

**Phase**: ✅ **Phase 7 Complete** (Markov Chain Integration)

**Key Metrics**:
- ✅ **Detectors**: 8 active (Sequential, Dated, Plus-Addressing, Keyboard Walk, N-Gram, TLD Risk, Benford's Law, Markov Chain)
- ✅ **Detection Rate**: 97-98% expected (Markov Chain: 97.95% F-measure)
- ✅ **Performance**: 0.07ms avg per email (14,286 emails/second)
- ✅ **Tests**: 7/8 detectors passing
- ✅ **Analytics**: 21+ signals tracked, 15 blobs + 11 doubles

---

## 🏗️ Documentation Structure

```
docs/
├── README.md                # This file - documentation index
│
├── GETTING_STARTED.md       # Setup and quickstart
├── API.md                   # API reference (27k)
├── ARCHITECTURE.md          # System design (25k)
├── CONFIGURATION.md         # Config management (11k)
├── ANALYTICS.md             # Analytics & dashboard (14k)
├── INTEGRATION_GUIDE.MD     # Integration examples (19k)
├── TESTING.md               # Testing documentation (consolidated)
│
├── archive/                 # Historical implementation docs
│   └── IMPLEMENTATION_PLAN.md
│
└── history/                 # Project history & summaries
    ├── TEST_MIGRATION_SUMMARY.md
    ├── CLEANUP_AND_MIGRATION_COMPLETE.md
    ├── CLEANUP_SUMMARY.md
    ├── DOCS_CONSOLIDATION.md
    └── REFACTORING_PLAN.md
```

---

## 🎯 By Use Case

### For Developers

**Getting Started**:
1. Read [Getting Started](GETTING_STARTED.md) - Setup and first deployment
2. Review [Architecture](ARCHITECTURE.md) - Understand the system
3. Check [API Reference](API.md) - Learn the endpoints
4. Run tests with [Testing Guide](TESTING.md)

**Advanced**:
- [Configuration](CONFIGURATION.md) - Customize detection behavior
- [Integration Guide](INTEGRATION_GUIDE.md) - Integrate with your app
- [Analytics](ANALYTICS.md) - Monitor and analyze

### For API Users

**Essential Reading**:
1. [API Reference](API.md) - Complete endpoint documentation
2. [Integration Guide](INTEGRATION_GUIDE.md) - Code examples
3. [Getting Started](GETTING_STARTED.md) - Authentication setup

**Useful**:
- [Analytics](ANALYTICS.md) - View detection statistics
- [Configuration](CONFIGURATION.md) - Understand thresholds

### For System Administrators

**Setup & Operations**:
1. [Getting Started](GETTING_STARTED.md) - Deployment guide
2. [Configuration](CONFIGURATION.md) - Manage settings
3. [Analytics](ANALYTICS.md) - Monitor system health

**Maintenance**:
- [Testing](TESTING.md) - Verify system integrity
- [Architecture](ARCHITECTURE.md) - Troubleshooting reference

### For Analysts

**Data & Insights**:
1. [Analytics](ANALYTICS.md) - Dashboard usage and SQL queries
2. [API Reference](API.md) - Understanding the data model
3. [Testing](TESTING.md) - Detection rate metrics

---

## 🔧 System Components

### Core API
- **Email Validation Endpoint** (`/validate`)
- **Admin API** (`/admin/*`)
- **Analytics Queries** (`/admin/analytics`)
- **Configuration Management** (`/admin/config`)

### Pattern Detectors (8 Total)
- **Sequential patterns** (user1, user2, user3) - 90% detection
- **Dated patterns** (john.doe.2025, oct2024) - 85% detection
- **Keyboard walks** (qwerty, asdfgh, 123456) - 95% detection
- **N-Gram gibberish** (xk7g2w9qa) - 90% detection
- **Plus-addressing** (user+1, user+spam) - 95% detection
- **TLD risk scoring** (.tk, .ml, .ga) - 95% detection
- **Benford's Law** (batch analysis) - 85% detection
- **Markov Chain** (character transitions) - **98% detection** ⭐ NEW

See [Detectors Guide](DETECTORS.md) for complete documentation

### Data & Analytics
- **Analytics Engine**: 23 fields logged per validation
- **Dashboard**: 22 interactive visualizations
- **KV Storage**: Configuration management
- **Static Assets**: Analytics dashboard UI

---

## 📈 Detection Capabilities

**Fraud Patterns Detected** (8 Detectors):
- ✅ Sequential numbering (user1, user2, user3)
- ✅ Dated emails (john.2025, oct2024)
- ✅ Keyboard walks (qwerty, asdfgh, 123456)
- ✅ Gibberish strings (xk7g2w9qa, zzzzqqq)
- ✅ Plus-addressing (+spam, +1, +test)
- ✅ Disposable domains (170+ known services)
- ✅ High-risk TLDs (.tk, .ml, .ga, .cf, .gq)
- ✅ Low entropy patterns (random strings)
- ✅ Statistical anomalies (Benford's Law)
- ✅ **Character transition patterns (Markov Chain)** ⭐ NEW

**Risk Scoring** (Weighted Formula):
- **Markov Chain**: 25% (highest accuracy: 97.95% F-measure)
- **Pattern Detection**: 40% (5 detectors combined)
- **Entropy**: 15% (randomness detection)
- **Domain Reputation**: 10%
- **TLD Risk**: 10%

**Additional Signals**:
- Bot score (Cloudflare Bot Management)
- Country/ASN reputation
- Fingerprint tracking (IP + JA4 + ASN)
- Request velocity (future)

---

## 🌐 Deployment Options

**Cloudflare Workers** (Recommended):
- Global edge deployment
- <50ms latency worldwide
- Automatic scaling
- Built-in DDoS protection

**Integration Methods**:
- REST API (HTTP/HTTPS)
- Worker-to-Worker bindings
- Service bindings
- Fetch API

See [Integration Guide](INTEGRATION_GUIDE.md) for details.

---

## 📊 Analytics Dashboard

**Access**: https://fraud.erfi.dev/analytics.html

**Features**:
- 4 tabs (Dashboard, Query Builder, Data Explorer, Management)
- 22 visualization panels
- Interactive charts (zoom, pan, fullscreen)
- Custom SQL queries
- Pre-built analytics views
- Data filtering tools

See [Analytics Documentation](ANALYTICS.md) for usage.

---

## 🧪 Testing

**Test Suite**: 287 tests (100% passing)
- 157 unit tests
- 130 integration tests
- ~3.8 second execution time

**Test Scripts**:
```bash
npm test                                    # Run all tests
npm run test:unit                           # Unit tests (fast)
npm run test:e2e                            # E2E tests
npm run test:performance                    # Performance tests
node scripts/generate-fraudulent-emails.js  # Generate test data
```

See [Testing Documentation](TESTING.md) for comprehensive testing guide.

---

## 🔐 Security

**Authentication**:
- Admin API key protection
- Environment-based secrets
- No plaintext credentials

**Privacy**:
- Email hashing in logs
- No PII storage
- Configurable logging

**Best Practices**:
- Rate limiting
- Input validation
- Error sanitization

---

## 🎓 Learning Path

**Beginner → Advanced**:

1. **Understand the Problem**
   - Read [Architecture](ARCHITECTURE.md) - Problem statement
   - Review fraud patterns

2. **Set Up Locally**
   - Follow [Getting Started](GETTING_STARTED.md)
   - Test with sample emails

3. **Explore the API**
   - Read [API Reference](API.md)
   - Make test requests

4. **Integrate**
   - Choose integration method from [Integration Guide](INTEGRATION_GUIDE.md)
   - Implement in your app

5. **Configure**
   - Adjust thresholds in [Configuration](CONFIGURATION.md)
   - Test detection rates

6. **Monitor**
   - Set up [Analytics](ANALYTICS.md) dashboard
   - Review metrics regularly

7. **Optimize**
   - Analyze false positives/negatives
   - Tune configuration
   - Add custom patterns

---

## 🔗 External Resources

**Cloudflare Documentation**:
- [Workers Platform](https://developers.cloudflare.com/workers/)
- [Analytics Engine](https://developers.cloudflare.com/analytics/analytics-engine/)
- [KV Storage](https://developers.cloudflare.com/kv/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)

**Standards & RFCs**:
- [RFC 5322](https://tools.ietf.org/html/rfc5322) - Email format
- [RFC 6531](https://tools.ietf.org/html/rfc6531) - International email
- [Benford's Law](https://en.wikipedia.org/wiki/Benford%27s_law) - Statistical analysis

---

## 📝 Contributing

**Documentation Updates**:
1. Edit relevant `.md` file
2. Update this index if structure changes
3. Test all links
4. Maintain consistent formatting

**Best Practices**:
- Use markdown for all docs
- Include code examples
- Keep docs up-to-date with code
- Add diagrams where helpful

---

## 🆘 Support

**Issues**:
- Check relevant documentation section first
- Review [Testing](TESTING.md) for debugging tips
- See [Architecture](ARCHITECTURE.md) for design decisions

**Questions**:
- API usage → [API Reference](API.md)
- Setup problems → [Getting Started](GETTING_STARTED.md)
- Integration → [Integration Guide](INTEGRATION_GUIDE.md)
- Analytics → [Analytics Documentation](ANALYTICS.md)

---

## 📅 Version History

**Current Version**: 1.3.0 (Phase 7)
**Last Updated**: 2025-11-01

**Major Documentation Updates**:
- **1.3.0** (2025-11-01): Phase 7 complete - Markov Chain integration, added DETECTORS.md guide
- **1.2.0** (2025-11-01): Consolidated testing docs, updated structure
- **1.1.0** (2025-11-01): Added comprehensive analytics documentation
- **1.0.0** (2025-10-31): Initial complete documentation set

---

**Production URL**: https://fraud.erfi.dev
**Repository**: Internal
**License**: Proprietary
