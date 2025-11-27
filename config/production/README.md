# Production Configuration

This directory contains the production-ready configuration and trained calibration model used by Markov Mail.

## Files

### `calibration.json`
**Trained logistic regression model with 28 features**

- **Version**: `calibration_20251127122354673`
- **Training Dataset**: 89,352 emails (legitimate + fraudulent)
- **Accuracy**: 83.5%
- **Precision**: 80.9%
- **Recall**: 84.0%
- **F1 Score**: 82.4%

**Production Performance** (99-email validation):
- **Recall**: 100% (caught all fraud)
- **Precision**: 96% (only 2 false positives)
- **F1 Score**: 97.96%

**Features** (28 total):
- **Markov Chain** (8): Cross-entropy scores from 2-gram and 3-gram models
- **Linguistic** (6): pronounceability, vowel_ratio, max_consonant_cluster, impossible_cluster_count, syllable_estimate, repeated_char_ratio
- **Structure** (4): has_word_boundaries, segment_count, avg_segment_length, segments_without_vowels_ratio
- **Statistical** (3): unique_char_ratio, vowel_gap_ratio, max_digit_run
- **Other** (7): sequential_confidence, plus_risk, local_length, digit_ratio, provider flags, tld_risk, abnormality_risk

### `config.json`
**Production KV configuration**

Complete runtime configuration including:
- Risk thresholds (block: 0.6, warn: 0.3)
- Base risk scores for hard blockers
- Confidence thresholds for detectors
- Feature flags (all detectors enabled)
- Pattern thresholds (sequential, dated, plus-addressing)
- **Calibration coefficients** (embedded from `calibration.json`)

### Markov Chain Models
**Pre-trained n-gram models (92K emails)**

Four model files trained on production data:
- `markov_fraud_2gram.json` (1.0M) - 2-gram fraud patterns
- `markov_fraud_3gram.json` (2.9M) - 3-gram fraud patterns
- `markov_legit_2gram.json` (1.2M) - 2-gram legitimate patterns
- `markov_legit_3gram.json` (2.6M) - 3-gram legitimate patterns

These models power the core Markov Chain detection system that generates the cross-entropy features used by the calibration layer.

## Usage

### Option 1: Upload to Cloudflare KV (Recommended)

```bash
# 1. Upload config to your CONFIG KV namespace
npx wrangler kv key put config.json \
  --path=config/production/config.json \
  --binding=CONFIG \
  --remote

# 2. Upload Markov Chain models to your MODELS KV namespace
npx wrangler kv key put markov_fraud_2gram \
  --path=config/production/markov_fraud_2gram.json \
  --binding=MODELS \
  --remote

npx wrangler kv key put markov_fraud_3gram \
  --path=config/production/markov_fraud_3gram.json \
  --binding=MODELS \
  --remote

npx wrangler kv key put markov_legit_2gram \
  --path=config/production/markov_legit_2gram.json \
  --binding=MODELS \
  --remote

npx wrangler kv key put markov_legit_3gram \
  --path=config/production/markov_legit_3gram.json \
  --binding=MODELS \
  --remote
```

The worker will automatically load the configuration (including calibration) and models from KV on startup.

### Option 2: Use in Training/Testing

```bash
# Use the calibration model for local testing
npm run cli -- test:batch \
  --input your-test-data.csv \
  --calibration config/production/calibration.json
```

### Option 3: Train Your Own

If you have your own dataset, you can retrain:

```bash
npm run cli -- train:calibrate \
  --dataset your-training-data.csv \
  --models models \
  --output new-calibration.json
```

## Notes

- **No PII**: These files contain only model coefficients, transition probabilities, and thresholds - no personal data
- **Pre-trained**: This is the exact calibration model and Markov models tested in production with 97.96% F1 score
- **Ready to Use**: Upload to KV and the worker will use them immediately (after 60s cache expiration)
- **Customizable**: Adjust thresholds in `config.json` to tune false positive vs false negative tradeoff
- **Total Size**: ~8MB (4 model files + config + calibration)

## Performance Tuning

If you're getting too many false positives, increase the block threshold:
```json
{
  "riskThresholds": {
    "block": 0.7,  // Was 0.6, increase to reduce false positives
    "warn": 0.4     // Was 0.3
  }
}
```

If you're missing fraud (false negatives), decrease the threshold:
```json
{
  "riskThresholds": {
    "block": 0.5,  // Was 0.6, decrease to catch more fraud
    "warn": 0.25    // Was 0.3
  }
}
```

## Support

For questions or issues, see the main documentation in `docs/`.
