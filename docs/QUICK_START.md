# 🚀 Quick Start - 5 Minutes to Running

Get the fraud detection API running in just 5 minutes.

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

## Step 3: Deploy (1 minute)

```bash
npm run deploy
```

**Output:** Your worker URL
```
https://bogus-email-pattern-recognition.YOUR-SUBDOMAIN.workers.dev
```

## Step 4: Test (1 minute)

```bash
# Replace YOUR-SUBDOMAIN with your actual subdomain
curl -X POST https://bogus-email-pattern-recognition.YOUR-SUBDOMAIN.workers.dev/validate \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'
```

**Expected Response:**
```json
{
  "valid": true,
  "riskScore": 0.15,
  "decision": "allow",
  "signals": {
    "patternType": "random",
    "isGibberish": false,
    "isDisposableDomain": false
  }
}
```

## 🎉 Done!

Your fraud detection API is live!

## What's Next?

### Immediate Next Steps:

1. **Test different patterns:**
   ```bash
   # Test fraud patterns
   curl -X POST https://your-worker.workers.dev/validate \
     -H "Content-Type: application/json" \
     -d '{"email":"user123@gmail.com"}' | jq .
   ```

2. **View real-time logs:**
   ```bash
   npx wrangler tail
   ```

3. **Integrate with your app:**
   - See [API.md](API.md) for complete API docs
   - See [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) for code examples

### For Better Accuracy (Optional):

1. **Upload configuration:**
   ```bash
   npm run cli config:sync --remote
   ```

2. **Train models** (if you have datasets):
   ```bash
   npm run cli train:markov --upload --remote
   ```
   See [DATASETS.md](DATASETS.md) for dataset format

### Learn More:

- **[First Deployment Guide](FIRST_DEPLOY.md)** - Complete deployment walkthrough
- **[API Reference](API.md)** - All endpoints and options
- **[Architecture](ARCHITECTURE.md)** - How it works under the hood

---

## Troubleshooting

### "Not authenticated" error

```bash
npx wrangler login
```

### Deployment fails with KV namespace errors

This is normal for first deployment. The worker will still function at 85-90% accuracy.

To fix (optional):
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
