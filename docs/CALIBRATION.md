# Calibration

## Current Status (2026‑02‑23)

Random Forest models are now **calibrated with Platt scaling** using unbiased predictions. The training command captures the logistic coefficients and embeds them in the model metadata so the Worker can convert raw forest votes into well-behaved probabilities before applying the warn/block thresholds.

**Key improvement (v3.1)**: When training with `--no-split` (production mode), calibration now uses **out-of-bag (OOB) predictions** instead of training predictions. Each sample's OOB score comes only from trees that did NOT see it during bootstrap, preventing the overconfident sigmoid that Platt-on-training-data produces.

## Workflow

1. **Train the forest**

   ```bash
   npm run cli model:train -- \
     --dataset data/features/export.csv \
     --output config/production/random-forest-balanced.2025-12-01.json
   ```

   - If you skip `--no-split`, the trainer reserves 20% for validation, exports `data/calibration/latest.csv`, and fits Platt scaling on the held-out test scores.
   - With `--no-split` (production mode), the trainer uses **OOB predictions** (`oob_score=True`, `bootstrap=True`) for unbiased calibration. Each sample's score comes only from trees that didn't see it during training.
   - The resulting intercept/coef plus sample count are stored under `meta.calibration`.

2. **(Optional) Refit / audit calibration**

   Use the CLI command when you want to re-run calibration on a different dataset or audit the current fit:

   ```bash
   npm run cli -- model:calibrate -- \
     --input data/calibration/latest.csv \
     --output data/calibration/calibrated.csv
     --threshold-output data/calibration/threshold-scan.json
   ```

   Behind the scenes this shells into `scripts/calibrate_scores.py`, logs the intercept/coef, and writes an additional `calibrated_score` column for plotting ROC / PR curves.

   The command now also emits a threshold sweep (defaults shown below) covering warn/block candidates from 0.05 → 0.95 in 0.05 increments. You get both JSON and CSV artifacts:

   - `data/calibration/threshold-scan.json`
   - `data/calibration/threshold-scan.csv`

   Example JSON entry (one per threshold):

   ```json
   {
     "threshold": 0.75,
     "tp": 612,
     "fp": 41,
     "tn": 931,
     "fn": 67,
     "precision": 0.9372,
     "recall": 0.9014,
     "fpr": 0.0426,
     "fnr": 0.0986,
     "support_positive": 679,
     "support_negative": 972
   }
   ```

   Use `--threshold-output` (alias `--threshold-json`) or `--threshold-csv` to change file locations, and `--threshold-min`, `--threshold-max`, or `--threshold-step` if you want different bounds or granularity.

3. **Pick thresholds automatically**

   ```bash
   npm run cli -- model:thresholds -- \
     --input data/calibration/threshold-scan.json \
     --output data/calibration/threshold-recommendation.json \
     --min-recall 0.95 \
     --max-fpr 0.05 \
     --max-fnr 0.05
   ```

   This command ingests the scan JSON/CSV, filters thresholds that meet your constraints, and stores the recommended warn/block pair (plus supporting metrics) under `data/calibration/threshold-recommendation.json`. Adjust `--min-gap` if you need a larger separation between warn and block (default: `0.01`).

4. **Apply thresholds to configs**

   ```bash
   npm run cli -- config:update-thresholds [--dry-run]
   ```

   By default this reads `data/calibration/threshold-recommendation.json`, patches both `config/production/config.json` and `src/config/defaults.ts`, and logs the change inside `CHANGELOG.md`. Pass `--dry-run` if you only want to preview the edits, or provide `--warn/--block` to override the recommendation file.

5. **Guardrail / CI automation**

   Automate the whole loop (calibrate → thresholds → verification) with:

   ```bash
   npm run guardrail
   ```

   This shortcut expands to `model:guardrail` with the default dataset/scan/recommendation paths and the current SLO (`recall ≥ 0.95`, `FPR/FNR ≤ 0.05`). Use the CLI form directly if you need to customize arguments (e.g., different files or stricter gaps). The guardrail command reruns calibration (unless `--skip-calibrate` is passed), regenerates the recommendation, and fails if the resulting thresholds violate your constraints—perfect for CI guardrails before `config:update-thresholds`.  
   See [THRESHOLD_ARTIFACTS.md](./THRESHOLD_ARTIFACTS.md) for the review playbook and snapshot checklist.

6. **Runtime usage**

   `src/models/random-forest.ts` inspects `meta.calibration` and applies:

   ```
   calibrated = 1 / (1 + exp(-(intercept + coef * raw_score)))
   ```

   before the middleware compares the score with the warn/block thresholds.

## Why Platt Scaling?

* Raw Random Forest votes tend to be **over-confident** around the extremes when the dataset mixes deterministic (disposable domains) and highly ambiguous (conflict-zone) examples.
* Platt scaling is cheap (single logistic regression) and stable even for KV-sized models.
* Storing the coefficients in metadata keeps the Worker hot‑swappable—no need to regenerate every tree leaf when recalibrating.

## When to Recalibrate

Re-run the calibration step whenever:

* The class balance shifts (e.g., new synthetic mixes or real-world drift).
* You introduce new detectors/features that change the score distribution.
* Precision/recall targets move and you need updated ROC sweeps to choose thresholds.

Always update `CHANGELOG.md` with the new intercept, coefficient, date, and dataset used for calibration so operators can trace live behavior.
