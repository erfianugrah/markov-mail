# Project Structure

**Last Updated**: 2025-01-07

## Directory Layout

```
markov-mail/
├── src/                      # Source code
│   ├── detectors/           # Pattern detection modules
│   │   ├── _deprecated/     # Archived/deprecated detectors
│   │   ├── keyboard-mashing.ts # NEW: Region clustering detection
│   │   ├── ngram-markov.ts  # PRIMARY: N-gram Markov chain (91K trained)
│   │   ├── pattern-family.ts # Pattern classification
│   │   ├── ngram-analysis.ts # Gibberish detection
│   │   ├── plus-addressing.ts # Email normalization
│   │   ├── tld-risk.ts      # TLD reputation
│   │   ├── benfords-law.ts  # Batch fraud analysis
│   │   ├── ngram-multilang.ts # Multi-language support (internal)
│   │   ├── sequential.ts    # Sequential patterns (internal)
│   │   ├── dated.ts         # Dated patterns (internal)
│   │   └── index.ts         # Public API exports
│   ├── middleware/          # Request middleware
│   │   └── fraud-detection.ts # Main fraud detection logic
│   ├── validators/          # Input validation
│   ├── services/            # External services (updaters)
│   ├── database/            # D1 database queries
│   ├── training/            # Model training scripts
│   ├── utils/               # Utilities
│   └── index.ts             # Worker entrypoint
├── docs/                    # Documentation
│   ├── API.md              # API endpoints
│   ├── ARCHITECTURE.md     # System architecture
│   ├── PROJECT_STRUCTURE.md # Project directory layout
│   ├── DETECTORS.md        # Detector documentation
│   ├── TESTING.md          # Testing guide
│   └── ...                 # 18 total docs
├── tests/                  # Test suites
│   ├── unit/              # Unit tests
│   ├── integration/       # Integration tests
│   └── e2e/               # End-to-end tests
├── cli/                   # CLI tools
├── dashboard/             # React dashboard (built to public/)
├── dataset/               # Training datasets
├── analysis-archive/      # Temporary analysis files (gitignored)
├── public/                # Static assets
├── wrangler.jsonc         # Cloudflare Workers config
├── package.json           # Dependencies
├── tsconfig.json          # TypeScript config
├── README.md              # Main documentation
└── CHANGELOG.md           # Version history
```

## Active Detectors (7)

### Exported (Public API)
1. **ngram-markov.ts** - Primary Markov chain (N-gram based, 91K trained)
2. **keyboard-mashing.ts** - Region clustering detection
3. **pattern-family.ts** - Pattern classification (sequential, dated, keyboard, etc.)
4. **ngram-analysis.ts** - Gibberish detection (multi-language)
5. **tld-risk.ts** - TLD reputation scoring
6. **plus-addressing.ts** - Email normalization
7. **benfords-law.ts** - Batch fraud analysis

### Internal-Only (Not Exported)
- **ngram-multilang.ts** - Used by ngram-analysis.ts
- **sequential.ts** - Used by pattern-family.ts
- **dated.ts** - Used by pattern-family.ts

### Deprecated (_deprecated/)
- **markov-chain.ts** - Replaced by ngram-markov.ts
- **markov-ensemble.ts** - Never implemented
- **signal-aggregator.ts** - Replaced with Markov-first approach

## Documentation Organization

All documentation is in `docs/` folder (27 markdown files):

### Getting Started
- **QUICK_START.md** - 5-minute setup guide
- **GETTING_STARTED.md** - Detailed setup
- **FIRST_DEPLOY.md** - Initial deployment guide

### API & Integration
- **API.md** - API endpoints and usage
- **INTEGRATION_GUIDE.md** - Integration examples
- **../cli/README.md** - CLI tools (43 commands)

### Architecture & Design
- **ARCHITECTURE.md** - System architecture
- **SCORING.md** - Risk scoring strategy
- **DETECTORS.md** - Detector documentation
- **DETECTOR_AUDIT.md** - Cleanup audit
- **KEYBOARD_DETECTION_SUMMARY.md** - Keyboard improvements

### Configuration
- **CONFIGURATION.md** - Config options
- **DATASETS.md** - Training datasets
- **TRAINING.md** - Model training

### Operations
- **TESTING.md** - Testing guide
- **ANALYTICS.md** - Metrics and analytics
- **LOGGING_STANDARDS.md** - Logging conventions
- **SYSTEM_STATUS.md** - System status

### Research & Analysis
- **HARDCODED_DATA_AUDIT.md** - Data audit
- **BIRTH_YEAR_VS_FRAUD_TIMESTAMP_RESEARCH.md** - Research findings
- **LIVE_TEST_RESULTS_2025-01-04.md** - Test results
- **RETRAINING_SUMMARY.md** - Model retraining
- **TUNING_RECOMMENDATIONS.md** - Threshold tuning

### Version History
- **CHANGELOG_V2.1.md** - V2.1 changes
- **MIGRATION_PATTERN_TYPE_FIX.md** - Migration guide

## Key Files

### Configuration
- **wrangler.jsonc** - Cloudflare Workers configuration
  - KV namespaces: CONFIG, MARKOV_MODEL, DISPOSABLE_DOMAINS_LIST, TLD_LIST
  - D1 database: ANALYTICS
  - Cron trigger: Every 6 hours (disposable domain updates)

### TypeScript
- **tsconfig.json** - TypeScript compiler options
- **src/index.ts** - Worker entrypoint
- **src/middleware/fraud-detection.ts** - Main fraud detection logic (300+ lines)

### Package Management
- **package.json** - Dependencies and scripts
  - Main: Hono (web framework), Cloudflare Workers SDK
  - Detectors: N-gram libraries, entropy calculators
  - Testing: Vitest, testing utilities
  - Dashboard: React, Recharts, shadcn/ui

### Training Data
- **dataset/training_compiled/training_compiled.csv** - Canonical combined dataset (89,352 rows)
  - 48,151 legit (53.9%)
  - 41,201 fraud (46.1%)
  - Already deduplicated, re-labeled, and purged of legacy corpora (e.g., Enron)

## Analysis Archive

**Location**: `analysis-archive/` (gitignored, 65MB total)

Contains temporary files from detector tuning sessions:
- d1-validations.json (47MB) - Full D1 database dump
- false-positives.json (1.9MB) - 5,508 false positives
- false-negatives.json (5.1MB) - 14,833 mislabeled samples
- label-corrections.json (3.3MB) - 11,112 corrections
- markov_*gram.json (8.7MB) - Training artifacts

**Note**: These are temporary analysis files, not required for production. The trained models are in KV namespace `MARKOV_MODEL`.

## Build Output

- **public/dashboard/** - Built React dashboard (gitignored)
- **.wrangler/** - Wrangler cache (gitignored)
- **dist/** - Compiled output (gitignored)

## Git Workflow

**Branch**: feature/migrate-to-d1
**Main Branch**: (not specified in git status)

## Deployment

**URL**: https://your-worker.workers.dev
**Platform**: Cloudflare Workers
**Latest Version**: 3c6fd44e-0731-4dd5-a67d-94f7cae1b70f

---

**For detailed documentation, see**: `docs/README.md`
