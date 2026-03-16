# Tuning Guide

How to improve your model's accuracy after deployment. No code changes required — everything is done from the dashboard or admin API.

## The Feedback Loop

Markov Mail improves through a cycle:

```
Live traffic → Model scores emails → You correct mistakes → Model retrains → Better scores
```

The key insight: **the model trains on its own decisions by default**. If it blocks a legitimate email, it labels that email as "fraud" in the training data, and the retrained model learns to block it again. Human corrections break this cycle.

## Step 1: Review Misclassifications (5 minutes/day)

Open the **Review Queue** panel in the dashboard. It shows three tabs:

- **Likely FPs** — Emails that were blocked/warned but look legitimate (low entropy, non-disposable domains). These are your highest-priority corrections.
- **Likely FNs** — Emails that were allowed but have suspicious signals. Less common but important.
- **Uncertain** — Emails near the decision boundary where the model is least confident. Corrections here have the highest training impact.

For each email, hover and click **Legit** or **Fraud**. Each correction gets 5x weight in the next training run.

**Target: 10-20 corrections per day** is enough to significantly improve accuracy within a week.

## Step 2: Adjust Thresholds (as needed)

Open the **Threshold Tuner** panel in the dashboard:

1. Drag the **Warn** slider to set where "allow" transitions to "warn"
2. Drag the **Block** slider to set where "warn" transitions to "block"
3. Click **Preview Impact** to see how many recent validations would change decision
4. If the impact looks right, click **Apply**

**Guidelines:**

| Goal | Action |
|------|--------|
| Too many false positives (legit emails blocked) | Raise the block threshold (e.g., 0.88 → 0.92) |
| Too many false negatives (fraud emails allowed) | Lower the block threshold (e.g., 0.88 → 0.80) |
| Want a larger "review" zone | Widen the gap between warn and block |
| Want binary allow/block decisions | Set warn very close to block |

**Typical ranges:**
- Conservative (minimize FPs): warn=0.60, block=0.92
- Balanced (default): warn=0.56, block=0.88
- Aggressive (minimize FNs): warn=0.40, block=0.75

## Step 3: Retrain the Model (weekly or after corrections)

After accumulating label corrections, retrain:

1. Open the **Training Panel** in the dashboard
2. Verify the dataset has enough samples (minimum 100, ideally 1000+)
3. Click **Train Now**
4. Wait 3-10 seconds for the result

**If training succeeds:** The new model is automatically deployed. The dashboard will show the new model version.

**If guardrails reject the model:** The error message will explain why and suggest next steps:
- "No threshold pair satisfies constraints" → Correct more labels to improve data quality, or the data is too noisy for the current guardrail settings
- "Calibration" errors → Need more diverse labels (both FPs and FNs)
- "Model size" errors → The model is too large for KV; reduce tree count

## Step 4: Monitor for Drift

The **Review Queue** shows a drift alert banner when:
- Block rate > 70% — model may be too aggressive
- Block rate < 20% — model may be too permissive

The **Model Comparison** chart shows performance across model versions so you can spot regressions.

**Weekly check:** Is the block rate stable? Is the average risk score drifting up or down? If either changes significantly, review the queue and retrain.

## Quick Recipes

### "I'm blocking too many legitimate signups"

1. Go to Review Queue → Likely FPs tab
2. Correct 20-30 obviously-legitimate emails as "Legit"
3. Click Train Now in the Training Panel
4. If still too aggressive, raise the block threshold in the Threshold Tuner

### "Spam/fraud is getting through"

1. Go to Review Queue → Likely FNs tab
2. Correct 20-30 obviously-fraudulent emails as "Fraud"
3. Click Train Now
4. If still too permissive, lower the block threshold

### "I want to test changes safely"

1. Set `actionOverride: "allow"` in the config (via PATCH /admin/config or the API)
2. All emails will be allowed, but scores and decisions are still logged
3. Review the dashboard to see what would have been blocked
4. When satisfied, remove the override to enforce decisions

### "Model retrained but performance got worse"

1. Check Model Comparison — is the new version worse across the board?
2. The old model is still in KV history. Redeploy the previous version:
   ```bash
   npx wrangler kv key put random_forest.json \
     --path config/production/random-forest.json \
     --namespace-id "$CONFIG_ID" --remote
   curl -X DELETE https://your-worker.dev/admin/cache/models -H "X-API-Key: KEY"
   ```
3. Correct more labels before retraining again

## How Corrections Improve the Model

When you click "Actually legit" on a blocked email:

1. The email's hash is looked up in `training_samples`
2. Its label is changed from `1` (fraud) to `0` (legit)
3. Its `label_source` is set to `manual`
4. On the next retrain, this sample gets **5x weight** in the loss function
5. The model learns: "emails like this should not be blocked"

After ~50-100 corrections and a retrain, the false positive rate typically drops by 30-50%.

## See Also

- [Configuration Guide](./CONFIGURATION.md) — all config fields and admin endpoints
- [Scoring Engine](./SCORING.md) — how scores are computed
- [Model Training](./MODEL_TRAINING.md) — training pipeline reference
- [Troubleshooting](./TROUBLESHOOTING.md) — common issues
