# Training Datasets Guide

Complete guide for preparing, formatting, and using datasets to train fraud detection models.

## Table of Contents

1. [Understanding Training Data](#understanding-training-data)
2. [Dataset Requirements](#dataset-requirements)
3. [CSV Format Specification](#csv-format-specification)
4. [Collecting Training Data](#collecting-training-data)
5. [Dataset Quality](#dataset-quality)
6. [Training Models](#training-models)
7. [Sample Datasets](#sample-datasets)
8. [Troubleshooting](#troubleshooting)

---

## Understanding Training Data

### What Gets Trained?

This system trains **Markov Chain models** that learn character transition patterns in email addresses.

**Example patterns learned:**
- Legitimate: `john.smith@` → Common name patterns
- Fraudulent: `user123@` → Sequential number patterns
- Legitimate: `alice.j@` → Natural abbreviations
- Fraudulent: `xkqw9@` → Random character sequences

### Why Two Models?

We train TWO separate models:

1. **Legitimate Model** - Learns patterns from real user emails
2. **Fraudulent Model** - Learns patterns from known fake/spam emails

At runtime, the system compares an email against both models to determine which it resembles more.

### How Much Data Do I Need?

| Dataset Size | Accuracy | Recommendation |
|--------------|----------|----------------|
| < 1,000 emails | 60-70% | Not recommended |
| 1,000-10,000 | 75-85% | Minimum viable |
| 10,000-50,000 | 85-92% | Good |
| 50,000-100,000 | 92-96% | Very good |
| 100,000+ | 96-99% | Excellent |

**Recommended minimum:** 10,000 legitimate + 10,000 fraudulent emails

---

## Dataset Requirements

### Format Requirements

- **File type:** CSV (Comma-Separated Values)
- **Encoding:** UTF-8
- **Required columns:** `email` and `label`
- **Location:** `./dataset/` directory in project root

### Label Values

| Label Value | Meaning | Example |
|-------------|---------|---------|
| `legit` | Legitimate email | john.smith@company.com |
| `legitimate` | Legitimate email | alice.wonder@university.edu |
| `fraud` | Fraudulent email | user123@gmail.com |
| `fraudulent` | Fraudulent email | test456@yahoo.com |
| `spam` | Fraudulent email | xkqw9p@tempmail.com |
| `fake` | Fraudulent email | abuse001@mailinator.com |

**Case insensitive** - `LEGIT`, `Legit`, `legit` all work

### Balance Requirements

For best results, maintain balanced datasets:

```
Legitimate emails: ~50% of dataset
Fraudulent emails: ~50% of dataset
```

**Example:**
- ✅ Good: 50,000 legit + 50,000 fraud
- ⚠️ Acceptable: 40,000 legit + 60,000 fraud
- ❌ Poor: 10,000 legit + 90,000 fraud (heavily imbalanced)

---

## CSV Format Specification

### Minimum Required Format

```csv
email,label
john.doe@example.com,legit
user123@gmail.com,fraud
alice.wonder@company.com,legit
test456@yahoo.com,fraud
```

### Extended Format (Additional Columns Ignored)

```csv
email,label,timestamp,source,notes
john.doe@example.com,legit,2025-01-15,production,real user
user123@gmail.com,fraud,2025-01-16,blocked,sequential pattern
alice.wonder@company.com,legit,2025-01-17,production,legitimate signup
test456@yahoo.com,fraud,2025-01-18,flagged,sequential numbers
```

**Note:** Only `email` and `label` columns are used. Other columns are ignored.

### Header Requirements

- ✅ **Must have header row** with column names
- ✅ Column order doesn't matter (as long as headers match)
- ✅ Extra columns are OK (will be ignored)

### Valid Examples

**Example 1: Minimal**
```csv
email,label
john@example.com,legit
spam@test.com,fraud
```

**Example 2: Reversed Columns**
```csv
label,email
legit,john@example.com
fraud,spam@test.com
```

**Example 3: Extra Columns**
```csv
id,email,label,created_at
1,john@example.com,legit,2025-01-15
2,spam@test.com,fraud,2025-01-16
```

---

## Collecting Training Data

### Source 1: Production Data (Best Quality)

Extract real data from your production system:

```bash
# Export from your database (example SQL)
SELECT
  email,
  CASE
    WHEN is_verified_user THEN 'legit'
    WHEN is_blocked OR is_spam THEN 'fraud'
  END as label
FROM users
WHERE label IS NOT NULL
```

**Pros:**
- Real-world data from your actual users
- Highest accuracy for your use case
- Matches your user patterns

**Cons:**
- Requires existing production system
- Privacy considerations (hash/anonymize if needed)

### Source 2: Analytics Engine (After Deployment)

Once deployed, collect data from the worker's Analytics Engine:

```bash
# Extract validated emails
npm run cli training:extract

# Train from extracted data
npm run cli training:train

# Validate and deploy
npm run cli training:validate
```

This is **automatic online learning** - the system improves over time!

### Source 3: Manual Collection

Build datasets manually from:

**Legitimate sources:**
- Your current user database
- Employee email lists
- Public datasets (GitHub, Kaggle)
- Email verification services

**Fraudulent sources:**
- Blocked/flagged users in your system
- Spam trap emails
- Disposable email patterns
- Automated test account patterns

### Source 4: Synthetic Data (For Testing Only)

Generate test data for development:

```bash
# Generate 1,000 test emails
npm run cli test:generate --count 1000

# Output: test-dataset-YYYY-MM-DD.csv
```

**⚠️ Warning:** Synthetic data is only for testing. Don't use for production models.

---

## Dataset Quality

### Validation Tool

Check dataset quality before training:

```bash
npm run cli train:validate ./dataset
```

**Output:**
```
✅ Dataset Validation Report

Files found: 3
Total emails: 125,450

Breakdown:
  Legitimate: 62,725 (50.0%)
  Fraudulent: 62,725 (50.0%)

Quality Checks:
  ✅ Balance: Good (50/50 split)
  ✅ Duplicates: 0.2% (acceptable)
  ✅ Invalid emails: 0.1% (acceptable)
  ✅ Missing labels: 0 (perfect)

Recommendation: Ready for training
```

### Quality Criteria

| Check | Good | Acceptable | Poor |
|-------|------|------------|------|
| **Balance** | 45-55% split | 40-60% split | < 40% or > 60% |
| **Duplicates** | < 1% | 1-5% | > 5% |
| **Invalid emails** | < 0.5% | 0.5-2% | > 2% |
| **Missing labels** | 0% | 0% | > 0% |
| **Size** | > 50k | 10k-50k | < 10k |

### Common Data Issues

**Issue: Too Many Duplicates**
```bash
# Remove duplicates (keeps first occurrence)
sort -u dataset/emails.csv > dataset/emails_deduped.csv
```

**Issue: Imbalanced Dataset**
```bash
# Undersample majority class
# Keep all minority samples + random sample of majority

# Or oversample minority class
# Duplicate minority samples randomly
```

**Issue: Invalid Email Formats**
```bash
# Filter out invalid emails
# The training script automatically skips invalid formats
# Check validation report for percentage
```

**Issue: Wrong Encoding**
```bash
# Convert to UTF-8
iconv -f ISO-8859-1 -t UTF-8 input.csv > output.csv
```

---

## Training Models

### Step 1: Prepare Dataset

```bash
# Create dataset directory
mkdir -p dataset

# Copy your CSV files
cp /path/to/your/emails.csv dataset/

# Multiple files are OK - they'll be combined
cp /path/to/legit_emails.csv dataset/
cp /path/to/fraud_emails.csv dataset/
```

### Step 2: Validate Dataset

```bash
# Check dataset quality
npm run cli train:validate ./dataset

# Should show "Ready for training"
```

### Step 3: Train Models

```bash
# Train Markov Chain models
npm run cli train:markov

# Expected output:
# ✓ Loaded 125,450 emails (62,725 legit + 62,725 fraud)
# ✓ Training legitimate model...
# ✓ Training fraudulent model...
# ✓ Models saved:
#   - /tmp/models/markov_legit_2gram.json
#   - /tmp/models/markov_fraud_2gram.json
```

**Training Options:**

```bash
# Specify dataset path
npm run cli train:markov --dataset /path/to/dataset

# Different n-gram order (default: 2)
npm run cli train:markov --order 3

# Upload directly to KV after training
npm run cli train:markov --upload --remote
```

### Step 4: Upload to KV

```bash
# Upload trained models to production
npm run cli train:markov --upload --remote

# Verify upload
npm run cli kv:list --binding MARKOV_MODEL --remote

# Should show:
# - MM_legit_production
# - MM_fraud_production
```

### Step 5: Test Models

```bash
# Test with known patterns
curl -X POST https://your-worker.workers.dev/validate \
  -H "Content-Type: application/json" \
  -d '{"email":"user123@gmail.com"}' | jq .

# Check markovDetected should be true for fraudulent patterns
```

---

## Sample Datasets

### Example 1: Small Test Dataset (100 emails)

```csv
email,label
john.doe@example.com,legit
jane.smith@company.org,legit
alice.wonder@university.edu,legit
bob.johnson@email.com,legit
charlie.brown@work.com,legit
user1@gmail.com,fraud
user2@gmail.com,fraud
user3@gmail.com,fraud
test123@yahoo.com,fraud
test456@hotmail.com,fraud
xkqw9p2m@tempmail.com,fraud
zxcvbnm@test.com,fraud
asdfgh@mailinator.com,fraud
qwerty@throwaway.email,fraud
abc123@spam.com,fraud
```

Save as `dataset/sample.csv` and train:
```bash
npm run cli train:markov
```

### Example 2: Programmatically Generate Dataset

```javascript
// generate-dataset.js
const fs = require('fs');

const legitPatterns = [
  'firstname.lastname',
  'firstname_lastname',
  'firstinitial.lastname',
  'firstname',
];

const domains = ['gmail.com', 'yahoo.com', 'company.com', 'university.edu'];

const csv = ['email,label'];

// Generate 1000 legit emails
for (let i = 0; i < 1000; i++) {
  const pattern = legitPatterns[Math.floor(Math.random() * legitPatterns.length)];
  const domain = domains[Math.floor(Math.random() * domains.length)];
  const name1 = `name${i}`;
  const name2 = `surname${i}`;

  let email;
  if (pattern === 'firstname.lastname') {
    email = `${name1}.${name2}@${domain}`;
  } else if (pattern === 'firstname') {
    email = `${name1}@${domain}`;
  }

  csv.push(`${email},legit`);
}

// Generate 1000 fraud emails
for (let i = 0; i < 1000; i++) {
  const email = `user${i}@gmail.com`;
  csv.push(`${email},fraud`);
}

fs.writeFileSync('dataset/generated.csv', csv.join('\n'));
console.log('Generated 2000 emails');
```

Run:
```bash
node generate-dataset.js
npm run cli train:markov
```

### Example 3: Real-World Dataset Structure

```
dataset/
├── production_legit_2025-01.csv     (50,000 emails)
├── production_legit_2025-02.csv     (50,000 emails)
├── blocked_fraud_2025-01.csv        (45,000 emails)
├── blocked_fraud_2025-02.csv        (45,000 emails)
└── manual_review.csv                (10,000 emails)

Total: 200,000 emails
```

All CSV files are automatically discovered and combined during training.

---

## Troubleshooting

### "No dataset files found"

**Problem:** CLI can't find CSV files

**Solution:**
```bash
# Check directory
ls -la dataset/

# Ensure files have .csv extension
# Place files directly in dataset/, not in subdirectories
```

### "Imbalanced dataset warning"

**Problem:** Too many of one label type

**Solution:**
```bash
# Check balance
npm run cli train:validate ./dataset

# Undersample or oversample to balance
# Aim for 40-60% split
```

### "Loaded 0 emails"

**Problem:** CSV format not recognized

**Solution:**
```bash
# Check file format
head -5 dataset/your-file.csv

# Ensure:
# 1. Has header row with "email" and "label" columns
# 2. Comma-separated (not semicolon or tab)
# 3. UTF-8 encoding
# 4. No BOM (Byte Order Mark)
```

### "Training failed: out of memory"

**Problem:** Dataset too large for available RAM

**Solution:**
```bash
# Split dataset into smaller chunks
split -l 50000 dataset/large.csv dataset/chunk_

# Train on chunks separately, or
# Increase available memory
```

### Models Show Low Accuracy

**Problem:** Models not detecting fraud well

**Causes:**
1. **Insufficient data** - Need 10k+ emails minimum
2. **Poor quality** - Too many duplicates or invalid emails
3. **Imbalanced** - Need 40-60% split between legit/fraud
4. **Wrong labels** - Emails mislabeled in dataset

**Solution:**
```bash
# Validate dataset
npm run cli train:validate ./dataset

# Review and fix issues
# Collect more data if needed
# Relabel incorrect samples
```

### "Cannot upload to KV: namespace not found"

**Problem:** MARKOV_MODEL namespace not configured

**Solution:**
```bash
# Create namespace
npx wrangler kv namespace create MARKOV_MODEL

# Update wrangler.jsonc with namespace ID
# See CLOUDFLARE_SETUP.md
```

---

## Best Practices

1. **Start Small, Grow Over Time**
   - Begin with 10k emails
   - Add more as you collect production data
   - Retrain monthly

2. **Validate Before Training**
   - Always run `train:validate` first
   - Fix quality issues before training
   - Save time and improve accuracy

3. **Keep Datasets Balanced**
   - Aim for 50/50 legit/fraud split
   - Acceptable range: 40/60 to 60/40
   - Prevents model bias

4. **Use Real Data When Possible**
   - Production data > Synthetic data
   - Real patterns > Generated patterns
   - Your users > Generic datasets

5. **Version Your Datasets**
   - Name files with dates: `emails_2025-01.csv`
   - Keep training history
   - Track model improvements

6. **Privacy and Security**
   - Hash emails if needed (but reduces accuracy)
   - Remove PII from non-email columns
   - Follow GDPR/privacy laws
   - Store datasets securely

7. **Continuous Improvement**
   - Use automatic online learning
   - Retrain with new production data
   - Monitor accuracy metrics
   - A/B test new models

---

## CSV Template

Save this as `dataset/template.csv`:

```csv
email,label
john.doe@example.com,legit
jane.smith@company.org,legit
alice.wonder@university.edu,legit
user1@gmail.com,fraud
user2@gmail.com,fraud
test123@yahoo.com,fraud
```

Replace with your actual data and train:
```bash
npm run cli train:markov --upload --remote
```

---

## Next Steps

After preparing datasets:

1. **Train Models:** [Train and upload models](#training-models)
2. **Deploy Worker:** [FIRST_DEPLOY.md](FIRST_DEPLOY.md)
3. **Monitor Performance:** [ANALYTICS.md](ANALYTICS.md)
4. **Continuous Learning:** Enable automatic retraining

---

## Quick Reference

```bash
# Validate dataset
npm run cli train:validate ./dataset

# Train models
npm run cli train:markov

# Upload to KV
npm run cli train:markov --upload --remote

# Check uploaded models
npm run cli kv:list --binding MARKOV_MODEL --remote

# Generate test data
npm run cli test:generate --count 1000
```

---

**Need Help?**
- [Getting Started](GETTING_STARTED.md)
- [First Deployment](FIRST_DEPLOY.md)
- [CLI Reference](../cli/README.md)
