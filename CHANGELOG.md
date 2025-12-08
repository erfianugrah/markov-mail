# Changelog

## [Unreleased]

### 2025-12-08 - Fraud Middleware Hardening

**Improvements**:
- **Request Parsing**: Added robust body parsing with content-type branching (JSON/form-data/fallback). Non-email POSTs now pass through to route handlers instead of hard-blocking.
- **Model Degradation Handling**: When ML models fail to load or evaluate, system now applies a warn-floor risk score (max of `warnThreshold + 0.01` or `blockThreshold * 0.8`) instead of silently allowing traffic with 0 risk. Alerts are sent to ops webhook when degradation occurs.
- **Metrics Quality**: Replaced boolean coercion (`0`/`1`) with proper `null` binding for unknown signals (MX, disposable, bot flags), improving data quality for analytics.
- **Performance**: Added shared in-memory caches for config, heuristics, and models with configurable TTLs (60s for config/heuristics, 5min for models). New admin endpoints for cache invalidation: `DELETE /admin/cache/{heuristics|models|all}`.
- **Testing**: Added integration tests for middleware behavior with malformed requests and model outages.
- **Documentation**: Updated CONFIGURATION.md with cache management endpoints and usage examples.

**Benefits**:
- Reduced KV pressure and improved P95 latency through intelligent caching
- Better operational visibility during model outages with explicit degradation alerts
- Improved data quality in analytics D1 tables for future model training
- More resilient to edge cases (malformed bodies, missing models)

**Note**: 79 pre-existing test failures in comprehensive-validation.test.ts remain unresolved (international domains and batch attack tests). These failures existed before this work and are tracked separately.

### 2025-12-01 - Model Tracking Fix

**Issue**: Models were being deployed without proper identification metadata, making it impossible to track which training run generated which model. This caused confusion when multiple training jobs ran in parallel and overwrote each other's outputs.

**Fix**: Modified `cli/commands/model/train_forest.py` to include proper tracking metadata in every trained model:
- Added `--run-id` argument to allow explicit run identification
- Auto-generates runId from timestamp (milliseconds) if not provided
- Includes `runId`, `nTrees`, and `maxDepth` at top level of `meta` object
- Includes `no_split` flag in `config` section to track training mode
- Auto-creates parent directories when saving models to prevent FileNotFoundError

**Metadata Structure**:
```json
{
  "meta": {
    "version": "3.0.0-forest",
    "runId": "1764589407976",
    "nTrees": 100,
    "maxDepth": 6,
    "config": {
      "no_split": true
    },
    "calibration": {
      "samples": 1172844
    }
  }
}
```

**Benefits**:
- Every model can now be uniquely identified and tracked
- Production debugging becomes possible by matching deployed model to training run
- Race conditions between parallel training jobs become visible
- Model performance can be correlated with specific training parameters

**Deployment**:
- Trained 50-tree Random Forest (max_depth=10) on data/main-final.csv
- Model runId: `1764590953619`
- Successfully deployed to production KV as `random_forest.json`
- Model size: 966KB (within KV 25MB limit)

### 2025-12-01 - CRITICAL: Data Leakage & Sampling Bias Discovered

**Two Training Pitfalls Identified and Resolved**

This entry documents two subtle but critical training issues that caused 5x worse production performance than expected. The lessons learned are now documented in [TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md#case-study-data-leakage--sampling-bias-2025-12-01).

#### Problem #1: Data Leakage (09:30-10:50)

**Issue Discovered:**
- Training used `noSplit=true` creating data leakage
- Model was calibrated on the same 100% data it was trained on
- Resulted in artificially low metrics (6.98% FPR) that didn't reflect real-world performance (42% FPR)

**Root Cause:**
- Threshold optimization on training data creates circular reasoning
- Model memorizes specific emails rather than learning general patterns
- Thresholds perfect for training data fail catastrophically on new data

**Initial Solution:**
- Retrained with `noSplit=false` using proper 80/20 train/test split
- Training: 938,276 samples (80%)
- Test (held-out): 234,569 samples (20%)
- Model never sees test data during training

**Results:** 7.69% FPR on held-out test set ✓ (seemed perfect!)

#### Problem #2: Sampling Bias (10:55-11:06) - THE HIDDEN ISSUE

**The Irony**: Fixing data leakage introduced a WORSE problem.

**Issue Discovered:**
- Production validation STILL showed 38.89% FPR (5x worse than test set!)
- Hypothesis test: Model flagged **39.6% of its own training data** as fraud!

**Root Cause - Test Set Not Representative:**
```
Random 80/20 split (not stratified):
├── Test set: By chance got "easier" legitimate emails (mean raw score 0.22)
├── Training set: Got "harder" legitimate emails (raw scores ~0.40)
└── Thresholds optimized for test set fail on full population

Score distribution mismatch:
├── Test set: Only 7.81% of legit emails in high-risk range → 7.69% FPR
├── Full population: ~40% of legit emails in high-risk range → 39.6% FPR
└── Threshold 0.35 perfect for test, catastrophic for production
```

**Evidence:**

| Dataset | FPR at threshold 0.35 | Representative? |
|---------|----------------------|-----------------|
| Held-out test set (20%) | 7.69% ✓ | ❌ Biased sample |
| Real Enron training data | 39.6% ✗ | ✓ Representative |
| Synthetic validation | 38.9% ✗ | ✓ Representative |

#### Final Solution: Hybrid Approach

**Correct Strategy:**
- Use `noSplit=false` for model validation (ensures generalization)
- Use `noSplit=true` for threshold calibration (ensures representative distribution)
- Accept mild threshold overfitting for accurate production performance

**Key Insight**: Training data leakage acceptable for threshold calibration, not for model training.

**Deployment:**
- Model: Trained with proper 80/20 split for validation
- Thresholds: Calibrated on full 1.17M dataset (representative!)
- Run ID: TBD (2025-12-01-11-06)
- Expected production FPR: ~10% (representative, not biased)

#### Lessons Learned

1. **Random splitting ≠ Representative splitting**
   - Use stratified splits or full training set for threshold calibration
   - Always verify test set score distribution matches production

2. **Multiple validation datasets required**:
   - Held-out test → Model generalization metrics
   - Full training set → Threshold calibration
   - Training sample → Sanity check (model should recognize own training data!)

3. **Test on training data**:
   - If model fails on own training data, fundamental problem exists
   - Our "properly validated" model had 39.6% FPR on training data
   - This immediately revealed the sampling bias

4. **Beware correlated fixes**:
   - Fixing data leakage introduced sampling bias
   - Second problem harder to detect because first fix looked successful
   - Always validate against multiple independent datasets

#### Documentation Updates

- **TROUBLESHOOTING.md**: Added comprehensive case study with prevention checklist
- **CHANGELOG.md**: This entry documenting both issues and solutions
- Created `/tmp/root_cause_analysis.md` with detailed technical analysis

#### Prevention Checklist (for future training)

Before deploying:
- [ ] Train with proper train/test split for model validation
- [ ] Verify test set score distribution matches full population
- [ ] Calibrate thresholds on representative sample (full training set OK)
- [ ] Test model on its own training data (should recognize it!)
- [ ] Test on multiple independent validation sets
- [ ] Compare production score distribution with calibration distribution
- [ ] Document sampling assumptions in manifest.json

### 2025-12-01 - CRITICAL BUG FIX: Calibration Subsetting Issue

**ROOT CAUSE IDENTIFIED:**
- Pipeline trained with `noSplit=false`, using 80/20 train/test split
- Calibration performed on only **234,569 samples (20% test set)** instead of full 1.17M dataset
- Platt scaling coefficients badly tuned due to insufficient calibration data
- This caused catastrophic 38.92% false positive rate in production

**Technical Details:**
- Training dataset: 1,172,845 rows
- Actual calibration samples: 234,569 (20% of data)
- Expected calibration samples: 1,172,845 (100% of data)
- Bug location: `cli/commands/model/train_forest.py` lines 165-213
- Calibration code was inside `if not args.no_split:` block, only running in dev mode

**Fix Applied:**
- Modified `train_forest.py` to ALWAYS generate calibration data
- Production mode (`--no-split=true`): Uses full training set (1.17M samples) for calibration
- Development mode (`--no-split=false`): Uses test set (20%) for calibration (unchanged)
- Calibration now clearly reports which dataset was used and sample count

**Testing Results Before Fix:**
- Training sample test: 72.69% accuracy, 63.15% precision, 38.23% FPR
- Validation test: 68.83% accuracy, 48.90% precision, 38.92% FPR
- All false positives scored 0.37 (just above block threshold 0.35)

**Next Steps:**
- Retrain model with `--no-split=true` to use full 1.17M dataset for calibration
- Validate on production with properly calibrated model
- Expected outcome: FPR drops from 38% to target <10%

### 2025-12-01 - Training with Enhanced Dataset (DEPRECATED - See Bug Above)

**Dataset Generation:**
- Created balanced 1M synthetic dataset (50/50 legit/fraud split) with enhanced typosquatting patterns
- Merged with 172,844 Enron legitimate emails → 1.17M total training samples (670k legit, 502k fraud)
- Enhanced typosquatting generator with 393 domain variants using homoglyphs and character substitutions

**Model Training (FLAWED - See Fix Above):**
- Trained 100-tree Random Forest with adaptive hyperparameter search
- Model size: 276.57 KB
- Training metrics: 95.6% precision, 83.3% recall (on 80% train split only)
- Optimized thresholds via Platt calibration: warn=0.30, block=0.35 (calibrated on 20% subset)
- Target guardrails: 90% recall, 10% FPR/FNR max (NOT MET due to calibration bug)

**Production Validation Results (EXPLAINED):**
- Tested with 20,000 validation emails (14k legit, 6k fraud) against production endpoint
- **Accuracy: 68.83%** (caused by bad calibration)
- **Precision: 48.90%** (caused by bad calibration)
- **Recall: 86.92%** (model recall is OK, precision is broken)
- **False Positive Rate: 38.92%** (caused by calibration on only 234k samples instead of 1.17M)

**Status:** Bug fixed in code, retraining required with corrected calibration.

## [Unreleased - Previous]

### Detectors & Features
- Implemented the multilingual n-gram detector end-to-end: feature export, runtime middleware, and model inputs now emit `ngram_*` scores and risk signals to capture gibberish local parts.
- Added six new n-gram features to the normalized vector (bigram/trigram/overall scores, confidence, risk, naturalness flag) plus documentation/test coverage so training sets remain consistent.
- Built a reproducible 1M-row canonical dataset (`data/main.csv`) by cleaning the Enron corpus, generating 327,194 synthetic legit emails, and 500,000 synthetic fraud samples (exactly 50/50); documented the pipeline and shipped `data:enron:clean` for repeatable preprocessing.

### Model Pipeline
- Updated risk thresholds to warn=0.25, block=0.3 on 2025-12-01 via config:update-thresholds.
- Updated risk thresholds to warn=0.25, block=0.3 on 2025-12-01 via config:update-thresholds.
- Updated risk thresholds to warn=0.3, block=0.35 on 2025-12-01 via config:update-thresholds.
- Updated risk thresholds to warn=0.25, block=0.3 on 2025-12-01 via config:update-thresholds.
- Updated risk thresholds to warn=0.3, block=0.35 on 2025-12-01 via config:update-thresholds.
- Updated risk thresholds to warn=0.3, block=0.35 on 2025-12-01 via config:update-thresholds.
- Updated risk thresholds to warn=0.3, block=0.35 on 2025-12-01 via config:update-thresholds.
- Updated risk thresholds to warn=0.45, block=0.5 on 2025-12-01 via config:update-thresholds.
- Added Bun CLI wrappers for feature importance introspection (`model:analyze`) and RandomizedSearchCV-driven hyperparameter tuning (`model:tune`) along with the underlying Python helpers.
- Extended `model:train` to export per-feature importance maps, emit calibration datasets, and embed Platt-scaling coefficients directly into the Random Forest metadata.
- New `model:calibrate` command (wrapping `scripts/calibrate_scores.py`) produces calibrated probability columns plus logistic coefficients for auditing/plotting.

### Runtime Scoring
- Worker now reads `meta.calibration` and applies Platt scaling before comparing scores with the warn/block thresholds; Random Forest metadata schema updated accordingly.
- Introduced heuristic risk bumps (high-risk TLDs/domains, sequential/digit-heavy locals, plus-tag abuse, high Cloudflare bot scores) to shrink false negatives without increasing false positives.
- Raised production/default thresholds to `warn=0.60`, `block=0.85` (post-calibration) and log every heuristic adjustment for observability.

### Documentation & Ops
- Updated `docs/MODEL_TRAINING`, `docs/CALIBRATION`, `docs/SCORING`, and `config/production/README` with the new calibration, tuning, and deployment workflow.
- Trimmed legacy model files and documented the exact KV push commands for `random_forest.json`.

## 2025-11-30

### Model Training
- Added identity, geo-consistency, and MX telemetry end-to-end (middleware, feature vector, analytics, and webhook alerts)
- Introduced MX-enabled feature export + `npm run cli tree:train` helper for automated dataset generation, training, and KV uploads
- Fixed MX feature availability by awaiting the first lookup (with a short timeout) so training/runtime both see the real provider on cache misses
- Training MX-enhanced model with 144k rows, max_depth=8, min_samples_leaf=30

### Dashboard Rebuild
- Rebuilt analytics dashboard with Astro 5.16.3 + React 19.2.0 (replaces frozen analytics.html)
- Added 10 production-ready components: MetricsGrid, BlockReasonsChart, TimeSeriesChart, QueryBuilder, ModelMetrics, ModelComparison, ExportButton, ApiKeyInput, Dashboard wrapper
- Connected all components to real API endpoints with proper error handling
- Implemented UX improvements: Enter key support, auto-refresh persistence, HTTP status code error messages, mobile responsiveness
- Dashboard builds to `public/dashboard/` and served via Wrangler static assets
- Bundle size: 607 KB raw, 184 KB gzipped

### Documentation
- Updated all docs to reflect dashboard rebuild and remove deprecated `ml/` Python workflow
- Training now fully integrated into CLI via `npm run cli tree:train`
- Updated README, docs/README, docs/DECISION_TREE, docs/TRAINING, docs/CONFIGURATION
- Migration: Run `wrangler d1 migrations apply markov-mail` to pick up `0002_add_identity_geo_mx_columns.sql` before deploying








