# System Inventory - Markov Mail Fraud Detection
**Version**: 3.0.1
**Last Updated**: 2026-02-23
**Status**: Production-Ready

---

## System Overview

| Metric | Value |
|--------|-------|
| **Source Files** | 45 TypeScript (src/) |
| **CLI Files** | 37 TypeScript/Python (cli/) |
| **Test Files** | 23 (tests/) |
| **Source Lines** | ~13,000 (src/) |
| **Dataset** | 1,000,000 labeled emails (data/main.csv) |
| **Feature Count** | 45 features across 10 categories |

---

## Architecture Components

### Core Infrastructure
- **Runtime**: Cloudflare Workers (edge computing)
- **Framework**: Hono (fast web framework)
- **Database**: D1 SQLite (1 consolidated migration)
- **Storage**: 3 KV namespaces (CONFIG, DISPOSABLE_DOMAINS_LIST, TLD_LIST)
- **Language**: TypeScript (strict mode)
- **Testing**: Vitest with Cloudflare Workers pool
- **Deployment**: fraud.erfi.dev (custom domain)
- **Dashboard**: Astro + React (static build in public/dashboard/)

### Source Structure (`src/`)

#### Detectors (11 files)
- `benfords-law.ts` - Statistical digit distribution analysis
- `dated.ts` - Timestamp and date pattern detection
- `forest-engine.ts` - Random Forest ensemble evaluator with feature alignment
- `linguistic-features.ts` - Phonetic and character analysis
- `ngram-analysis.ts` - Markov chain n-gram scoring
- `ngram-multilang.ts` - Multi-language bigram/trigram support
- `pattern-family.ts` - Sequential, formatted, template patterns
- `plus-addressing.ts` - Email alias detection
- `sequential.ts` - Character sequence analysis
- `tld-risk.ts` - TLD risk profiling
- `index.ts` - Detector registry and exports

#### Models (2 files)
- `decision-tree.ts` - KV-backed JSON tree evaluator with depth-limited traversal
- (forest engine lives in detectors/ for historical reasons)

#### Services (5 files)
- `alerting.ts` - Alert notification service
- `mx-resolver.ts` - DNS MX record resolution
- Plus additional utility services

#### Utils (5 files)
- `feature-vector.ts` - 45-feature extraction pipeline with input sanitization
- `geo-signals.ts` - Geographic signal extraction from request.cf
- `identity-signals.ts` - User identity pattern analysis
- `known-mx-providers.ts` - MX provider classification
- `disposable-domains.ts` - Disposable domain lookup

#### Middleware (2 files)
- `fraud-detection.ts` - Main pipeline (feature extraction + RF/DT evaluation)
- `auth.ts` - Timing-safe API key authentication

#### Routes (1 file)
- `admin.ts` - Admin API endpoints with SQL validation

#### Entry Point
- `index.ts` - Worker entry, CORS, routing, debug endpoint

---

## Machine Learning Pipeline

### Feature Engineering

**Feature Count**: 45 features across 10 categories

1. **Sequential/Pattern** (2 features)
   - `sequential_confidence`, `plus_risk`

2. **Basic** (3 features)
   - `local_length`, `digit_ratio`, `entropy_score`

3. **Identity** (3 features)
   - `name_similarity_score`, `name_token_overlap`, `name_in_email`

4. **Geo** (3 features)
   - `geo_language_mismatch`, `geo_timezone_mismatch`, `geo_anomaly_score`

5. **MX** (10 features)
   - `mx_has_records`, `mx_record_count`
   - One-hot: `mx_provider_google`, `mx_provider_microsoft`, `mx_provider_icloud`, `mx_provider_yahoo`, `mx_provider_zoho`, `mx_provider_proton`, `mx_provider_self_hosted`, `mx_provider_other`

6. **Domain** (3 features)
   - `provider_is_free`, `provider_is_disposable`, `tld_risk_score`, `domain_reputation_score`

7. **Linguistic** (6 features)
   - `pronounceability`, `vowel_ratio`, `max_consonant_cluster`, `repeated_char_ratio`, `syllable_estimate`, `impossible_cluster_count`

8. **Structural** (4 features)
   - `has_word_boundaries`, `segment_count`, `avg_segment_length`, `segments_without_vowels_ratio`

9. **Statistical** (4 features)
   - `unique_char_ratio`, `vowel_gap_ratio`, `max_digit_run`, `bigram_entropy`

10. **N-gram** (6 features)
    - `ngram_bigram_score`, `ngram_trigram_score`, `ngram_overall_score`, `ngram_confidence`, `ngram_risk_score`, `ngram_is_natural`

### Models
- **Primary**: Random Forest (`random_forest.json` in KV as `random_forest.json`)
- **Fallback**: Decision Tree (`decision_tree.json` in KV)
- **Hot-reload**: 60s cache TTL, version tracking via metadata
- **Training**: Python/scikit-learn via `npm run cli -- model:train` or `npm run pipeline`
- **Calibration**: OOB-based Platt scaling when `--no-split`, held-out test set otherwise
- **Feature alignment**: `checkFeatureAlignment()` validates model↔runtime feature consistency on first evaluation

### Model Files
- `config/production/random-forest.json` - Production RF model (committed)
- `config/production/random-forest.auto.json` - Auto-generated RF model (gitignored)
- `config/production/config.json` - Production runtime config (thresholds, weights)

---

## Data Layer

### KV Namespaces (3 bindings)
1. **CONFIG**
   - `config.json` - Runtime configuration
   - `decision_tree.json` - Active decision tree model
   - `random_forest.json` - Active random forest model
   - Hot-swappable without redeployment

2. **DISPOSABLE_DOMAINS_LIST**
   - 71,000+ disposable email domains
   - Updated every 6 hours via cron

3. **TLD_LIST**
   - TLD risk profiles
   - Manual updates via CLI

### D1 Database
Single consolidated migration: `0001_create_initial_schema.sql`

Tables:
- `validations` - Email validation results and telemetry
- `training_metrics` - Model training pipeline events
- `ab_test_metrics` - A/B experiment tracking
- `admin_metrics` - Administrative action logs

---

## Deployment

### Production Environment
- **URL**: https://fraud.erfi.dev
- **Worker Name**: markov-mail
- **Observability**: Enabled

### Cron Jobs
- **Schedule**: `0 */6 * * *` (every 6 hours)
- **Tasks**: Disposable domain list refresh

### Thresholds (defaults)
- **Block**: >= 0.65
- **Warn**: >= 0.35
- Production overrides in `config/production/config.json`

---

## Documentation

### Docs Directory (14 files)
- `README.md` - Documentation index
- `ARCHITECTURE.md` - System architecture and data flow
- `CALIBRATION.md` - Score calibration methodology
- `CONFIGURATION.md` - KV/D1 config management
- `CONTRIBUTING.md` - Contribution guidelines
- `DETECTORS.md` - Feature extraction reference
- `MODEL_TRAINING.md` - Training workflow (RF + DT)
- `OPERATIONS.md` - Operational runbook
- `PIPELINE.md` - ML pipeline documentation
- `PROJECT_STRUCTURE.md` - Codebase layout
- `SCORING.md` - Scoring engine and thresholds
- `SYSTEM_INVENTORY.md` - This file
- `THRESHOLD_ARTIFACTS.md` - Threshold tuning artifacts
- `TROUBLESHOOTING.md` - Debugging guide

---

## Package Scripts

```json
{
  "start": "wrangler dev",
  "dev": "wrangler dev",
  "build": "npm run build:dashboard",
  "build:dashboard": "cd dashboard && npm run build",
  "typecheck": "tsc --noEmit",
  "deploy": "npm run typecheck && npm run build && wrangler deploy",
  "cli": "bun run cli/index.ts",
  "test": "vitest",
  "test:unit": "vitest tests/ --exclude tests/e2e/** --exclude tests/performance/**",
  "test:e2e": "vitest tests/e2e/",
  "test:performance": "vitest tests/performance/"
}
```

---

## Support

- **CLI Help**: `npm run cli -- --help`
- **Repository**: https://github.com/erfianugrah/markov-mail
