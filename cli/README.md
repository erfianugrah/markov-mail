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
npm run cli analytics:query "SELECT COUNT(*) FROM FRAUD_DETECTION_ANALYTICS"

# List KV keys
npm run cli kv:list --binding MARKOV_MODEL --remote
```

## Command Categories

### 📦 Training

**`train:markov`** - Train Markov Chain models from CSV datasets

```bash
# Train with default datasets
npm run cli train:markov

# Train and upload to remote KV
npm run cli train:markov --upload --remote

# Show help
npm run cli train:markov --help
```

**`train:validate`** - Validate training dataset quality
```bash
npm run cli train:validate ./dataset
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
npm run cli analytics:query "SELECT * FROM FRAUD_DETECTION_ANALYTICS LIMIT 10"

# Format as table
npm run cli analytics:query "SELECT action, COUNT(*) as count FROM FRAUD_DETECTION_ANALYTICS GROUP BY action" --format table

# Show statistics
npm run cli analytics:stats --last 48
```

### 🧪 Testing

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
