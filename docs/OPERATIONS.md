# Operations Guide

**Version**: 3.0.1
**Last Updated**: 2025-12-01

Complete operations guide for the Markov Mail fraud detection system, including training pipelines, deployments, monitoring, and troubleshooting.

## Table of Contents

- [Automated Training Pipeline](#automated-training-pipeline)
- [Production Deployment](#production-deployment)
- [Configuration Management](#configuration-management)
- [Monitoring and Validation](#monitoring-and-validation)
- [Troubleshooting](#troubleshooting)

## Automated Training Pipeline

### Full Automation Workflow

Complete end-to-end automation flow for training, deploying, and validating the fraud detection system.

#### Step 1: Prep and Safety Checks

Type safety gate (CI parity):
```bash
npm run typecheck
```

Optional lint/unit sweeps before touching data:
```bash
npm run test:unit
npm run test:e2e
```

#### Step 2: Automated Training with Threshold Sync

Strict guardrail with MX features and adaptive search:
```bash
npm run pipeline -- \
  --dataset data/main.csv \
  --export-modes full \
  --search '[{"label":"mx-forest-150","nTrees":150,"maxDepth":7,"featureMode":"full"}]' \
  --adaptive '{"maxTrees":350,"maxDepth":10,"maxConflictWeight":70,"nTreesStep":25,"conflictStep":5}' \
  --min-recall 0.90 \
  --max-fpr 0.05 \
  --max-fnr 0.05 \
  --calibration-retries 2 \
  --retry-threshold-step 0.02 \
  --upload-model \
  --apply-thresholds \
  --sync-config
```

**Pipeline Stages**:
1. Feature export with MX pre-fetch
2. Model training with adaptive hyperparameter search
3. Platt calibration for probability scores
4. Threshold optimization to meet guardrails
5. Model upload to KV
6. Config sync with thresholds

**Resume Failed Runs**:
```bash
# Resume from specific manifest
npm run pipeline -- --resume tmp/pipeline-runs/2025-12-01-08-52-20

# Resume latest run
npm run pipeline -- --resume latest
```

#### Step 3: Generate Fresh Validation Set

```bash
npm run cli -- data:synthetic -- \
  --count 20000 \
  --output data/synthetic-latest.csv \
  --legit-ratio 0.7
```

#### Step 4: Local Smoke Test

1. Fix Wrangler log permissions (if needed):
```bash
mkdir -p ~/.config/.wrangler/logs
chmod -R u+rw ~/.config/.wrangler
```

2. Run worker locally (new terminal):
```bash
npm run dev -- --local
```

3. Test with synthetic set:
```bash
npm run cli -- test:batch -- \
  --input data/synthetic-latest.csv \
  --threshold-warn 0.3 \
  --threshold-block 0.35 \
  --endpoint http://127.0.0.1:8787/validate
```

Stop `npm run dev` afterwards.

#### Step 5: Production Validation

```bash
npm run cli -- test:batch -- \
  --input data/synthetic-training.csv \
  --threshold-warn 0.3 \
  --threshold-block 0.35 \
  --endpoint https://fraud.erfi.dev/validate \
  --concurrency 25
```

Reports land in `/tmp/batch-test-results-<timestamp>.{json,html,txt}`.

## Production Deployment

### Pre-Deployment Checklist

- [ ] Training metrics meet guardrails (≥90% recall, ≤5% FPR, ≤5% FNR)
- [ ] Local smoke tests pass
- [ ] Production validation shows metrics within ±5% of training
- [ ] Config changes reviewed
- [ ] Rollback plan documented

### Deployment Process

The automated pipeline handles deployment when `--upload-model` and `--sync-config` are specified:

1. **Model Upload**: Uploads trained model to KV (`random_forest.json`)
2. **Config Sync**: Updates `config.json` with new thresholds
3. **Risk Heuristics**: Syncs `risk-heuristics.json` if changed

### Manual Deployment

If manual deployment is needed:

```bash
# Upload model
wrangler kv key put random_forest.json \
  --namespace-id e24fcc002bc64157a1940650c348d335 \
  --path config/production/random-forest.auto.json \
  --remote

# Upload config
wrangler kv key put config.json \
  --namespace-id e24fcc002bc64157a1940650c348d335 \
  --path config/production/config.json \
  --remote

# Upload risk heuristics
wrangler kv key put risk-heuristics.json \
  --namespace-id e24fcc002bc64157a1940650c348d335 \
  --path config/production/risk-heuristics.json \
  --remote
```

### Rollback Procedure

1. Retrieve previous model version:
```bash
# List available backups
ls -lt config/production/random-forest.*.json | head -5

# Upload previous version
wrangler kv key put random_forest.json \
  --namespace-id e24fcc002bc64157a1940650c348d335 \
  --path config/production/random-forest.2025-11-30.json \
  --remote
```

2. Restore previous config:
```bash
git log config/production/config.json
git show <commit-hash>:config/production/config.json > /tmp/previous-config.json
wrangler kv key put config.json \
  --namespace-id e24fcc002bc64157a1940650c348d335 \
  --path /tmp/previous-config.json \
  --remote
```

## Configuration Management

### KV Namespace IDs

- **CONFIG**: `e24fcc002bc64157a1940650c348d335`
- **DISPOSABLE_DOMAINS_LIST**: `6bb73f48f9804c888f5ce9406d3bf3d6`
- **TLD_LIST**: `30a4c2d7396c44d5aab003b05fd95742`

### Remote State Verification

#### Verify Random Forest Model

```bash
wrangler kv key get random_forest.json \
  --namespace-id e24fcc002bc64157a1940650c348d335 \
  --remote > /tmp/remote-random-forest.json

shasum -a 256 /tmp/remote-random-forest.json \
  config/production/random-forest.auto.json
```

#### Verify Config and Risk Thresholds

```bash
wrangler kv key get config.json \
  --namespace-id e24fcc002bc64157a1940650c348d335 \
  --remote | jq '.riskThresholds'
```

#### Verify Risk Heuristics

```bash
wrangler kv key get risk-heuristics.json \
  --namespace-id e24fcc002bc64157a1940650c348d335 \
  --remote | jq '.'
```

#### List All Keys in CONFIG

```bash
wrangler kv key list \
  --namespace-id e24fcc002bc64157a1940650c348d335 \
  --remote | grep -E 'random_forest\.json|config\.json'
```

### Configuration Updates

#### Update Risk Thresholds

```bash
npm run cli -- config:update-thresholds -- \
  --warn 0.35 \
  --block 0.45 \
  --remote
```

#### Update Risk Heuristics

1. Edit `config/production/risk-heuristics.json`
2. Upload to KV:
```bash
wrangler kv key put risk-heuristics.json \
  --namespace-id e24fcc002bc64157a1940650c348d335 \
  --path config/production/risk-heuristics.json \
  --remote
```

## Monitoring and Validation

### Real-Time Monitoring

#### Analytics Dashboard

Access at: https://fraud.erfi.dev/dashboard

**Metrics Available**:
- Total validations
- Block rate
- Average latency
- Error rate
- Block reasons distribution
- Hourly trends

#### D1 Analytics Queries

```bash
# Fraud rate over last 7 days
wrangler d1 execute DB --remote --command="
  SELECT DATE(timestamp) as day,
         COUNT(*) as total,
         SUM(CASE WHEN decision='block' THEN 1 ELSE 0 END) as blocked,
         ROUND(100.0 * SUM(CASE WHEN decision='block' THEN 1 ELSE 0 END) / COUNT(*), 2) as block_rate
  FROM validations
  WHERE timestamp >= datetime('now', '-7 days')
  GROUP BY day
  ORDER BY day DESC
"

# Top block reasons
wrangler d1 execute DB --remote --command="
  SELECT reason,
         COUNT(*) as count,
         ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM validations WHERE decision='block'), 2) as pct
  FROM validations
  WHERE decision='block'
    AND timestamp >= datetime('now', '-24 hours')
  GROUP BY reason
  ORDER BY count DESC
  LIMIT 10
"

# Latency percentiles
wrangler d1 execute DB --remote --command="
  WITH ranked AS (
    SELECT latency,
           ROW_NUMBER() OVER (ORDER BY latency) as row_num,
           COUNT(*) OVER () as total_count
    FROM validations
    WHERE timestamp >= datetime('now', '-1 hour')
  )
  SELECT
    (SELECT latency FROM ranked WHERE row_num = CAST(0.50 * total_count AS INTEGER) LIMIT 1) as p50,
    (SELECT latency FROM ranked WHERE row_num = CAST(0.95 * total_count AS INTEGER) LIMIT 1) as p95,
    (SELECT latency FROM ranked WHERE row_num = CAST(0.99 * total_count AS INTEGER) LIMIT 1) as p99
  FROM ranked
  LIMIT 1
"
```

### Batch Validation

#### Test Production API

```bash
# Single email test
npm run cli test:api user@example.com --debug

# Batch test with synthetic data
npm run cli -- test:batch -- \
  --input data/synthetic-validation.csv \
  --endpoint https://fraud.erfi.dev/validate \
  --concurrency 25

# Test with specific thresholds
npm run cli -- test:batch -- \
  --input data/test-cases.csv \
  --threshold-warn 0.3 \
  --threshold-block 0.35 \
  --endpoint https://fraud.erfi.dev/validate
```

#### Interpret Batch Test Results

Results are saved in `/tmp/batch-test-results-<timestamp>.*`:

- **JSON**: Raw results with full metrics and samples
- **TXT**: Human-readable report with confusion matrix
- **HTML**: Visual report with charts (if generated)

**Key Metrics**:
- **Accuracy**: Overall correct classifications
- **Precision**: When flagged as fraud, how often correct
- **Recall**: Percentage of fraud caught
- **F1 Score**: Balanced precision/recall metric
- **FPR**: False positive rate (legit emails wrongly blocked)
- **FNR**: False negative rate (fraud that slipped through)

## Troubleshooting

### Common Issues

#### Training Metrics Don't Match Production

**Symptoms**: Training shows 95% recall, production shows 77% recall

**Likely Causes**:
1. Feature extraction mismatch (MX lookups timing out)
2. Training data doesn't match production distribution
3. Config not synced after training

**Solutions**:
1. Check MX lookup success rate in production logs
2. Validate with same dataset used for training
3. Verify KV config matches local config files

See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for detailed diagnosis.

#### Model Not Loading

**Symptoms**: Errors about missing or invalid model

**Check**:
```bash
# Verify model exists in KV
wrangler kv key get random_forest.json \
  --namespace-id e24fcc002bc64157a1940650c348d335 \
  --remote | jq '.meta.version'

# Check model size (should be <1MB)
wrangler kv key get random_forest.json \
  --namespace-id e24fcc002bc64157a1940650c348d335 \
  --remote | wc -c
```

#### High False Positive Rate

**Symptoms**: Legit emails being blocked

**Investigation**:
1. Check false positive samples from batch test
2. Analyze feature distributions for misclassified emails
3. Review risk heuristics for overly aggressive rules

**Fixes**:
- Increase block threshold
- Adjust risk heuristic weights
- Retrain with more diverse legitimate data

#### High False Negative Rate

**Symptoms**: Fraud emails passing through

**Investigation**:
1. Check false negative samples from batch test
2. Identify common patterns in missed fraud
3. Review feature importance for fraud detection

**Fixes**:
- Decrease block threshold
- Add targeted heuristics for missed patterns
- Retrain with more fraud pattern variety

### Emergency Procedures

#### Circuit Breaker Activation

If production is blocking too many legitimate emails:

1. **Immediate**: Raise block threshold
```bash
npm run cli -- config:update-thresholds -- \
  --block 0.9 \
  --remote
```

2. **Next**: Investigate root cause
3. **Then**: Fix and gradually lower threshold

#### Data Loss Prevention

All pipeline runs save manifests to `tmp/pipeline-runs/`:
- Feature export CSVs
- Training logs
- Model artifacts
- Validation results

**Backup Critical Data**:
```bash
# Backup current production model
wrangler kv key get random_forest.json \
  --namespace-id e24fcc002bc64157a1940650c348d335 \
  --remote > backups/random-forest.$(date +%F).json

# Backup config
wrangler kv key get config.json \
  --namespace-id e24fcc002bc64157a1940650c348d335 \
  --remote > backups/config.$(date +%F).json
```

## Best Practices

### Training Pipeline

1. **Always use guardrails**: Set `--min-recall`, `--max-fpr`, `--max-fnr`
2. **Test locally first**: Smoke test before production deployment
3. **Document changes**: Update CHANGELOG.md with model versions
4. **Archive manifests**: Keep pipeline run data for troubleshooting

### Deployment

1. **Deploy during low-traffic**: Off-peak hours minimize impact
2. **Monitor closely**: Watch dashboard for 30 minutes post-deployment
3. **Have rollback ready**: Keep previous model version accessible
4. **Validate first**: Production metrics should match training within ±5%

### Monitoring

1. **Set up alerts**: D1 queries for anomalies (high block rate, latency spikes)
2. **Review weekly**: Check false positive/negative samples
3. **Track trends**: Monitor block rate, latency over time
4. **Audit heuristics**: Review risk heuristic contributions monthly

### Data Hygiene

1. **Never commit PII**: Data files are .gitignored
2. **Clean synthetic data**: Remove unrealistic patterns
3. **Balance datasets**: Maintain representative fraud/legit ratios
4. **Version datasets**: Track data lineage for reproducibility

## Reference

### Pipeline Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `--dataset` | Input CSV path | `data/main.csv` |
| `--export-modes` | Feature modes (fast, full) | `full` |
| `--search` | Model search space (JSON array) | Required |
| `--adaptive` | Adaptive search config | Optional |
| `--min-recall` | Minimum recall threshold | `0.90` |
| `--max-fpr` | Maximum false positive rate | `0.05` |
| `--max-fnr` | Maximum false negative rate | `0.05` |
| `--calibration-retries` | Calibration retry attempts | `2` |
| `--retry-threshold-step` | Threshold adjustment step | `0.02` |
| `--upload-model` | Upload model to KV | `false` |
| `--apply-thresholds` | Apply optimized thresholds | `false` |
| `--sync-config` | Sync config.json to KV | `false` |
| `--resume` | Resume from manifest | Optional |

### Wrangler Commands

See [CONFIGURATION.md](./CONFIGURATION.md) for complete wrangler reference.

**Important**: Use `--namespace-id` with `--remote` flag for production KV access. The `--binding` flag only works within worker context.

### CLI Commands

See output of `npm run cli` for complete command list.

---

**Last Updated**: 2025-12-01
**Version**: 3.0.1
