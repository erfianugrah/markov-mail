# Threshold Artifact Playbook

When you run `npm run guardrail` (or the underlying `model:guardrail` CLI), the calibration pipeline emits three key artifacts under `data/calibration/`. Treat these files as the source of truth for audit/review:

| File | Purpose |
|------|---------|
| `calibrated.guardrail.csv` (or the `--output` you passed) | Raw scores + labels from the holdout set after Platt scaling |
| `threshold-scan.json` / `.csv` | Threshold sweep (0.05 → 0.95) with TP/FP/TN/FN, precision, recall, FPR, FNR |
| `threshold-recommendation.json` | Recommended warn/block cutoffs that satisfy the configured constraints |

## Capture Checklist

1. **Regenerate artifacts**  
   ```bash
   npm run guardrail
   ```

2. **Snapshot for review**  
   Let the CLI copy the artifacts (with optional overrides) into `tmp/threshold-artifacts/<timestamp>/`:
   ```bash
   npm run cli -- artifacts:snapshot
   # or specify output / custom file locations:
   # npm run cli -- artifacts:snapshot --output tmp/threshold-artifacts/2025-12-01 \
   #   --scan-json data/calibration/custom-threshold-scan.json
   ```

3. **Attach to PR / share in review**  
   - Upload the snapshot directory as a build artifact (CI) or drag/drop into the PR discussion.  
   - Mention the guardrail command you ran and any non-default flags.

## Quick Inspection Tips

Inspect the recommendation:
```bash
cat data/calibration/threshold-recommendation.json | jq '.'
```

View top thresholds in the scan:
```bash
jq '.thresholds[:5]' data/calibration/threshold-scan.json
```

Plotting? Import the CSV into your plotting tool of choice or run:
```bash
python - <<'PY'
import pandas as pd
df = pd.read_csv("data/calibration/threshold-scan.csv")
print(df[['threshold','recall','fpr','fnr']].head())
PY
```

## When to Regenerate
- Any new model training run
- Threshold changes (warn/block SLO updates)
- Before promoting a model/config to production
- Whenever the guardrail job fails (grab the failing artifacts for debugging)

Keeping these artifacts with your PR/release notes gives reviewers the hard evidence they need to sign off on threshold updates.
