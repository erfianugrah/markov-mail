# Model Quality Automation Plan

This document spells out how we will convert today’s manual “train → eyeball batch results → tweak thresholds/heuristics” flow into an automated, data-driven pipeline. Each phase can be implemented independently, but the end goal is a single command (or CI job) that trains, calibrates, validates, and promotes models with minimal human intervention.

---

## Phase 1 – Structured Calibration & Thresholding

1. **Augment `model:calibrate` output**
   - Extend the CLI command to emit a JSON/CSV report containing, for thresholds 0.05 → 0.95:
     - TP, FP, TN, FN counts
     - Recall, Precision, FPR, FNR
   - Store the report under `data/calibration/threshold-scan.json`.

2. **Add `model:thresholds` command**
   - Inputs: the calibration report, desired constraints (e.g., recall ≥ 0.95, FPR ≤ 0.05, FNR ≤ 0.05).
   - Output: the smallest warn/block thresholds that satisfy constraints (warn < block).
   - Fail fast if no threshold combination meets constraints; surface a summary table to operators.

3. **Config updater**
   - Create a `config:update-thresholds` CLI helper that patches `config/production/config.json` and `DEFAULT_CONFIG` with the recommended warn/block values.
   - Emit a changelog entry automatically so threshold changes are always logged.

4. **Guardrail check in CI**
   - Add a Vitest script or standalone tool that asserts the new thresholds really hit the target on the calibration set (no more ad-hoc manual verification).
   - **Status**: `npm run guardrail` (alias for `model:guardrail` with default paths/constraints) now orchestrates calibration, threshold recommendation, and constraint verification. It fails fast if the warn/block pair no longer satisfies `recall ≥ 0.95`, `FPR/FNR ≤ 0.05`, or the minimum warn/block gap, making it ideal for CI jobs before auto-updating configs.

Deliverable: one scripted flow (`model:train → model:calibrate → model:thresholds → config:update-thresholds`) that requires no hand-editing.

---

## Phase 2 – Data-Driven Heuristics

1. **Externalize heuristic definitions**
   - Move the current hard-coded bumps (domain reputation, TLD, sequential digits, plus addressing, bot score) into a JSON config (e.g., `config/risk-heuristics.json`).
   - Shape:
     ```json
     {
       "domainReputation": [
         { "min": 0.60, "decision": "warn", "delta": 0.08, "label": "watch" },
         { "min": 0.75, "decision": "block", "delta": 0.12, "label": "critical" }
       ],
       "tldRisk": [ ... ],
       "vpnDomains": ["exitrelay.net", "fastproxymail.com"],
       "typosquatDomains": ["outl0ok.com", "hotnail.com"]
     }
     ```
   - Middleware loads this config at startup and applies heuristics generically.

2. **Analytics-driven updates**
   - Build a script (cron job or CLI) that ingests batch-test false negatives + production analytics and updates:
     - Domain/tld watchlists
     - Threshold multipliers (e.g., lower domain warn cutoff if many FNs fall between 0.60–0.75)
   - Persist the generated config in KV so the Worker picks it up without redeploy.

3. **Promotion rules**
   - Define criteria for promoting a pattern to a deterministic rule (e.g., domain seen in ≥50 FNs → add to `typosquatDomains` automatically).
   - Hook this into the analytics job so the heuristics evolve from data, not manual commits.

Deliverable: heuristics live in config/KV, are updated automatically based on observed misses, and the code simply consumes them.
**Status**: The `model:pipeline` CLI accepts a `--search '[{...}]'` array so multiple hyperparameter sets (tree counts, depths, conflict weights) run automatically until the guardrail passes. All attempts are logged, and promotion continues only when the target SLO is satisfied.

---

## Phase 3 – Feedback Loop & Monitoring

1. **False-negative warehouse**
   - Every `test:batch` run writes its FN/FP samples to D1 (or a dedicated JSON log) with rich signals: domain, provider, entropy, heuristics applied.
   - A daily job aggregates them and produces pattern-level stats (e.g., recall by provider, recall by pattern family).

2. **Metric guardrails**
   - Add a CI step (or GitHub Action) that runs:
     - `model:calibrate`
     - `model:thresholds`
     - `test:batch` (against a local mock or staging endpoint)
   - The job fails if recall < 95% or FP/FN > 5%; the failure report points to the offending pattern breakdown.

3. **Dashboard updates**
   - Surface the calibration curves, threshold recommendations, and live recall metrics in the existing dashboard so operators can see when/why the pipeline adjusted knobs.

4. **Auto-publish**
   - Once all guardrails pass, automatically push the new model/config to KV (`kv:put random_forest.json`, `config:upload`) and tag the release.
   - **Status**: `npm run pipeline` orchestrates export → training → guardrail → threshold update → config sync (with optional `--upload-model`, `--apply-thresholds`, `--sync-config`). It also snapshots artifacts so reviewers can inspect the promotion bundle.

Deliverable: a full closed loop where training → calibration → thresholding → batch validation → promotion happens via scripts/CI, and any regression is caught + reported without manual eyeballing.

---

## Phase 4 – Advanced Enhancements (Optional)

1. **Automated conflict-zone weighting**
   - Use the false-negative warehouse to learn new weighting masks automatically (e.g., run clustering on FN feature vectors and generate synthetic “conflict” definitions).

2. **A/B gating**
   - Introduce an A/B toggle (per KV config) so new heuristic sets or thresholds can be rolled out to a percentage of traffic and monitored before full promotion.

3. **Alternative learners**
   - If we later adopt XGBoost/LightGBM, plug them into the same pipeline: the calibrate/threshold/batch jobs remain identical; only the training + inference modules change.

---

### Implementation Checklist

- [x] `model:calibrate` emits threshold-scan report
- [x] `model:thresholds` CLI with constraint solving
- [x] Config auto-update command + changelog hook
- [x] CI guardrail job (calibrate → threshold → batch)
- [x] Heuristic definitions moved to config/KV
- [ ] Analytics job updating heuristics/watchlists
- [ ] FN warehouse & pattern breakdowns
- [ ] Dashboard widgets for calibration + heuristics
- [x] Auto-publish commands once guardrails pass

Each box can be tackled in isolation; prioritize Phase 1 + Phase 2 to eliminate manual tweaks, then build the feedback loop to keep accuracy within SLO automatically.
