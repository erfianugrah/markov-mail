# Calibration

## Current Status (2025‑11‑30)

Random Forest models are now **calibrated with Platt scaling** on a held-out validation split. The training command captures the logistic coefficients and embeds them in the model metadata so the Worker can convert raw forest votes into well-behaved probabilities before applying the warn/block thresholds.

## Workflow

1. **Train the forest**

   ```bash
   npm run cli model:train -- \
     --dataset data/features/export.csv \
     --output config/production/random-forest-balanced.2025-12-01.json
   ```

   - If you skip `--no-split`, the trainer automatically reserves 20% of the data for validation, exports `data/calibration/latest.csv`, and fits a `LogisticRegression` model over the raw scores.
   - The resulting intercept/coef plus sample count are stored under `meta.calibration`.

2. **(Optional) Refit / audit calibration**

   Use the CLI command when you want to re-run calibration on a different dataset or audit the current fit:

   ```bash
   npm run cli -- model:calibrate -- \
     --input data/calibration/latest.csv \
     --output data/calibration/calibrated.csv
   ```

   Behind the scenes this shells into `scripts/calibrate_scores.py`, logs the intercept/coef, and writes an additional `calibrated_score` column for plotting ROC / PR curves.

3. **Runtime usage**

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
