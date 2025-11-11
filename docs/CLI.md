# 🔧 Command Line Interface (CLI)

**Comprehensive guide to the Fraud Detection System CLI**

The CLI provides a unified interface for managing the fraud detection system, from training models to deploying workers and querying analytics.

---

## Quick Start

```bash
# Show all available commands
npm run cli

# Get help for any command
npm run cli <command> --help

# Example: Train Markov models
npm run cli train:markov
```

---

## Command Reference

### 📦 Training Commands

#### `train:markov`
Train Markov Chain models from CSV datasets.

```bash
# Train with default datasets
npm run cli train:markov

# Train with custom dataset
npm run cli train:markov --dataset ./custom-data.csv

# Train and specify output location
npm run cli train:markov --output ./models/
```

**Options:**
- `--dataset <path>` - Path to training dataset (CSV format)
- `--output <path>` - Output directory for trained models

**Use Case:** Initial model training or retraining with custom datasets.

---

#### `train:validate`
Validate training dataset quality before training.

```bash
npm run cli train:validate ./dataset
```

**Use Case:** Check dataset for issues like class imbalance, insufficient samples, or data quality problems.

---

#### `training:extract`
Extract training data from Analytics Engine (production data).

```bash
# Extract last 7 days of data
npm run cli training:extract

# Extract last 30 days
npm run cli training:extract --days 30

# Extract with minimum confidence threshold
npm run cli training:extract --days 7 --min-confidence 0.8
```

**Options:**
- `--days <n>` - Number of days to extract (default: 7)
- `--min-confidence <n>` - Minimum confidence threshold (0-1)

**Use Case:** Collect real production data for online learning and model improvement.

---

#### `training:train`
Train models from extracted Analytics Engine datasets.

```bash
# Train from extracted data (last 7 days)
npm run cli training:train

# Train from last 30 days with specific orders
npm run cli training:train --days 30 --orders 1,2,3
```

**Options:**
- `--days <n>` - Number of days of data to use
- `--orders <list>` - N-gram orders to train (comma-separated)

**Use Case:** Online learning - continuously improve models with production data.

---

#### `training:validate`
Validate trained models before deployment.

```bash
# Validate a specific model version
npm run cli training:validate --version v20251102_120000

# Run full validation suite
npm run cli training:validate --version latest --full
```

**Options:**
- `--version <version>` - Model version to validate
- `--full` - Run comprehensive validation tests

**Use Case:** Quality gates before promoting models to production.

---

### 🚀 Deployment Commands

#### `deploy`
Deploy worker to Cloudflare.

```bash
# Deploy to production
npm run cli deploy

# Deploy with minification (smaller bundle)
npm run cli deploy --minify

# Deploy to specific environment
npm run cli deploy --env staging
```

**Options:**
- `--minify` - Minify code for production
- `--env <name>` - Target environment (default: production)

**Use Case:** Push code changes to Cloudflare Workers.

---

#### `deploy:status`
Check deployment status and recent deployments.

```bash
npm run cli deploy:status
```

**Output:** Shows recent deployments, active version, and deployment health.

---

### 💾 Data Management Commands

#### KV Commands

**`kv:list`** - List keys in KV namespace

```bash
# List all keys in CONFIG binding
npm run cli kv:list --binding CONFIG

# List keys with prefix
npm run cli kv:list --binding MARKOV_MODEL --prefix MM_legit

# List from remote (production) KV
npm run cli kv:list --binding CONFIG --remote
```

**Options:**
- `--binding <name>` - KV namespace binding (CONFIG, MARKOV_MODEL)
- `--prefix <prefix>` - Filter keys by prefix
- `--remote` - Use production KV (default: local)

---

**`kv:get`** - Get value from KV

```bash
# Get configuration
npm run cli kv:get detector_config --binding CONFIG

# Get from remote KV
npm run cli kv:get MM_legit_production --binding MARKOV_MODEL --remote
```

**Options:**
- `--binding <name>` - KV namespace binding
- `--remote` - Use production KV

---

**`kv:put`** - Put value to KV

```bash
# Put simple value
npm run cli kv:put my_key "my value" --binding CONFIG

# Put from file (JSON)
npm run cli kv:put model_data --file ./model.json --binding MARKOV_MODEL

# Put to remote (production)
npm run cli kv:put config --file ./config.json --binding CONFIG --remote
```

**Options:**
- `--binding <name>` - KV namespace binding
- `--file <path>` - Read value from file
- `--remote` - Use production KV

---

**`kv:delete`** - Delete key from KV

```bash
# Delete key
npm run cli kv:delete old_model --binding MARKOV_MODEL

# Delete from remote
npm run cli kv:delete old_config --binding CONFIG --remote
```

**Options:**
- `--binding <name>` - KV namespace binding
- `--remote` - Use production KV

---

#### Analytics Commands

**`analytics:query`** - Query Analytics Engine with SQL

```bash
# Simple count query
npm run cli analytics:query "SELECT COUNT(*) FROM ANALYTICS_DATASET"

# Group by decision
npm run cli analytics:query "SELECT decision, COUNT(*) as count FROM ANALYTICS_DATASET WHERE timestamp >= NOW() - INTERVAL '24' HOUR GROUP BY decision"

# Format as table
npm run cli analytics:query "SELECT * FROM ANALYTICS_DATASET LIMIT 10" --format table

# Save to file
npm run cli analytics:query "SELECT * FROM ANALYTICS_DATASET" --format json > results.json
```

**Options:**
- `--format <type>` - Output format (json, table, csv)

**Use Case:** Ad-hoc data analysis, debugging, reporting.

---

**`analytics:stats`** - Show analytics statistics

```bash
# Show last 24 hours
npm run cli analytics:stats

# Show last 48 hours
npm run cli analytics:stats --last 48

# Show last 7 days (168 hours)
npm run cli analytics:stats --last 168
```

**Options:**
- `--last <hours>` - Time window in hours (default: 24)

**Output:** Shows request volume, decision breakdown, risk score distribution, top detectors.

---

### 🧪 Testing Commands

#### `test:generate`
Generate synthetic test email dataset.

```bash
# Generate 100 test emails
npm run cli test:generate --count 100

# Generate specific patterns
npm run cli test:generate --count 50 --patterns sequential,dated

# Generate all patterns
npm run cli test:generate --count 1000 --patterns all
```

**Options:**
- `--count <n>` - Number of emails to generate
- `--patterns <list>` - Patterns to include (comma-separated)
  - `sequential` - user1, user2, user3
  - `dated` - john.2024, user.2025
  - `keyboard` - qwerty, asdfgh
  - `gibberish` - xk9m2qw7
  - `plus` - user+tag1, user+tag2
  - `all` - All patterns

**Output:** CSV file with generated emails and labels.

---

#### `test:detectors`
Test pattern detectors against known samples.

```bash
# Test all detectors
npm run cli test:detectors

# Test specific detector
npm run cli test:detectors --pattern sequential
```

**Options:**
- `--pattern <name>` - Test specific detector

**Output:** Detector accuracy, precision, recall, and F1 scores.

---

#### `test:api`
Test API endpoints with sample emails.

```bash
# Test production endpoint
npm run cli test:api user123@example.com

# Test local endpoint
npm run cli test:api --url http://localhost:8787/validate test@example.com

# Test multiple emails from file
npm run cli test:api --file emails.txt
```

**Options:**
- `--url <url>` - API endpoint URL (default: production)
- `--file <path>` - File with emails (one per line)
- `--email <email>` - Single email to test

**Output:** Risk scores, decisions, detector contributions.

---

#### `model:validate`
Validate trained Markov models against comprehensive test suite.

```bash
# Validate production models
npm run cli model:validate --remote

# Test with ensemble approach (2-gram + 3-gram)
npm run cli model:validate --remote --ensemble

# Test specific n-gram order
npm run cli model:validate --remote --orders "2"

# Test specific category with verbose output
npm run cli model:validate --remote --category gibberish --verbose

# Compare all models
npm run cli model:validate --remote --orders "2,3" --ensemble --verbose
```

**Options:**
- `--remote` - Test production models (from KV)
- `--orders <list>` - Which n-gram orders to test (default: "2,3")
- `--ensemble` - Test ensemble approach combining models
- `--verbose` - Show detailed results for each test case
- `--category <name>` - Only test specific category
  - `gibberish` - Random character spam
  - `sequential` - user1, user2 patterns
  - `keyboard` - qwerty, asdfgh patterns
  - `legitimate` - Real names and role emails
  - `legit_numbers` - Names with birth years

**Output:**
- Overall accuracy per model
- Per-category accuracy breakdown
- Ensemble reasoning distribution
- Failed test cases with details
- Cross-entropy and confidence scores

**Test Suite Coverage:**
- 5 gibberish patterns (pure random, repetitive, keyboard spam)
- 5 sequential patterns (user1, test001, account99)
- 4 keyboard walks (qwerty, asdfgh, zxcvbn, 123456)
- 8 legitimate patterns (real names, role emails, name.year)
- 2 legitimate numbers (birth years, 2-digit years)

**Use Cases:**
- Pre-deployment model validation
- Compare 2-gram vs 3-gram performance
- Test ensemble strategy before implementing
- Identify false positives/negatives
- Validate after retraining

---

#### `test:multilang`
Test multi-language N-gram support.

```bash
npm run cli test:multilang
```

**Output:** Tests names from 7 languages (English, Spanish, French, German, Italian, Portuguese, Romanized).

---

### ⚙️ Configuration Commands

#### `config:get`
Get configuration value from KV.

```bash
# Get specific config value
npm run cli config:get threshold

# Get from remote (production)
npm run cli config:get threshold --remote
```

---

#### `config:set`
Set configuration value in KV.

```bash
# Set threshold
npm run cli config:set threshold 0.75

# Set to remote (production)
npm run cli config:set threshold 0.75 --remote
```

---

#### `config:list`
List all configurations from KV.

```bash
# List local config
npm run cli config:list

# List production config
npm run cli config:list --remote
```

**Output:** All configuration keys and values.

---

#### `config:sync`
Sync local configuration file to KV.

```bash
# Sync to local KV
npm run cli config:sync

# Sync to production KV
npm run cli config:sync --remote
```

**Use Case:** Apply configuration changes from version control.

---

### 🧪 A/B Testing Commands

#### `ab:create`
Create new A/B test experiment.

```bash
# Create simple experiment
npm run cli ab:create \
  --experiment-id test_markov_v2 \
  --description "Test new Markov model" \
  --control-percent 90 \
  --treatment-percent 10

# Create with full options
npm run cli ab:create \
  --experiment-id test_confidence_threshold \
  --description "Test confidence threshold 0.7 vs 0.65" \
  --control-percent 50 \
  --treatment-percent 50 \
  --duration 48 \
  --remote
```

**Options:**
- `--experiment-id <id>` - Unique experiment ID
- `--description <desc>` - Experiment description
- `--control-percent <n>` - Control traffic % (default: 90)
- `--treatment-percent <n>` - Treatment traffic % (default: 10)
- `--duration <hours>` - Experiment duration (default: 24)
- `--remote` - Create in production

---

#### `ab:status`
Show active A/B test status.

```bash
# Check local experiment
npm run cli ab:status

# Check production experiment
npm run cli ab:status --remote
```

**Output:** Experiment details, traffic split, metrics, start/end times.

---

#### `ab:analyze`
Analyze A/B test results with statistical significance.

```bash
# Analyze last 24 hours
npm run cli ab:analyze --experiment-id test_markov_v2

# Analyze custom time window
npm run cli ab:analyze --experiment-id test_markov_v2 --hours 48
```

**Options:**
- `--experiment-id <id>` - Experiment to analyze
- `--hours <n>` - Time window for analysis (default: 24)

**Output:**
- Sample sizes per variant
- Conversion rates
- Statistical significance (p-value)
- Confidence intervals
- Recommendation (ship, stop, continue)

---

#### `ab:stop`
Stop active A/B test.

```bash
# Stop local experiment (with confirmation)
npm run cli ab:stop

# Stop production experiment (skip confirmation)
npm run cli ab:stop --remote --yes
```

**Options:**
- `--remote` - Stop production experiment
- `--yes` - Skip confirmation prompt

---

## Common Workflows

### Workflow 1: Initial Setup

```bash
# 1. Train initial models
npm run cli train:markov --dataset ./training-data.csv

# 2. Validate models
npm run cli train:validate ./training-data.csv

# 3. Deploy worker
npm run cli deploy --minify

# 4. Test deployment
npm run cli test:api test@example.com
```

---

### Workflow 2: Online Learning

```bash
# 1. Extract production data (last 7 days)
npm run cli training:extract --days 7

# 2. Train models with new data
npm run cli training:train --days 7

# 3. Validate trained models
npm run cli training:validate --version latest

# 4. If validation passes, upload to KV
npm run cli kv:put MM_legit_candidate --file models/legit.json --binding MARKOV_MODEL --remote

# 5. Create A/B test (10% canary)
npm run cli ab:create --experiment-id model_v2 --control-percent 90 --treatment-percent 10 --remote

# 6. Monitor for 24 hours
npm run cli ab:status --remote

# 7. Analyze results
npm run cli ab:analyze --experiment-id model_v2 --hours 24

# 8. If successful, promote to production
npm run cli kv:put MM_legit_production --file models/legit.json --binding MARKOV_MODEL --remote
```

---

### Workflow 3: Debugging Production Issues

```bash
# 1. Check recent deployments
npm run cli deploy:status

# 2. Query analytics for errors
npm run cli analytics:query "SELECT decision, COUNT(*) FROM ANALYTICS_DATASET WHERE timestamp >= NOW() - INTERVAL '1' HOUR GROUP BY decision"

# 3. Check current configuration
npm run cli config:list --remote

# 4. Check model versions in KV
npm run cli kv:list --binding MARKOV_MODEL --remote

# 5. Test problematic emails
npm run cli test:api problematic@email.com
```

---

### Workflow 4: Configuration Changes

```bash
# 1. Update local config file
vim config/detector-config.json

# 2. Sync to KV
npm run cli config:sync --remote

# 3. Verify changes
npm run cli config:list --remote

# 4. Test with new config
npm run cli test:api test@example.com
```

---

## Environment Variables

Some commands require Cloudflare credentials:

```bash
export CLOUDFLARE_API_KEY="your_api_key"
export CLOUDFLARE_EMAIL="your@email.com"
export CLOUDFLARE_ACCOUNT_ID="your_account_id"
```

Or create a `.env` file:

```bash
CLOUDFLARE_API_KEY=your_api_key
CLOUDFLARE_EMAIL=your@email.com
CLOUDFLARE_ACCOUNT_ID=your_account_id
```

**Required for:**
- `analytics:*` commands
- `kv:*` commands with `--remote`
- `deploy` commands
- `ab:*` commands with `--remote`

---

## Tips & Best Practices

### 1. Always Validate Before Deploying
```bash
# Run tests first
npm run cli test:detectors
npm run cli training:validate --version latest

# Then deploy
npm run cli deploy --minify
```

### 2. Use A/B Testing for Major Changes
```bash
# Start with 10% canary
npm run cli ab:create --experiment-id new_feature --control-percent 90 --treatment-percent 10

# Monitor for 48 hours before full rollout
npm run cli ab:analyze --experiment-id new_feature --hours 48
```

### 3. Regular Online Learning
```bash
# Weekly retraining with production data
npm run cli training:extract --days 7
npm run cli training:train --days 7
npm run cli training:validate --version latest
```

### 4. Monitor Analytics Regularly
```bash
# Daily check
npm run cli analytics:stats --last 24

# Weekly summary
npm run cli analytics:query "SELECT DATE(timestamp) as date, decision, COUNT(*) as count FROM ANALYTICS_DATASET WHERE timestamp >= NOW() - INTERVAL '7' DAY GROUP BY date, decision"
```

### 5. Backup Before Changes
```bash
# Export current models
npm run cli kv:get MM_legit_production --binding MARKOV_MODEL --remote > backup_legit.json
npm run cli kv:get MM_fraud_production --binding MARKOV_MODEL --remote > backup_fraud.json

# Export current config
npm run cli config:list --remote > backup_config.json
```

---

## Troubleshooting

### Command Not Found
```bash
# Ensure you're using npm run cli prefix
npm run cli train:markov  # ✅ Correct
train:markov               # ❌ Wrong
```

### KV Errors
```bash
# Check binding names in wrangler.toml
cat wrangler.toml | grep kv_namespaces

# Use correct binding name
npm run cli kv:list --binding MARKOV_MODEL  # ✅ Correct
npm run cli kv:list --binding MARKOV        # ❌ Wrong (if not in wrangler.toml)
```

### Analytics Errors
```bash
# Ensure environment variables are set
echo $CLOUDFLARE_API_KEY
echo $CLOUDFLARE_EMAIL
echo $CLOUDFLARE_ACCOUNT_ID

# Or use .env file
cat .env
```

### Permission Errors
```bash
# Check API key scopes in Cloudflare dashboard
# Required scopes:
# - Workers:Edit
# - Analytics:Read
# - KV:Edit
```

---

## Command Summary Table

| Command | Category | Description | Remote Support |
|---------|----------|-------------|----------------|
| `train:markov` | Training | Train Markov models from CSV | No |
| `train:validate` | Training | Validate dataset quality | No |
| `training:extract` | Training | Extract from Analytics | Yes |
| `training:train` | Training | Train from extracted data | No |
| `training:validate` | Training | Validate trained models | No |
| `deploy` | Deployment | Deploy to Cloudflare | Yes |
| `deploy:status` | Deployment | Check deployment status | Yes |
| `kv:list` | Data | List KV keys | Yes |
| `kv:get` | Data | Get KV value | Yes |
| `kv:put` | Data | Put KV value | Yes |
| `kv:delete` | Data | Delete KV key | Yes |
| `analytics:query` | Data | SQL queries | Yes |
| `analytics:stats` | Data | Show statistics | Yes |
| `test:generate` | Testing | Generate test dataset | No |
| `test:detectors` | Testing | Test pattern detectors | No |
| `test:api` | Testing | Test API endpoints | Yes |
| `test:multilang` | Testing | Test multi-language | No |
| `config:get` | Config | Get config value | Yes |
| `config:set` | Config | Set config value | Yes |
| `config:list` | Config | List all config | Yes |
| `config:sync` | Config | Sync to KV | Yes |
| `ab:create` | A/B Test | Create experiment | Yes |
| `ab:status` | A/B Test | Show experiment status | Yes |
| `ab:analyze` | A/B Test | Analyze results | Yes |
| `ab:stop` | A/B Test | Stop experiment | Yes |

---

## See Also

- [Getting Started](GETTING_STARTED.md) - System setup and deployment
- [API Reference](API.md) - HTTP API documentation
- [Analytics](ANALYTICS.md) - Analytics Engine queries
- [Configuration](CONFIGURATION.md) - Configuration management

---

**Last Updated**: 2025-11-02
