# Quick Start

Get the fraud detection API running in 5 minutes.

## Prerequisites

- Node.js v18+ installed
- Cloudflare account (free) - [Sign up here](https://dash.cloudflare.com/sign-up)

## Step 1: Clone and Install (1 minute)

```bash
git clone https://github.com/your-org/bogus-email-pattern-recognition.git
cd bogus-email-pattern-recognition
npm install
```

## Step 2: Authenticate (1 minute)

```bash
# Login to Cloudflare (opens browser)
npx wrangler login

# Verify
npx wrangler whoami
```

## Step 3: Deploy

```bash
npm run deploy
```

You'll get a worker URL like:
```
https://bogus-email-pattern-recognition.YOUR-SUBDOMAIN.workers.dev
```

## Step 4: Test

```bash
# Replace YOUR-SUBDOMAIN with your actual subdomain
curl -X POST https://bogus-email-pattern-recognition.YOUR-SUBDOMAIN.workers.dev/validate \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'
```

Expected response:
```json
{
  "valid": true,
  "riskScore": 0.15,
  "decision": "allow",
  "signals": {
    "patternType": "random",
    "isDisposableDomain": false,
    "markovDetected": false,
    "markovConfidence": 0.12
  }
}
```

Done. Your API is live.

## What's Next

### Test different patterns
   ```bash
   # Test fraud patterns
   curl -X POST https://your-worker.workers.dev/validate \
     -H "Content-Type: application/json" \
     -d '{"email":"user123@gmail.com"}' | jq .
   ```

### View real-time logs

```bash
npx wrangler tail
```

### Integrate with your app

See [API.md](API.md) for complete API docs and [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) for code examples.

### Optional: Better Accuracy

Upload configuration:
   ```bash
   npm run cli config:sync --remote
   ```

Train models (if you have datasets):
```bash
npm run cli train:markov --upload --remote
```
See [DATASETS.md](DATASETS.md) for dataset format.

### More docs

- [First Deployment Guide](FIRST_DEPLOY.md) - Complete deployment walkthrough
- [API Reference](API.md) - All endpoints and options
- [Architecture](ARCHITECTURE.md) - How it works

---

## Troubleshooting

### "Not authenticated" error

```bash
npx wrangler login
```

### Deployment fails with KV namespace errors

This is normal on first deployment. The worker still works at 85-90% accuracy without them.

To fix:
```bash
# Create KV namespaces
npx wrangler kv namespace create CONFIG
npx wrangler kv namespace create MARKOV_MODEL

# Update wrangler.jsonc with the IDs shown
# See FIRST_DEPLOY.md for details
```

### Worker returns errors

```bash
# Check logs
npx wrangler tail

# Redeploy
npm run deploy
```

---

**Need help?** See [FIRST_DEPLOY.md](FIRST_DEPLOY.md) for detailed instructions.
