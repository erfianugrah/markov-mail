# Remediation Plan – Full Code Review

Comprehensive findings from a full-codebase code review covering `src/`, `dashboard/`,
`cli/`, `tests/`, `config/`, `migrations/`, `scripts/`, and `docs/`.

Items are grouped by severity and ordered by recommended fix priority within each group.

---

## CRITICAL – Fix immediately

### C1. Timing-unsafe API key comparison
- **File:** `src/middleware/auth.ts:41`
- **Issue:** Uses `!==` string comparison for the API key, which is vulnerable to
  timing side-channel attacks. An attacker can brute-force the key one character at
  a time by measuring response latency.
- **Fix:** Hash both the provided key and the stored key with SHA-256, then compare
  the digests with `crypto.subtle.timingSafeEqual()`.

### C2. Unauthenticated `/debug` endpoint
- **File:** `src/index.ts:91-99`
- **Issue:** The `/debug` GET endpoint returns client IP, JA4 fingerprint, ASN, bot
  score, geolocation, and TLS metadata with no authentication. Information disclosure.
- **Fix:** Gate behind `requireApiKey` middleware, or remove entirely.

### C3. Open CORS with no origin restriction
- **File:** `src/index.ts:40`
- **Issue:** `cors()` with no configuration allows any origin to make requests.
  Combined with API keys in headers, a malicious page could exfiltrate admin data.
- **Fix:** Restrict to `cors({ origin: ['https://fraud.erfi.dev'] })` or at minimum
  restrict admin routes.

### C4. Migration 0002 will fail on fresh databases
- **File:** `migrations/0002_add_identity_geo_mx_columns.sql`
- **Issue:** Adds columns that already exist in `migrations/0001`. Running both on a
  new D1 database throws `duplicate column` errors.
- **Fix:** Remove the duplicate columns from migration 0001 (keep them only in 0002),
  or guard 0002 with `IF NOT EXISTS` logic, or consolidate into a single migration.

### C5. SQL query validation is bypassable
- **File:** `src/routes/admin.ts:53-92`
- **Issue:** Blocklist-based SQL validator has multiple gaps:
  - Column names containing blocked keywords (e.g. `LAST_UPDATED`) are falsely blocked.
  - Table check misses `FROM(table)` or `FROM "table"` syntax.
  - No protection against `ATTACH DATABASE` or SQLite pragmas.
  - Subqueries can reference tables outside the allow list.
- **Fix:** Replace blocklist with a proper SQL AST parser, or use D1's read-only
  transaction mode, or at minimum add `ATTACH`, `PRAGMA`, `LOAD_EXTENSION` to the
  blocklist and use word-boundary matching for dangerous keywords.

---

## HIGH – Fix this sprint

### H1. N-gram sets are broken for international names
- **File:** `src/detectors/ngram-multilang.ts`
- **Issue:** Bigram Sets contain 3-8 character strings, trigram Sets contain 4-8
  character strings. Since `extractNGrams(text, n)` produces n-character windows,
  these oversized entries never match. Affected languages: German (`'sch'`, `'stein'`,
  `'berg'`), Italian (`'zione'`, `'cchi'`), Romanized (`'ovich'`, `'kumar'`,
  `'nguyen'`).
- **Impact:** International names get lower naturalness scores and are more likely to
  be flagged as suspicious. Combined with aggressive thresholds (H2), this causes
  systematic bias against non-English email addresses.
- **Fix:** Move oversized entries to the correct n-gram size set, or implement
  sliding-window substring matching instead of exact set lookup.

### H2. Default thresholds are very aggressive
- **File:** `src/config/defaults.ts:65-68`
- **Issue:** Block at `0.3`, warn at `0.25`. A score of 0.31 (meaning "31% fraud
  probability" after Platt calibration) triggers a hard block. The warn-to-block gap
  is only 0.05, so very few requests land in the warn zone.
- **Fix:** Re-evaluate thresholds against calibration data. Consider `block: 0.65`,
  `warn: 0.35` as a starting point per the docs' own recommendations.

### H3. Bot score falsy-value bug
- **File:** `src/fingerprint.ts:18`
- **Issue:** Uses `||` instead of `??`. When `parseInt` returns `0` (a valid bot
  score meaning "definitely automated"), `||` treats it as falsy and falls through.
- **Fix:** Replace `||` with `??` (nullish coalescing).

### H4. Dashboard ModelMetrics confusion matrix is meaningless
- **File:** `dashboard/src/components/ModelMetrics.tsx:37-40`
- **Issue:** Maps `block→TP`, `allow→TN`, `warn→FP`, `FN=0`. Without ground-truth
  labels this is not a real confusion matrix. Derived accuracy/precision/recall/F1
  metrics are misleading.
- **Fix:** Relabel as "Decision Distribution" or add actual ground-truth feedback loop.

### H5. Dashboard QueryBuilder sends arbitrary SQL
- **File:** `dashboard/src/components/QueryBuilder.tsx:67-89`
- **Issue:** Sends raw user-typed SQL to the server with no client-side checks.
  Combined with the API key in localStorage and the server-side SQL validation gaps
  (C5), this is an escalation vector.
- **Fix:** Add client-side `SELECT`-only check, or limit to predefined query templates.

### H6. No runtime feature name alignment check
- **File:** `src/detectors/forest-engine.ts:87`
- **Issue:** `features[current.f] ?? 0` silently defaults to 0 when a feature name in
  the model doesn't match the feature vector. A model/code mismatch produces
  meaningless predictions with no error or warning.
- **Fix:** At model load time, cross-check `meta.features` against the keys produced
  by `buildFeatureVector`. Log warnings for any mismatches.

### H7. PII stored in cleartext with no retention policy
- **File:** `schema.sql`, `migrations/0001`
- **Issue:** `client_ip`, `email_local_part`, `domain`, `user_agent`, `city`,
  `postal_code` stored unencrypted in D1. No TTL, no automatic cleanup.
- **Fix:** Add a scheduled cleanup job (e.g. delete rows older than 90 days), hash
  PII fields at write time, or add a data retention policy migration.

---

## MEDIUM – Fix next sprint

### M1. `'w'` phonetic classification is inverted
- **File:** `src/detectors/linguistic-features.ts:365-374`
- **Issue:** Treats `'w'` as a vowel when followed by a vowel (e.g., "wa", "we"),
  which is phonetically backwards. In "william", `'w'` is classified as a vowel.
  Affects pronounceability scores for names containing `'w'`.
- **Fix:** Invert the condition: treat `'w'` as vowel when preceded by a vowel
  (diphthong: "aw", "ew", "ow"), not when followed by one.

### M2. Decision tree has no recursion depth limit
- **File:** `src/models/decision-tree.ts:163-178`
- **Issue:** Uses recursion with no depth guard. The forest engine correctly uses
  iterative traversal capped at `MAX_DEPTH=20`, but the decision tree does not.
  A corrupted KV model could cause stack overflow.
- **Fix:** Convert to iterative traversal with a depth limit, matching the forest
  engine's approach.

### M3. Forest engine MAX_DEPTH not validated against model
- **File:** `src/detectors/forest-engine.ts:82`
- **Issue:** Hardcoded `MAX_DEPTH=20`. If a model is trained with `max_depth > 20`,
  traversal silently truncates and returns 0 (under-counting fraud).
- **Fix:** Read `meta.config.max_depth` and use it as the limit (with an absolute
  upper cap for safety).

### M4. Dashboard dead code and fetch pattern duplication
- **Files:**
  - `dashboard/src/components/ApiKeyInput.tsx` – never imported, entirely dead
  - `dashboard/src/hooks/useAnalytics.ts` – never imported, dead
  - All data components independently re-implement `useState`/`useEffect`/`try-catch`
    fetch logic instead of using a shared hook
- **Fix:** Delete dead files. Refactor `useAnalytics.ts` to wrap `api.ts` and adopt
  it in all data components.

### M5. Dashboard CSV export vulnerable to formula injection
- **File:** `dashboard/src/components/ExportButton.tsx:34`
- **Issue:** Values starting with `=`, `+`, `-`, `@` are not escaped, allowing
  spreadsheet formula injection when opened in Excel.
- **Fix:** Prefix cell values starting with those characters with a single quote `'`.

### M6. Dashboard refresh destroys all child state
- **File:** `dashboard/src/components/Dashboard.tsx:87-128`
- **Issue:** Changing `key` props on refresh unmounts/remounts all children, losing
  scroll positions and triggering full chart re-animations.
- **Fix:** Pass `refreshKey` as a prop and trigger refetches internally instead of
  using React `key` to force remounts.

### M7. `parseInt` for localStorage interval can cause infinite loop
- **File:** `dashboard/src/components/Dashboard.tsx:43`
- **Issue:** If localStorage contains a non-numeric string, `parseInt` returns `NaN`,
  making `setInterval(fn, NaN)` fire at ~0ms in a tight loop.
- **Fix:** Add `Number.isFinite()` guard with fallback to default interval.

### M8. MX provider record count mismatch
- **File:** `src/utils/known-mx-providers.ts:159-166`
- **Issue:** AOL entry says `expectedRecordCount: 2` but the records array has 1.
- **Fix:** Correct the count or add the missing record.

### M9. Unbounded MX cache growth
- **File:** `src/services/mx-resolver.ts`
- **Issue:** Module-level `Map` cache has no size limit or eviction. Under sustained
  load with diverse domains, it grows until the Worker isolate recycles.
- **Fix:** Implement an LRU eviction strategy or cap the cache size.

### M10. `evaluateCondition` strict equality for `==`/`!=`
- **File:** `src/models/decision-tree.ts:186-189`
- **Issue:** Uses `===`/`!==`, so a model node with threshold `'1'` (string) won't
  match feature value `1` (number). Type mismatches are silent.
- **Fix:** Coerce both sides to the same type before comparison, or validate model
  node types at load time.

### M11. Dashboard MetricsGrid ignores "warn" decisions
- **File:** `dashboard/src/components/MetricsGrid.tsx:80`
- **Issue:** `allowRate = 100 - blockRate` counts warn decisions as allowed.
- **Fix:** Compute `allowRate = 100 - blockRate - warnRate`.

### M12. useAnalytics hook uses GET while api.ts uses POST
- **File:** `dashboard/src/hooks/useAnalytics.ts:29` vs `dashboard/src/lib/api.ts:44`
- **Issue:** Inconsistent HTTP methods, URL resolution, and header casing for the same
  `/admin/analytics` endpoint.
- **Fix:** Delete the hook (it's dead code) or fix it to use `api.ts` internally.

---

## LOW – Backlog

### L1. Duplicate JSDoc blocks
- **File:** `src/index.ts:199-226` and `src/index.ts:251-277`
- **Fix:** Remove the duplicate.

### L2. Deprecated `substr` usage
- **File:** `src/index.ts:169`
- **Fix:** Replace `substr(2, 9)` with `substring(2, 11)`.

### L3. Dead configuration values
- **File:** `src/config/defaults.ts`
- **Issue:** `riskWeights`, `patternThresholds`, `adjustments`, `ood` are defined but
  never used in the scoring pipeline. Operators may tune them with no effect.
- **Fix:** Remove dead config or wire them into the pipeline.

### L4. Alert threshold inconsistency
- **File:** `src/middleware/fraud-detection.ts:603`
- **Issue:** Alert uses `>=` while decision uses `>`. At the exact warn boundary, an
  alert fires but the decision is `'allow'`.
- **Fix:** Align to both use `>=` or both use `>`.

### L5. Identity signals computed twice
- **File:** `src/middleware/fraud-detection.ts:189`
- **Issue:** First call passes empty string (always returns zeros), then line 368
  recomputes with the actual local part.
- **Fix:** Remove the first call.

### L6. Platt scaling sign not validated
- **File:** `src/models/random-forest.ts:196-208`
- **Issue:** A negative `coef` would invert the calibration direction.
- **Fix:** Validate `coef > 0` at model load time.

### L7. ProtonMail classified as "sketchy" (reputation 0.6)
- **File:** `src/validators/domain.ts:205-261`
- **Issue:** ProtonMail is grouped with Yandex and Mail.ru. Penalizes privacy-
  conscious users.
- **Fix:** Re-evaluate per current abuse data; consider moving to "trusted free" tier.

### L8. N-gram risk score uses hardcoded English threshold
- **File:** `src/detectors/ngram-analysis.ts:191-206`
- **Issue:** Risk formula uses `0.4` threshold while multi-language classifier uses
  `0.30`. Non-English natural text gets a small residual risk penalty.
- **Fix:** Pass the language-appropriate threshold into the risk calculation.

### L9. `getPatternRiskScore` is dead code
- **File:** `src/detectors/pattern-family.ts:398-438`
- **Issue:** Exported but never called from the middleware.
- **Fix:** Remove or document as reserved for future use.

### L10. `latitude`/`longitude` stored as TEXT
- **File:** `schema.sql:48-49`
- **Fix:** Change to REAL in a future migration.

### L11. `is_eu_country` stored as TEXT
- **File:** `schema.sql:51`
- **Fix:** Change to INTEGER in a future migration.

### L12. Dashboard accessibility gaps
- **Files:** Multiple dashboard components
- **Issues:**
  - Charts have no text alternatives for screen readers
  - `<select>` without label (`GlobalControlsBar.tsx:56`)
  - `<textarea>` without label (`QueryBuilder.tsx:117`)
  - `<table>` without caption (`ValidationTable.tsx:159`)
  - Loading spinners lack ARIA attributes
  - Table rows with `cursor-pointer` but no click handler
- **Fix:** Add `aria-label`, `<caption>`, `role="status"` attributes progressively.

### L13. Heuristic config duplicate reason strings
- **File:** `config/risk-heuristics.json`
- **Issue:** `digitRatio` entries reuse `sequentialConfidence` reason strings, making
  log analysis ambiguous.
- **Fix:** Give each signal unique reason strings.

### L14. `.dev.vars.example` missing secrets
- **File:** `.dev.vars.example`
- **Issue:** Only documents `X-API-KEY` but not `ADMIN_API_KEY` or
  `ALERT_WEBHOOK_URL` referenced elsewhere.
- **Fix:** Add all required secrets with placeholder values.

### L15. Documentation is severely out of sync
- **Files:** All docs in `docs/`
- **Issues:**
  - Every SQL example references `ANALYTICS_DATASET` instead of `validations`
  - 6 different threshold values across files vs actual config
  - 3 broken links to non-existent files (`DECISION_TREE.md`, `MODEL_TRAINING_v3.md`,
    `TRAINING.md`)
  - `SYSTEM_INVENTORY.md` frozen at v2.4.2 with wrong feature names
  - Placeholder GitHub URLs (`yourusername/markov-mail`)
- **Fix:** Comprehensive docs audit (separate PR).

---

## Training Pipeline Review – Resolved (2026-02-23, PR #5)

All findings from the comprehensive training pipeline review are now fixed in commit `9ba1e08`.

### Critical (Resolved)
- **C1. Train/serve identity skew** — Fixed: 40% of both legit and fraud emails now omit name via `NO_NAME_RATIO`.
- **C2. Feature export row count mismatch** — Fixed: Added row count logging to feature export for sanity checking.
- **C3. Dated patterns mislabeled** — Fixed: Added `generateDatedLegitEmail()` + reduced fraud dated weight.

### High (Resolved)
- **H1. Hardcoded model version** — Fixed: Added `--version` CLI flag to `train_forest.py`.
- **H2. Static conflict zone thresholds** — Fixed: Added `--conflict-entropy-threshold` and `--conflict-reputation-threshold` CLI args.
- **H3. Platt overfits with --no-split** — Fixed: Uses OOB predictions (`oob_score=True`) for unbiased calibration.
- **H4. No shuffle in feature export** — Fixed: Added `--shuffle` flag for Fisher-Yates shuffle.
- **H5. Gibberish generator too pronounceable** — Fixed: Added 5 new realistic gibberish generators.

### Medium (Resolved)
- **M3. Weak PRNG** — Fixed: Replaced LCG with mulberry32.
- **M6. 4 decimal rounding** — Fixed: Increased to 6 decimal places.

### Low (Resolved)
- **L1. Deprecated files** — Fixed: Deleted `train.ts` and `train_forest_wrapper.ts`.
- **L3. checkFeatureAlignment never called** — Fixed: Called on first evaluation after model load.

---

## Testing & Validation

After fixes, verify:

1. `npm run typecheck` passes
2. `npm run test` passes (all existing tests still green)
3. `npm run dashboard:build` succeeds
4. Manual smoke test of `/validate` endpoint with:
   - English name emails
   - International name emails (German, Russian, Chinese romanized)
   - Disposable domains
   - Empty/malformed bodies
5. Verify `/debug` now requires auth
6. Verify CORS is restricted
7. Run `npm run test:coverage` and confirm >= 90% on modified files
