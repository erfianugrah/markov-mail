# 🔧 Fraud Detection CLI

Unified command-line interface for managing the fraud detection system.

## Quick Start

```bash
# Show help
npm run cli --help

# Train Markov Chain models
npm run cli train:markov

# Deploy to production
npm run cli deploy --minify

# Query analytics
npm run cli analytics:query "SELECT COUNT(*) FROM ANALYTICS_DATASET"

# List KV keys
npm run cli kv:list --binding MARKOV_MODEL --remote
```

## Command Categories

### 📦 Training

> **Note:** Scheduled training is currently disabled (as of 2025-01-06) to prevent circular reasoning issues. Manual training commands below are the **recommended** approach. You can also trigger online training via the admin API endpoint if needed (see [TRAINING.md](../docs/TRAINING.md) for details).

**`training:extract`** - [Optional] Extract training data from Analytics Engine

```bash
# Extract last 24 hours (saves to JSON file for offline analysis)
npm run cli training:extract

# Extract last 7 days with 90% confidence threshold
npm run cli training:extract --days 7 --min-confidence 0.9

# Extract from production Analytics Engine
npm run cli training:extract --days 1 --remote

# Show help
npm run cli training:extract --help
```

**`train:markov`** - Train Markov Chain models from CSV datasets

```bash
# Train with default datasets
npm run cli train:markov

# Train and upload to remote KV
npm run cli train:markov --upload --remote

# Upload to custom KV binding
npm run cli train:markov --upload --remote --binding MY_MODELS

# Show help
npm run cli train:markov --help
```

**`train:validate`** - Validate training dataset quality
```bash
npm run cli train:validate ./dataset
```

**`train:relabel`** - Re-label dataset based on pattern analysis

Re-labels datasets using pattern analysis instead of message content. Critical for avoiding mislabeled training data.

```bash
# Re-label default dataset
npm run cli train:relabel

# Custom input/output
npm run cli train:relabel --input ./data/raw.csv --output ./data/clean.csv

# Stricter fraud threshold (default: 0.5)
npm run cli train:relabel --threshold 0.7 --verbose

# Show help
npm run cli train:relabel --help
```

**`training:train`** - Train models from extracted datasets

Trains Markov Chain models from data extracted via `training:extract`.

```bash
# Train with defaults (last 7 days)
npm run cli training:train

# Train only 2-gram and 3-gram
npm run cli training:train --orders "2,3"

# Use last 14 days with stricter requirements
npm run cli training:train --days 14 --min-samples 200

# Train against production data
npm run cli training:train --remote

# Show help
npm run cli training:train --help
```

**`training:validate`** - Validate trained models before deployment

Validates models against test datasets with quality gates.

```bash
# Validate specific model version
npm run cli training:validate --version 20251102_020000

# Custom quality thresholds
npm run cli training:validate \
  --version 20251102_020000 \
  --min-accuracy 0.97 \
  --min-precision 0.92

# Skip production comparison
npm run cli training:validate \
  --version 20251102_020000 \
  --compare-production false

# Show help
npm run cli training:validate --help
```

**`model:validate`** - Validate models against comprehensive test suite

Tests individual models (2-gram, 3-gram) and ensemble approach.

```bash
# Validate production models
npm run cli model:validate --remote

# Test only 2-gram model
npm run cli model:validate --orders "2" --remote

# Test ensemble with verbose output
npm run cli model:validate --remote --ensemble --verbose

# Test specific category (gibberish, sequential, etc.)
npm run cli model:validate --remote --category gibberish

# Use custom KV binding
npm run cli model:validate --remote --binding MY_MODELS

# Show help
npm run cli model:validate --help
```

### 🚀 Deployment

**`deploy`** - Deploy worker to Cloudflare

```bash
# Deploy
npm run cli deploy

# Deploy with minification
npm run cli deploy --minify

# Deploy to specific environment
npm run cli deploy --env production
```

**`deploy:status`** - Check deployment status
```bash
npm run cli deploy:status
```

### 💾 Data Management

**KV Commands**

```bash
# List all keys in a binding
npm run cli kv:list --binding CONFIG --remote

# Get a value
npm run cli kv:get detector_config --binding CONFIG --remote

# Put a value
npm run cli kv:put my_key my_value --binding CONFIG --remote

# Put from file
npm run cli kv:put model --file model.json --binding MARKOV_MODEL --remote

# Delete a key
npm run cli kv:delete old_key --binding CONFIG --remote
```

**Analytics Commands**

```bash
# Run SQL query
npm run cli analytics:query "SELECT * FROM ANALYTICS_DATASET LIMIT 10"

# Format as table
npm run cli analytics:query "SELECT blob1 as decision, COUNT(*) as count FROM ANALYTICS_DATASET GROUP BY blob1" --format table

# Show statistics
npm run cli analytics:stats --last 48
```

**Disposable Domains Commands**

```bash
# Update domains list from GitHub sources
npm run cli domains:update

# View metadata (count, last updated, sources)
npm run cli domains:metadata

# Clear domains cache (forces reload)
npm run cli domains:cache:clear

# Use custom API URL
npm run cli domains:update --api-url https://my-worker.workers.dev

# Show help
npm run cli domains:update --help
```

**Note:** Requires `ADMIN_API_KEY` environment variable. Optional `API_URL` env var or `--api-url` flag.

**TLD Risk Profiles Commands**

Manage the 143 TLD risk profiles used for domain risk scoring.

```bash
# Initialize KV with hardcoded profiles (142 TLDs)
npm run cli tld:sync

# View metadata and statistics
npm run cli tld:metadata

# Get a specific TLD profile
npm run cli tld:get tk
npm run cli tld:get com

# Update TLD risk multiplier
npm run cli tld:update tk '{"riskMultiplier": 2.5}'

# Update TLD category and risk
npm run cli tld:update info '{"category": "suspicious", "riskMultiplier": 1.5}'

# Clear TLD cache (forces reload)
npm run cli tld:cache:clear

# Use custom API URL
npm run cli tld:sync --api-url https://my-worker.workers.dev

# Show help
npm run cli tld:sync --help
```

**Note:** Requires `ADMIN_API_KEY` environment variable. Optional `API_URL` env var or `--api-url` flag.

**TLD Categories:**
- `trusted` - .edu, .gov, .mil (0.2-0.5 risk)
- `standard` - .com, .net, .org (0.8-1.2 risk)
- `suspicious` - .info, .biz (1.3-2.0 risk)
- `high_risk` - .tk, .ml, .ga (2.0-3.0 risk)

### 🧪 Testing

**`test:cron`** - Test cron triggers locally

```bash
# Test with default settings (requires wrangler dev running)
npm run cli test:cron

# Test with specific cron pattern
npm run cli test:cron --cron "0 */6 * * *"

# Test with custom port
npm run cli test:cron --port 9000

# Show help
npm run cli test:cron --help
```

**`test:generate`** - Generate test email dataset

```bash
# Generate 100 test emails
npm run cli test:generate --count 100

# Generate specific patterns
npm run cli test:generate --count 50 --patterns sequential,dated
```

**`test:detectors`** - Test pattern detectors
```bash
npm run cli test:detectors
```

**`test:api`** - Test API endpoints
```bash
npm run cli test:api user123@example.com
npm run cli test:api --url http://localhost:8787/validate test@example.com
```

**`test:live`** - Run live tests against production

Runs 49 hand-crafted test cases against production API to verify model accuracy.

```bash
# Test production endpoint (default)
npm run cli test:live

# Test with verbose output
npm run cli test:live --verbose

# Test custom endpoint
npm run cli test:live --endpoint https://your-worker.workers.dev/validate

# Show help
npm run cli test:live --help
```

**`test:batch`** - Batch test large datasets

Test thousands of emails against production API with CSV/JSON input.

```bash
# Test CSV file
npm run cli test:batch --input /tmp/test_emails.csv

# Test JSON file with custom concurrency
npm run cli test:batch --input test-data/emails-5k.json --concurrency 20

# Test against custom endpoint
npm run cli test:batch --input data.csv --endpoint https://fraud.erfi.dev/validate

# Save results to custom path
npm run cli test:batch --input data.csv --output ./results.json

# Show help
npm run cli test:batch --help
```

**CSV Format for test:batch:**
```csv
email,type,category
user@example.com,legitimate,professional
test123@gmail.com,fraudulent,sequential
```

**`test:multilang`** - Test multi-language N-gram support

Tests name detection across 15+ languages (English, Spanish, French, German, Italian, Portuguese, Russian, Chinese, Arabic, etc.).

```bash
# Run multi-language tests
npm run cli test:multilang

# Note: This command runs immediately (no --help flag)
```

### ⚙️ Configuration

**`config:get`** - Get configuration value
```bash
npm run cli config:get threshold
```

**`config:set`** - Set configuration value
```bash
npm run cli config:set threshold 0.75
```

**`config:list`** - List all configurations
```bash
npm run cli config:list
```

**`config:sync`** - Sync local config to KV
```bash
npm run cli config:sync
```

**Note:** All config commands support `--binding <name>` to use custom KV bindings:
```bash
# Use custom binding
npm run cli config:get mykey --binding MY_CONFIG
npm run cli config:set mykey myvalue --binding MY_CONFIG
```

### 🧪 A/B Testing

**`ab:create`** - Create new A/B test experiment

Creates a new experiment with treatment/control variants for testing model changes.

```bash
# Create simple experiment (10% treatment, 7 days)
npm run cli ab:create \
  --experiment-id "test_new_weights" \
  --description "Test optimized risk weights"

# Create with custom config overrides
npm run cli ab:create \
  --experiment-id "ensemble_markov" \
  --description "Test ensemble Markov models" \
  --treatment-weight 10 \
  --duration 7 \
  --treatment-config '{"riskWeights":{"markovChain":0.40,"patternDetection":0.25}}'

# Deploy to production KV
npm run cli ab:create \
  --experiment-id "bot_mgmt_test" \
  --description "Test Bot Management weight" \
  --remote

# Show help
npm run cli ab:create --help
```

**`ab:status`** - Show active A/B test status

```bash
# Check local experiment
npm run cli ab:status

# Check production experiment
npm run cli ab:status --remote

# Show help
npm run cli ab:status --help
```

**`ab:analyze`** - Analyze A/B test results

Analyzes experiment results from Analytics Engine with statistical significance testing.

```bash
# Analyze last 7 days (default)
npm run cli ab:analyze --experiment-id "test_new_weights"

# Analyze last 24 hours
npm run cli ab:analyze --experiment-id "bot_mgmt_test" --hours 24

# Get JSON output for further processing
npm run cli ab:analyze --experiment-id "ensemble_markov" --format json

# Show help
npm run cli ab:analyze --help
```

**`ab:stop`** - Stop active A/B test

```bash
# Stop local experiment (with confirmation)
npm run cli ab:stop

# Stop production experiment without confirmation
npm run cli ab:stop --remote --yes

# Show help
npm run cli ab:stop --help
```

**A/B Test Workflow:**
```bash
# 1. Create experiment
npm run cli ab:create --experiment-id "my_test" --description "Test new model" --remote

# 2. Monitor results
npm run cli ab:status --remote

# 3. Analyze performance
npm run cli ab:analyze --experiment-id "my_test" --hours 48

# 4. Stop experiment when done
npm run cli ab:stop --remote --yes
```

## Environment Variables

For analytics and KV commands, set these environment variables:

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

## Common Workflows

### Training & Deployment

```bash
# 1. Train models from datasets
npm run cli train:markov

# 2. Upload to remote KV
npm run cli train:markov --upload --remote

# 3. Deploy worker
npm run cli deploy --minify

# 4. Test API
npm run cli test:api user123@test.com
```

### Data Management

```bash
# Check what's in KV
npm run cli kv:list --binding MARKOV_MODEL --remote

# Get model metadata
npm run cli kv:get MM_legit_production --binding MARKOV_MODEL --remote

# Query analytics
npm run cli analytics:stats --last 24
```

### Development

```bash
# Generate test data
npm run cli test:generate --count 1000

# Test detectors
npm run cli test:detectors

# Deploy to local
npm run cli deploy

# Test locally
npm run cli test:api --url http://localhost:8787/validate
```

## Directory Structure

```
cli/
├── index.ts           # Main CLI entry point
├── commands/
│   ├── train/         # Training commands
│   ├── deploy/        # Deployment commands
│   ├── data/          # Data management (KV, analytics)
│   ├── test/          # Testing commands
│   └── config/        # Configuration commands
└── utils/
    ├── logger.ts      # Logging utilities
    └── args.ts        # Argument parsing
```

## Adding New Commands

1. Create command file in `cli/commands/<category>/<name>.ts`
2. Export default async function
3. Register in `cli/index.ts` COMMANDS object
4. Add help text and usage

Example:

```typescript
// cli/commands/my/command.ts
import { logger } from '../../utils/logger.ts';
import { parseArgs } from '../../utils/args.ts';

export default async function myCommand(args: string[]) {
  const parsed = parseArgs(args);
  logger.section('My Command');
  // Implementation
}
```

## Tips

- Use `--help` on any command for detailed usage
- Most commands support `--remote` flag for production KV
- Analytics queries use SQL syntax
- KV commands default to local unless `--remote` is specified
- Debug mode: `DEBUG=1 npm run cli <command>`

## Troubleshooting

**Command not found**: Ensure you're using `npm run cli` prefix

**KV errors**: Check binding names match wrangler.toml

**Analytics errors**: Verify environment variables are set

**Permission errors**: Ensure API key has required scopes

---

**For more help**: `npm run cli --help`
