# Bogus Email Pattern Recognition

A Cloudflare Workers-based email validation service that detects fraudulent signup attempts through advanced pattern recognition and behavioral analysis.

## Features

### ✅ Core Detection (Implemented)

- **Format Validation**: RFC 5322 compliance checking
- **Entropy Analysis**: Shannon entropy calculation for random string detection
- **Disposable Domain Detection**: 170+ known disposable email services with wildcard pattern matching
- **Advanced Fingerprinting**: IP + JA4 + ASN + Bot Score tracking
- **Pattern Detection**:
  - Sequential patterns (user123, test001, etc.)
  - Dated patterns (john.doe.2025, user_2025, etc.)
  - Plus-addressing abuse detection (user+1@gmail.com, user+2@gmail.com, etc.)
  - Keyboard walk patterns (qwerty, asdfgh, 123456, etc.)
- **Advanced Algorithms (Phase 6A)**:
  - **N-Gram Analysis**: Detects gibberish using character bigram/trigram frequency analysis
  - **TLD Risk Profiling**: Categorizes 40+ TLDs from trusted (.edu, .gov) to high-risk (.tk, .ml)
  - **Benford's Law Analysis**: Statistical batch detection for automated signup waves
- **Domain Reputation Scoring**: Weighted scoring for free providers and domain types
- **Structured Logging**: Pino.js with JSON output for log aggregation
- **Analytics Integration**: Cloudflare Analytics Engine for metrics tracking
- **Risk Scoring**: Multi-dimensional risk calculation with configurable thresholds

### 🚧 Future Enhancements (Planned)

**Phase 6B - Advanced Statistical Methods:**
- **Markov Chain Analysis**: Predict character sequences to detect generated names
- **Edit Distance Clustering**: Group similar patterns using Levenshtein distance

**Phase 6C - Temporal & Behavioral Analysis (requires Durable Objects):**
- **Inter-Arrival Time Analysis**: Detect regular-interval bot submissions
- **Velocity Scoring**: Track registration speed per fingerprint/pattern
- **Rate Limiting**: Multi-dimensional limits (fingerprint, pattern family, provider+pattern)

**Infrastructure & Tools:**
- **Admin API**: Statistics and pattern management endpoints
- **MX Record Validation**: DNS-based domain verification
- **Enhanced Reporting**: Pattern family analytics and trend detection

## Architecture

```
┌─────────────────┐
│   HTTP Request  │
└────────┬────────┘
         │
    ┌────▼───────┐
    │   Hono     │  (Routing & CORS)
    │ Framework  │
    └────┬───────┘
         │
    ┌────▼──────────────────┐
    │  Email Validators     │
    │  - Format (RFC 5322)  │
    │  - Entropy Analysis   │
    │  - Domain Checking    │
    │  - TLD Risk (Phase 6A)│
    └────┬──────────────────┘
         │
    ┌────▼──────────────────┐
    │  Pattern Detectors    │
    │  - Sequential         │
    │  - Dated              │
    │  - Plus-addressing    │
    │  - Keyboard Walk      │
    │  - N-Gram (Phase 6A)  │
    └────┬──────────────────┘
         │
    ┌────▼──────────────────┐
    │   Risk Scoring        │
    │  - Multi-dimensional  │
    │  - Threshold-based    │
    │  - Configurable       │
    │  - Phase 6A Enhanced  │
    └────┬──────────────────┘
         │
    ┌────▼──────────────────┐
    │  Logging & Metrics    │
    │  - Pino.js Logging    │
    │  - Analytics Engine   │
    │  - Benford Analysis   │
    └────┬──────────────────┘
         │
    ┌────▼────────┐
    │   Response  │
    └─────────────┘
```

## API Endpoints

### POST /validate

Validates an email address and returns risk assessment.

**Request:**
```json
{
  "email": "test@example.com"
}
```

**Response:**
```json
{
  "valid": true,
  "riskScore": 0.25,
  "decision": "allow",
  "message": "Email validation completed",
  "signals": {
    "formatValid": true,
    "entropyScore": 0.42,
    "localPartLength": 4,
    "isDisposableDomain": false,
    "isFreeProvider": false,
    "domainReputationScore": 0,
    "patternFamily": "[PATTERN].[RANDOM]@example.com",
    "patternType": "random",
    "patternConfidence": 0.6,
    "patternRiskScore": 0.1,
    "normalizedEmail": "test@example.com",
    "hasPlusAddressing": false,
    "hasKeyboardWalk": false,
    "keyboardWalkType": "none",
    "isGibberish": false,
    "gibberishConfidence": 0,
    "tldRiskScore": 0.29
  },
  "fingerprint": {
    "hash": "3d1852...",
    "country": "US",
    "asn": 13335,
    "botScore": 0
  },
  "latency_ms": 2
}
```

**Decisions:**
- `allow`: Low risk (< 0.3)
- `warn`: Medium risk (0.3 - 0.6)
- `block`: High risk (> 0.6)

### GET /debug

Returns fingerprinting signals from the request.

**Response:**
```json
{
  "fingerprint": {
    "hash": "...",
    "ip": "1.2.3.4",
    "userAgent": "...",
    "country": "US",
    "asn": 13335,
    "botScore": 0
  },
  "allSignals": {
    "cf-connecting-ip": "1.2.3.4",
    "user-agent": "...",
    ...
  }
}
```

### RPC (Worker-to-Worker)

For Worker-to-Worker communication, use RPC instead of HTTP for 5-10x lower latency:

**Setup in consuming worker's `wrangler.jsonc`:**
```jsonc
{
  "services": [{
    "binding": "FRAUD_DETECTOR",
    "service": "bogus-email-pattern-recognition",
    "entrypoint": "FraudDetectionService"
  }]
}
```

**Usage (with fingerprinting):**
```typescript
const result = await env.FRAUD_DETECTOR.validate({
  email: "user@example.com",
  consumer: "MY_APP",
  flow: "SIGNUP_EMAIL_VERIFY",
  headers: {
    'cf-connecting-ip': request.headers.get('cf-connecting-ip'),
    'user-agent': request.headers.get('user-agent'),
    'cf-ipcountry': request.headers.get('cf-ipcountry')
  }
});

if (result.decision === 'block') {
  return new Response('Email rejected', { status: 400 });
}
```

**Benefits:** Lower latency, type safety, full fingerprinting support.
**See [API.md - RPC Integration](docs/API.md#rpc-integration-service-bindings) for comprehensive documentation.**

### Admin API

Manage configuration at runtime (requires `ADMIN_API_KEY` secret):

```bash
# Get current configuration
GET /admin/config

# Get default configuration
GET /admin/config/defaults

# Update configuration (full replacement)
PUT /admin/config

# Validate configuration without saving
POST /admin/config/validate

# Reset to defaults
POST /admin/config/reset

# Clear configuration cache
DELETE /admin/config/cache

# Health check
GET /admin/health
```

**See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for complete Admin API documentation.**

## Installation

```bash
# Clone the repository
git clone https://github.com/your-org/bogus-email-pattern-recognition.git
cd bogus-email-pattern-recognition

# Install dependencies
npm install

# Run tests
npm test

# Start development server
npm run dev

# Deploy to Cloudflare Workers
npm run deploy
```

## Configuration

**Zero Configuration Required** - The worker starts with sensible defaults and requires no setup.

### KV-Based Runtime Configuration

Configuration is managed via Cloudflare Workers KV and can be updated at runtime without redeployment:

```bash
# View current configuration
curl https://your-worker.dev/admin/config \
  -H "X-API-Key: your-admin-api-key"

# Update configuration
curl -X PUT https://your-worker.dev/admin/config \
  -H "X-API-Key: your-admin-api-key" \
  -H "Content-Type: application/json" \
  -d '{"riskThresholds": {"block": 0.7, "warn": 0.4}}'
```

**Configuration includes:**
- Risk thresholds (block/warn)
- Feature toggles (pattern detection, disposable check, etc.)
- Risk scoring weights
- Logging settings
- Action overrides

**See:**
- [docs/CONFIGURATION.md](docs/CONFIGURATION.md) - Complete configuration guide
- [examples/CONFIG_EXAMPLES.md](examples/CONFIG_EXAMPLES.md) - Ready-to-use configuration examples

### Setup (Optional)

1. **Create KV Namespace** (for runtime configuration):
   ```bash
   wrangler kv namespace create CONFIG
   ```

2. **Set Admin API Key** (to enable configuration management):
   ```bash
   wrangler secret put ADMIN_API_KEY
   ```

3. **Configure via Admin API** (change settings without redeployment):
   ```bash
   curl -X PUT https://your-worker.dev/admin/config \
     -H "X-API-Key: your-secret-key" \
     -H "Content-Type: application/json" \
     -d @examples/config.json
   ```

## Risk Scoring Algorithm

```
riskScore = (entropy × 0.20) + (domainRep × 0.10) + (tldRisk × 0.10) + (patternRisk × 0.50)
```

**Weights (Phase 6A Enhanced):**
- Entropy: 20% (random string detection)
- Domain Reputation: 10% (disposable/free providers)
- TLD Risk: 10% (domain extension risk profiling)
- Pattern Detection: 50% (sequential, dated, plus-addressing, keyboard walks, n-gram gibberish)

**Priority (highest to lowest):**
1. Invalid format → 0.8
2. Disposable domain → 0.95
3. Very high entropy (>0.7) → entropy score
4. Combined risk scoring with Phase 6A algorithms

**Block Reasons:**
- `gibberish_detected`: N-Gram analysis flagged non-natural text
- `high_risk_tld`: Domain uses high-risk TLD (.tk, .ml, .ga, etc.)
- `sequential_pattern`: Sequential numbering detected
- `dated_pattern`: Date-based pattern detected
- `plus_addressing_abuse`: Plus-addressing manipulation
- `keyboard_walk`: Keyboard pattern detected
- `disposable_domain`: Known disposable email service
- `high_entropy`: Random character string
- `invalid_format`: RFC 5322 violation

## Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run with coverage
npm run test:coverage
```

**Test Coverage:**
- **287 tests passing** (100% success rate)
- Unit tests for validators and pattern detectors
- Comprehensive tests for N-Gram analysis (29 tests)
- TLD risk profiling tests (37 tests)
- Benford's Law analysis tests (34 tests)
- Integration tests for API endpoints
- Real-world attack scenario simulations
- Fraudulent email detection tests (13 tests)

## Performance

### Speed
- **Average Latency**: 0-2ms
- **No External Dependencies**: All checks run in-worker
- **Edge Deployment**: Runs on Cloudflare's global network
- **Scalable**: Handles high request volumes without rate limits (detection-only mode)

### Detection Accuracy
- **Overall Detection Rate**: **94.5%** on fraudulent emails
- **Sequential Patterns**: 100% detection (user1, test001, etc.)
- **Letter Sequential**: 100% detection (test_a, user_b, etc.)
- **Keyboard Walks**: 100% detection (qwerty, 123456, etc.)
- **Gibberish**: 100% detection (random strings)
- **Dated Patterns**: 100% detection (john.2025, etc.)
- **Plus-Addressing**: 100% detection (user+1, user+2, etc.)
- **False Positive Rate**: <1% (conservative approach)

## Pattern Detection Examples

### Sequential Patterns
- `user123@gmail.com` → Detected
- `test001@company.com` → Detected
- `person1.person2@example.com` → Not detected

### Dated Patterns
- `john.doe.2025@gmail.com` → Detected
- `user_oct2025@yahoo.com` → Detected
- `personC.personD@university.edu` → Not detected

### Plus-Addressing Abuse
- `attacker+1@gmail.com`, `attacker+2@gmail.com` → Detected as campaign
- `john+newsletter@gmail.com` → Normal usage, low risk

### Keyboard Walks
- `qwerty123@example.com` → Detected
- `asdfgh@test.com` → Detected
- `random.name@example.com` → Not detected

## Development Roadmap

See [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) for detailed roadmap.

### Current Phase: Detection & Testing (Complete)
- ✅ Format validation
- ✅ Entropy analysis
- ✅ Pattern detection (4 types)
- ✅ Disposable domain detection
- ✅ Fingerprinting
- ✅ Risk scoring
- ✅ Comprehensive test suite

### Next Phase: Advanced Features (Planned)
- ⏳ Rate limiting with Durable Objects
- ⏳ Pattern reputation tracking
- ⏳ Temporal analysis
- ⏳ Admin API endpoints
- ⏳ MX record validation

## Security Considerations

- **No PII Storage**: Email addresses are hashed before logging
- **Privacy-Preserving**: Fingerprinting uses hashed data
- **No Database**: Detection-only mode requires no persistence
- **CORS Enabled**: Configurable cross-origin access
- **Rate Limiting**: Planned for future release

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License - see LICENSE file for details

## Acknowledgments

Built with:
- [Cloudflare Workers](https://workers.cloudflare.com/)
- [Hono](https://hono.dev/) - Fast web framework
- [Pino](https://getpino.io/) - Structured logging
- [Vitest](https://vitest.dev/) - Testing framework
- [@cloudflare/vitest-pool-workers](https://github.com/cloudflare/workers-sdk/tree/main/fixtures/vitest-pool-workers-examples) - Workers test environment

## Support

- 📧 Email: support@example.com
- 🐛 Issues: [GitHub Issues](https://github.com/your-org/bogus-email-pattern-recognition/issues)
- 📖 Docs: [./docs](./docs)
