# Security & ML Engineering Review — Fix Tracker

**Date:** 2026-03-10
**Branch:** `fix/security-ml-review-fixes`
**Scope:** Full codebase review from security engineer + ML engineer perspective

---

## CRITICAL

### S1. SQL Injection via UNION in Custom Analytics Query
- **File:** `src/routes/admin.ts:79-83`
- **Issue:** The `validateD1Query` blocklist omits `UNION`, `EXCEPT`, and `INTERSECT`. An authenticated admin can read arbitrary D1 tables (e.g., `sqlite_master`) by appending `UNION SELECT ...` to a valid query. The query is executed verbatim via `db.prepare(query).all()` with no parameterized binding.
- **Exploit:** `SELECT * FROM validations UNION SELECT sql,2,3,4,5,... FROM sqlite_master`
- **Fix:** Add `UNION`, `EXCEPT`, `INTERSECT`, `INTO` to the blocklist. Validate that ALL `FROM`/`JOIN` clauses reference allowed tables, not just one.
- **Status:** FIXED

### S2. Rate Limiting Disabled in Production
- **File:** `config/production/config.json:36-40`
- **Issue:** `rateLimiting.enabled: false`. The unauthenticated `/validate` endpoint performs DNS lookups, model inference, and D1 writes per request with no throttling. Enables resource exhaustion, data poisoning, and email enumeration.
- **Fix:** Set `enabled: true`.
- **Status:** FIXED

### M1. Calibration Coefficients Computed But Never Applied at Inference
- **File:** `src/detectors/forest-engine.ts:56-75`
- **Issue:** `predictForestScore` returns the raw tree-vote average. The `meta.calibration` Platt scaling coefficients (intercept, coef) are stored in the model JSON but never applied. The entire calibration pipeline (`calibrate.ts`, `calibrate_scores.py`) has no effect on production decisions.
- **Fix:** Apply sigmoid `1 / (1 + exp(coef * score + intercept))` after computing the raw average, when calibration metadata is present. Clamp sigmoid input to prevent overflow.
- **Status:** FIXED

### M2. Fallback Platt Scaling on In-Sample Predictions
- **File:** `cli/commands/model/train_forest.py`
- **Issue:** When OOB predictions are unavailable, the code falls back to `model.predict_proba(X_train)` for Platt calibration. This produces severely overfit calibration coefficients.
- **Fix:** Remove the fallback. If OOB is unavailable, force a held-out calibration split or abort.
- **Status:** FIXED

### M3. Zero Tests for Forest Inference Correctness
- **File:** `tests/unit/models/` (missing file)
- **Issue:** No tests verify that `predictForestScore` produces correct outputs. A bug in tree traversal would silently corrupt all production predictions with no CI detection.
- **Fix:** Add golden-value tests with fixed model + fixed features = expected score. Add edge case tests for NaN, empty features, single-tree models.
- **Status:** FIXED

---

## HIGH

### S3. Fail-Open Design Exploitable via Crafted Input
- **File:** `src/middleware/fraud-detection.ts:833-853`
- **Issue:** When the middleware errors, it sets `X-Fraud-Score: 0` and `X-Fraud-Decision: warn`, then passes the request through. An attacker who triggers an exception in any detector bypasses fraud detection entirely.
- **Fix:** Wrap individual detector calls in try/catch so a single detector failure does not bring down the entire pipeline. Set a non-zero degraded score (e.g., 0.5) rather than 0.
- **Status:** FIXED

### S4. Unbounded MX Cache Enables Memory Exhaustion
- **File:** `src/services/mx-resolver.ts:46`
- **Issue:** `MX_CACHE` is an unbounded `Map` with no max size. Unique domain requests grow it indefinitely, potentially crashing the Worker isolate.
- **Fix:** Add a max cache size (e.g., 10,000 entries) with LRU eviction.
- **Status:** FIXED

### M4. NaN Propagation Silently Corrupts Predictions
- **File:** `src/detectors/forest-engine.ts:92-95`
- **Issue:** `featureValue <= current.v` is `false` when `featureValue` is `NaN` (IEEE 754). NaN features always take the right branch, systematically biasing predictions.
- **Fix:** Add `Number.isNaN()` guard; treat NaN as missing and use a sentinel strategy (default to left/null branch or skip the tree).
- **Status:** FIXED

### M5. Missing Features Default to 0 — Indistinguishable From Valid Values
- **File:** `src/detectors/forest-engine.ts:92`
- **Issue:** `features[current.f] ?? 0` treats missing features identically to features with legitimate value 0. For features like `sequential_count` or `entropy`, 0 has specific semantic meaning.
- **Fix:** Use `undefined` check and NaN-as-sentinel so missing features take a neutral path (left branch, matching scikit-learn's convention for missing values).
- **Status:** FIXED (combined with M4 NaN guard)

### M6. Feature Alignment Mismatch Logs Warning But Does Not Block
- **File:** `src/detectors/forest-engine.ts:155-172`
- **Issue:** `checkFeatureAlignment` detects model/vector mismatches but only calls `console.warn`. A model retrain that changes features silently produces garbage scores.
- **Fix:** Return a structured result with severity. Throw on critical mismatches (>20% missing features). Callers can decide whether to block or degrade.
- **Status:** FIXED

---

## MEDIUM

### S5. Auth Timing Leak on Key Length
- **File:** `src/middleware/auth.ts:47-49`
- **Issue:** `&&` short-circuits on `byteLength` comparison before `timingSafeEqual`, leaking API key length via timing.
- **Fix:** Hash both keys with SHA-256 (fixed-length output) before comparison.
- **Status:** FIXED

### S6. No Brute-Force Protection on Dashboard Login
- **File:** `src/index.ts:146-182`
- **Issue:** `POST /dashboard/auth` has no rate limiting, lockout, or backoff.
- **Fix:** Add in-memory rate limiter (IP-based, 5 attempts per minute).
- **Status:** FIXED

### S7. Broad Path-Prefix Bypass in Fraud Detection Middleware
- **File:** `src/middleware/fraud-detection.ts:122-131`
- **Issue:** `path.startsWith('/admin')` matches `/admin-anything`. Same for `/assets`.
- **Fix:** Use exact path or `path.startsWith('/admin/')` with trailing slash (plus exact `/admin`).
- **Status:** FIXED

### S8. PII Stored Without Retention Policy
- **File:** `src/middleware/fraud-detection.ts:629-709`
- **Issue:** Email local parts, IPs, geolocation stored in D1 with no automatic retention enforcement.
- **Fix:** Document retention requirements. (Enforcement is operational — add comment noting the gap.)
- **Status:** FIXED (documentation note added)

### M8. Diacritic Stripping Destroys Multilingual N-gram Signals
- **File:** `src/detectors/ngram-analysis.ts`
- **Issue:** `[a-z]`-only regex strips diacritics, crippling detection for French, German, Turkish, etc.
- **Fix:** Normalize with NFD + strip combining marks, then lowercase, preserving base characters.
- **Status:** FIXED

### M9. Chi-Squared P-value Is a 4-Step Function
- **File:** `src/detectors/benfords-law.ts:121-127`
- **Issue:** Returns only 4 discrete values, discarding statistical information.
- **Fix:** Replace with a polynomial approximation of the chi-squared CDF (Wilson-Hilferty or similar).
- **Status:** FIXED

---

## LOW

### S9. API Key Used as HMAC Session Secret
- **File:** `src/index.ts:172`
- **Issue:** `signSession(secret, secret)` — API key is both credential and signing key.
- **Fix:** Derive a separate signing key using HKDF or SHA-256 prefix.
- **Status:** FIXED

### S10. No Schema Validation on TLD Profile PUT Body
- **File:** `src/routes/admin.ts:1049`
- **Issue:** Body parsed as arbitrary JSON with no field validation.
- **Fix:** Add runtime schema validation for required TLD profile fields.
- **Status:** FIXED

### S11. KV Data Cast Without Runtime Validation
- **File:** `src/services/tld-risk-updater.ts:41`
- **Issue:** `as TLDRiskProfile[]` cast with no runtime check.
- **Fix:** Add `Array.isArray` + field type guards.
- **Status:** FIXED

### S12. Single API Key for All Admin — No RBAC
- **File:** `src/middleware/auth.ts`
- **Issue:** No read-only vs. read-write distinction.
- **Fix:** Deferred — noted for future work. Adding RBAC is a larger architectural change.
- **Status:** DEFERRED

### S13. Raw SQL Echoed Back in Analytics Response
- **File:** `src/routes/admin.ts:493-499`
- **Issue:** Query string included in response, exposing schema.
- **Fix:** Only echo query in non-production or when explicitly requested.
- **Status:** FIXED
