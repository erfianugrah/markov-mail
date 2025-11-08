#!/bin/bash
# Export D1 data in batches

BATCH_SIZE=10000
OUTPUT_DIR="data/exports"
mkdir -p "$OUTPUT_DIR"

echo "📥 Exporting validation records in batches of $BATCH_SIZE..."

# Export batch 1 (most recent 10k)
echo "Batch 1/13 (0-10k)..."
npx wrangler d1 execute ANALYTICS --remote --json \
  --command "SELECT email_local_part, domain, decision, risk_score, pattern_type, pattern_family, markov_detected, markov_confidence, is_disposable, pattern_classification_version FROM validations ORDER BY timestamp DESC LIMIT $BATCH_SIZE OFFSET 0" \
  > "$OUTPUT_DIR/batch_1.json"

# Export batch 2
echo "Batch 2/13 (10k-20k)..."
npx wrangler d1 execute ANALYTICS --remote --json \
  --command "SELECT email_local_part, domain, decision, risk_score, pattern_type, pattern_family, markov_detected, markov_confidence, is_disposable, pattern_classification_version FROM validations ORDER BY timestamp DESC LIMIT $BATCH_SIZE OFFSET 10000" \
  > "$OUTPUT_DIR/batch_2.json"

# Export batch 3
echo "Batch 3/13 (20k-30k)..."
npx wrangler d1 execute ANALYTICS --remote --json \
  --command "SELECT email_local_part, domain, decision, risk_score, pattern_type, pattern_family, markov_detected, markov_confidence, is_disposable, pattern_classification_version FROM validations ORDER BY timestamp DESC LIMIT $BATCH_SIZE OFFSET 20000" \
  > "$OUTPUT_DIR/batch_3.json"

# Export batch 4
echo "Batch 4/13 (30k-40k)..."
npx wrangler d1 execute ANALYTICS --remote --json \
  --command "SELECT email_local_part, domain, decision, risk_score, pattern_type, pattern_family, markov_detected, markov_confidence, is_disposable, pattern_classification_version FROM validations ORDER BY timestamp DESC LIMIT $BATCH_SIZE OFFSET 30000" \
  > "$OUTPUT_DIR/batch_4.json"

# Export batch 5
echo "Batch 5/13 (40k-50k)..."
npx wrangler d1 execute ANALYTICS --remote --json \
  --command "SELECT email_local_part, domain, decision, risk_score, pattern_type, pattern_family, markov_detected, markov_confidence, is_disposable, pattern_classification_version FROM validations ORDER BY timestamp DESC LIMIT $BATCH_SIZE OFFSET 40000" \
  > "$OUTPUT_DIR/batch_5.json"

echo "✅ Exported 5 batches (50k records). Run again with higher offsets for more."
echo "Total files: $(ls -1 $OUTPUT_DIR/batch_*.json | wc -l)"
