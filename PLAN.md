# Container-Based Automated Retraining

Run Random Forest retraining inside a Cloudflare Container on a cron schedule,
then PUT the new model into KV — fully automated, zero-dependency on Python or
scikit-learn. Everything is hand-rolled in TypeScript.

## Overview

```
                        weekly cron (e.g. "0 3 * * 0")
                                   │
                        ┌──────────▼───────────┐
                        │  markov-mail Worker   │
                        │  scheduled() handler  │
                        └──────────┬───────────┘
                                   │ getContainer().start()
                        ┌──────────▼───────────┐
                        │  TrainerContainer     │
                        │  (Durable Object)     │
                        │                       │
                        │  1. Fetch dataset      │
                        │     from Worker API    │
                        │  2. Compute features   │
                        │  3. Train RF (hand-    │
                        │     rolled CART)       │
                        │  4. Platt calibration  │
                        │  5. Run guardrails     │
                        │  6. POST model back    │
                        │     to Worker → KV     │
                        │                       │
                        │  sleepAfter = '30s'   │
                        └───────────────────────┘
```

**Why Containers?** The training pipeline currently requires Python + scikit-learn
running locally via CLI. A Container lets us run a long-running compute job
(minutes, not the 30s Worker CPU limit) on Cloudflare's network, with the model
hot-swapped into KV without any manual intervention.

**Why hand-roll?** By implementing CART + bagging + Platt scaling in TypeScript,
the container image only needs a Node.js/Bun runtime — no Python, no pip, no
venv. The entire training algorithm runs in ~500 lines and produces the exact
same `ForestModel` JSON format the inference engine already consumes.

---

## Phase 1: Hand-Rolled Random Forest Trainer

**Goal:** Pure TypeScript implementation of Random Forest training that produces
the identical `ForestModel` JSON consumed by `src/detectors/forest-engine.ts`.

### 1.1 CART Decision Tree (Gini Impurity)

New file: `src/training/cart.ts`

Algorithm for each node:
1. **Stopping criteria** — create leaf (`{t:'l', v: P(fraud)}`) when:
   - `depth >= maxDepth`
   - `samples.length < minSamplesLeaf * 2` (can't split further)
   - Node is pure (all same label)
   - No valid split found (all features constant)

2. **Best split search:**
   - Select `floor(sqrt(numFeatures))` random candidate features (RF convention)
   - For each candidate feature:
     - Sort sample indices by feature value
     - Scan all midpoints between adjacent distinct values
     - Compute weighted Gini impurity: `G = (nL/n)*gini(L) + (nR/n)*gini(R)`
       where `gini(S) = 1 - p(0)^2 - p(1)^2`
     - Track the split `(feature, threshold)` with lowest `G`
   - Optimization: use the sorted-scan approach (O(n) per feature after sort)
     rather than brute-force O(n^2)

3. **Recurse** on left (`feature <= threshold`) and right (`feature > threshold`)

4. **Output format:** Exact match to `CompactTreeNode`:
   ```ts
   { t: 'n', f: 'bigram_entropy', v: 3.142857, l: {...}, r: {...} }
   { t: 'l', v: 0.847523 }  // leaf: P(fraud)
   ```

### 1.2 Random Forest (Bagging + Feature Subsampling)

New file: `src/training/random-forest.ts`

1. **Bootstrap sampling:** For each tree, sample `n` rows with replacement from
   the training set. Track which rows were NOT selected (out-of-bag / OOB set).

2. **Sample weights:** Support conflict-zone weighting (existing pattern):
   rows where `bigram_entropy > threshold && domain_reputation_score >= threshold`
   get `conflictWeight` (default 20x). Implemented via weighted bootstrap —
   sample with replacement where probability is proportional to weight.

3. **Tree training:** Call CART with the bootstrap sample and random feature
   subset at each node.

4. **OOB predictions:** After all trees are trained, for each training sample,
   average the predictions from only the trees that did NOT see it in their
   bootstrap sample. This gives unbiased predictions for calibration (H3 fix
   equivalence).

5. **Feature importance:** Computed as mean decrease in Gini impurity across
   all splits for each feature, normalized to sum to 1.0. Tracked during tree
   training by accumulating `(n_samples_at_node / n_total) * gini_decrease`
   for each feature's splits.

6. **Output:** `ForestModel` matching the existing schema:
   ```ts
   {
     meta: {
       version: string,        // e.g. "20260315-forest-auto"
       features: string[],     // sorted feature names
       tree_count: number,
       feature_importance: Record<string, number>,
       calibration: { method: 'platt', coef, intercept, samples },
       config: { n_trees, max_depth, min_samples_leaf, conflict_weight, ... }
     },
     forest: CompactTreeNode[]
   }
   ```

### 1.3 Platt Scaling (1D Logistic Regression)

New file: `src/training/platt-scaling.ts`

Fit `P(fraud) = 1 / (1 + exp(-(coef * rawScore + intercept)))` to the OOB
predictions vs true labels using Newton-Raphson (IRLS):

1. Initialize `coef = 0`, `intercept = 0`
2. For up to 100 iterations:
   - Compute predicted probabilities: `p_i = sigmoid(coef * x_i + intercept)`
   - Compute gradient and Hessian of log-loss
   - Newton update: `[coef, intercept] -= H^{-1} * grad`
   - Converge when `|delta| < 1e-8`
3. Target correction (Platt's original paper): use `(y_i * (N+ + 1) + 1) / (N+ + 2)`
   instead of raw `y_i` to avoid overfitting on small calibration sets.

Output: `ForestCalibrationMeta` (`{ method: 'platt', coef, intercept, samples }`)

### 1.4 Guardrails (Threshold Verification)

New file: `src/training/guardrails.ts`

Port the constraint verification from `cli/commands/model/guardrail.ts`:

1. **Threshold scan:** For thresholds from 0.05 to 0.95 in 0.01 steps:
   - Classify calibrated OOB predictions against each threshold
   - Compute recall, FPR, FNR at each threshold
2. **Threshold recommendation:**
   - Find warn threshold: highest threshold where `recall >= 0.95 && FPR <= 0.05`
   - Find block threshold: highest threshold where `recall >= 0.95 && FNR <= 0.05`
   - Verify gap: `blockThreshold - warnThreshold >= 0.01`
3. **Reject on failure:** If constraints can't be satisfied, abort and do NOT
   write to KV. Log the failure to D1 `training_metrics` table.

### 1.5 Validation Against Existing Engine

The trained model must be loadable by the existing inference path without
changes. Verification:

- `validateForestModel(model)` returns `true`
- `checkFeatureAlignment(model, sampleVector)` passes (< 20% missing)
- `predictForestScore(model, testVector)` returns a value in `[0, 1]`
- Model JSON is < 25 MB (KV limit)
- `meta.tree_count === forest.length`
- `meta.calibration.coef > 0` (positive direction)

---

## Phase 2: Training Data Pipeline

**Goal:** Get labeled training data into the container without local filesystem
access (container disk is ephemeral).

### 2.1 Training Dataset in KV

Store pre-computed feature vectors as a JSON blob in the `CONFIG` KV namespace
under key `training_dataset.json`:

```ts
interface TrainingDataset {
  version: string;
  created: string;       // ISO timestamp
  samples: number;
  features: string[];    // sorted feature names
  rows: {
    features: number[];  // values in same order as features[]
    label: 0 | 1;
    weight?: number;     // optional sample weight
  }[];
}
```

**Why KV and not D1?** The existing labeled CSVs have ~5K-20K rows x 45 features.
As JSON this is 2-8 MB — well within KV's 25 MB value limit. D1 has a 10M row
limit and would require a schema change to store feature vectors.

**Upload path:** New CLI command `npm run cli training-data:upload` that:
1. Reads the existing CSV feature export (`data/features/export.csv`)
2. Converts to the `TrainingDataset` JSON format
3. PUTs to `CONFIG` KV under key `training_dataset.json`

**Future: D1-based incremental data** (Phase 4 stretch goal)
- New `training_samples` table with the full 45-feature vector
- `fraud-detection.ts` middleware writes feature vectors to this table on every
  validation (via `waitUntil`)
- Container queries D1 for recent samples, merges with base dataset

### 2.2 Admin API Endpoints

New routes on the existing admin router (`src/routes/admin.ts`):

```
GET  /admin/training/dataset          → returns dataset metadata (samples, version, features)
GET  /admin/training/dataset/download → returns full dataset JSON
POST /admin/training/dataset/upload   → accepts dataset JSON, validates, writes to KV
POST /admin/training/trigger          → manually triggers a retraining run
GET  /admin/training/status           → returns latest training run status from D1
POST /admin/training/model            → accepts trained model JSON, validates, writes to KV
```

The container communicates with these endpoints via HTTP using the admin API key
passed as an env var.

### 2.3 Worker-Side Model Upload Handler

The `POST /admin/training/model` endpoint:
1. Validates the model using `validateForestModel()`
2. Checks size < 25 MB
3. Writes to `CONFIG` KV under the appropriate key:
   - `random_forest.json` if `meta.tree_count > 1`
   - `decision_tree.json` if `meta.tree_count === 1`
4. Clears the in-memory model cache (forces reload on next request)
5. Logs to D1 `training_metrics` with event `model_deployed`
6. Returns the model version and write confirmation

---

## Phase 3: Cloudflare Container Integration

**Goal:** Wire the trainer into a Durable Object-backed Container that runs on
a cron schedule.

### 3.1 Container Class

New file: `src/container/trainer.ts`

```ts
import { Container } from '@cloudflare/containers';

export class TrainerContainer extends Container {
  defaultPort = 8787;
  sleepAfter = '30s';  // stop after 30s idle (training is done)

  override onStart() { /* log container start */ }
  override onStop()  { /* log container stop  */ }
}
```

### 3.2 Container Entrypoint

New file: `container/train.ts` (runs inside the container)

This is a standalone HTTP server (Bun/Node) that:
1. Starts listening on port 8787
2. On `GET /health` → returns 200
3. On `POST /train` with body `{ workerUrl, apiKey, config }`:
   a. Fetches training dataset from `workerUrl + '/admin/training/dataset/download'`
   b. Parses into feature matrix + label vector
   c. Trains Random Forest using `src/training/random-forest.ts`
   d. Runs Platt calibration using `src/training/platt-scaling.ts`
   e. Runs guardrails using `src/training/guardrails.ts`
   f. POSTs the trained model to `workerUrl + '/admin/training/model'`
   g. Returns training summary (metrics, duration, model version)
4. If guardrails fail → returns the failure details, does NOT upload

### 3.3 Dockerfile

New file: `container/Dockerfile`

```dockerfile
FROM oven/bun:1-slim
WORKDIR /app
COPY container/ .
COPY src/training/ src/training/
RUN bun install
EXPOSE 8787
CMD ["bun", "run", "train.ts"]
```

Minimal image: ~150 MB (Bun slim). No Python, no pip, no system deps.

### 3.4 Scheduled Handler

Modify `src/index.ts` scheduled handler:

```ts
scheduled: async (event, env, ctx) => {
  // Existing: disposable domain update
  ctx.waitUntil(updateDisposableDomains(env.DISPOSABLE_DOMAINS_LIST));

  // New: weekly model retraining
  if (shouldRetrain(event.cron)) {
    const container = getContainer(env.TRAINER);
    await container.start({
      envVars: {
        WORKER_URL: 'https://fraud.erfi.dev',
        API_KEY: env['X-API-KEY'],
        TRAIN_CONFIG: JSON.stringify({
          nTrees: 10,
          maxDepth: 6,
          minSamplesLeaf: 20,
          conflictWeight: 20,
        }),
      },
    });
    // Container will fetch data, train, upload model, then sleep
  }
};
```

### 3.5 Wrangler Config Changes

Add to `wrangler.jsonc`:

```jsonc
{
  // existing config...
  "triggers": {
    "crons": [
      "0 */6 * * *",     // existing: disposable domain update
      "0 3 * * 0"        // new: weekly retraining (Sunday 3AM UTC)
    ]
  },
  "containers": [{
    "class_name": "TrainerContainer",
    "image": "./container/Dockerfile"
  }],
  "durable_objects": {
    "bindings": [{
      "class_name": "TrainerContainer",
      "name": "TRAINER"
    }]
  },
  "migrations": [{
    "new_sqlite_classes": ["TrainerContainer"],
    "tag": "v1"
  }]
}
```

---

## Phase 4: Observability & Safety

### 4.1 D1 Training Metrics

All training events are logged to the existing `training_metrics` table:

| Event                  | When                                         |
|------------------------|----------------------------------------------|
| `training_started`     | Container begins training                    |
| `training_completed`   | Model passes guardrails and uploaded to KV   |
| `training_failed`      | Guardrails failed or runtime error           |
| `validation_passed`    | Guardrails passed with metrics               |
| `validation_failed`    | Guardrails failed with details               |
| `candidate_created`    | Model trained but not yet validated           |

Stored fields: `model_version`, `trigger_type` ('scheduled'|'manual'),
`fraud_count`, `legit_count`, `total_samples`, `training_duration`,
`accuracy`, `precision_metric`, `recall`, `f1_score`, `false_positive_rate`.

### 4.2 Rollback Safety

The model upload path is atomic (single KV `put`). If the new model degrades
performance, rollback is:
1. `npm run cli kv:put random_forest.json < config/production/random-forest.json`
2. Or via admin API: `POST /admin/training/model` with the previous model JSON
3. The old model is always preserved in `config/production/` in the repo

### 4.3 Model Comparison Gate (Future)

Before uploading, compare new model against the current production model on a
held-out validation set. Only promote if the new model doesn't regress on key
metrics (recall, FPR). This is the A/B testing infrastructure already in place.

---

## Implementation Order

| Step | What                                      | Files                                       | Est. |
|------|-------------------------------------------|---------------------------------------------|------|
| 1    | CART tree trainer                         | `src/training/cart.ts`                      | Core |
| 2    | Random Forest (bagging + OOB)             | `src/training/random-forest.ts`             | Core |
| 3    | Platt scaling                             | `src/training/platt-scaling.ts`             | Core |
| 4    | Guardrails (threshold scan + verify)      | `src/training/guardrails.ts`                | Core |
| 5    | Unit tests for training                   | `tests/unit/training/`                      | Core |
| 6    | Training data upload CLI command          | `cli/commands/data/training-upload.ts`      | Data |
| 7    | Admin API training endpoints              | `src/routes/admin.ts` (extend)              | Data |
| 8    | Container entrypoint                      | `container/train.ts`                        | Wire |
| 9    | Container class + Dockerfile              | `src/container/trainer.ts`, `Dockerfile`    | Wire |
| 10   | Scheduled handler + wrangler changes      | `src/index.ts`, `wrangler.jsonc`            | Wire |
| 11   | D1 metrics logging                        | `src/services/training-logger.ts`           | Obs. |
| 12   | Integration test (local container)        | `tests/e2e/training/`                       | Test |

Steps 1-5 are the core algorithm work. Steps 6-7 are the data pipeline. Steps
8-10 wire it into the container. Steps 11-12 are observability and testing.

---

## Key Design Decisions

1. **No Python.** The entire training pipeline is TypeScript. The existing
   `train_forest.py` (scikit-learn) remains for offline/manual training, but
   the automated container path is pure TS.

2. **KV for training data, not D1.** The feature matrix (5K-20K rows x 45 cols)
   fits comfortably in a single KV value (<10 MB). D1 would require schema
   changes and is slower for bulk reads.

3. **OOB calibration only.** The container trains on 100% of data (no
   train/test split) and uses out-of-bag predictions for Platt scaling,
   matching the existing `--no-split` production mode.

4. **Container HTTP, not RPC.** The container communicates with the Worker via
   HTTP to the admin API. This keeps the container code decoupled and testable
   outside of Cloudflare (run `bun container/train.ts` locally).

5. **Guardrails are mandatory.** A model that fails constraints (recall < 0.95,
   FPR > 0.05, FNR > 0.05) is never uploaded. The container logs the failure
   and exits. No human in the loop for rejection.

6. **Weekly schedule, not daily.** The model changes slowly (email fraud
   patterns evolve over weeks). Weekly retraining limits compute cost and
   avoids model churn. Configurable via wrangler cron expression.

7. **Same inference path.** The trained model is identical in format to the
   scikit-learn output. The inference engine (`forest-engine.ts`),
   model loader (`random-forest.ts`), and middleware (`fraud-detection.ts`)
   require zero changes.

---

## Risk Assessment

| Risk                                    | Mitigation                                         |
|-----------------------------------------|----------------------------------------------------|
| Hand-rolled RF diverges from sklearn    | Validate against sklearn output on same dataset    |
| Container cold start delays cron        | Acceptable — training is batch, not latency-bound  |
| Bad model goes live                     | Guardrails gate + atomic KV write + easy rollback  |
| Training data stale                     | Future: D1 incremental data pipeline (Phase 4)     |
| KV 25 MB limit hit                      | Size check before upload; cap n_trees/max_depth    |
| Container beta instability              | Fallback: CLI pipeline remains fully functional    |
| OOB calibration insufficient samples    | Require min 100 OOB samples per tree; abort below  |

---

## Verification Checklist

- [ ] `cart.ts` produces identical tree structure to sklearn on a toy dataset
- [ ] `random-forest.ts` OOB predictions match sklearn OOB within 0.01 RMSE
- [ ] `platt-scaling.ts` matches sklearn LogisticRegression on same inputs
- [ ] `guardrails.ts` rejects models that fail constraints
- [ ] Trained model passes `validateForestModel()` and `checkFeatureAlignment()`
- [ ] Model JSON < 25 MB for 10 trees, depth 6, 45 features
- [ ] Container starts, trains, uploads, and sleeps on cron trigger
- [ ] `training_metrics` D1 table populated correctly
- [ ] Rollback via CLI/admin API works within 60s
- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes (existing + new tests)

---
---

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
