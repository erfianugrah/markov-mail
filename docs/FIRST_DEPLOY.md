# First Deployment Guide

Complete walkthrough to deploy the fraud detection worker from zero to production.

## Prerequisites

Before starting, ensure you have:

- ✅ Node.js v18+ installed (`node --version`)
- ✅ Project cloned and dependencies installed (`npm install`)
- ✅ Tests passing (`npm test`)
- ✅ Cloudflare account (free tier - see below)

**Estimated Time:** 15-20 minutes (including Cloudflare account setup)

### Cloudflare Account Setup (5 minutes)

If you don't have a Cloudflare account yet:

1. **Sign up** at https://dash.cloudflare.com/sign-up
2. **Verify email** (check inbox)
3. **Skip domain setup** when prompted (use free `*.workers.dev` subdomain)
4. **Login via CLI:**
   ```bash
   npx wrangler login
   ```
   This opens your browser for authentication - click "Allow"

5. **Verify authentication:**
   ```bash
   npx wrangler whoami
   ```
   Should show your email and account details

That's it - you're ready to deploy.

---

## Deployment Flowchart

```
┌─────────────────────┐
│   Prerequisites     │
│   - Account setup   │
│   - Dependencies    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Upload Config      │
│  (Optional)         │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Train Models       │
│  (Optional)         │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Deploy Worker      │
│  npm run deploy     │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Test API           │
│  curl validation    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Monitor            │
│  wrangler tail      │
└─────────────────────┘
```

---

## Step 1: Understand Required vs Optional Components

### ✅ Required (Worker WILL function)

- Cloudflare account authentication
- KV namespaces created (CONFIG, MARKOV_MODEL)
- Worker deployed

**Without these, deployment will fail.**

### ⚠️ Optional (Worker works, but with reduced features)

| Component | If Missing | Impact |
|-----------|------------|--------|
| **Configuration in KV** | Uses defaults | Lower accuracy, less control |
| **Markov Models** | Markov detection disabled | ~10-15% accuracy loss |
| **Training Datasets** | Can't train custom models | Use pre-trained or skip |
| **Admin API Key** | Admin endpoints disabled | Can't change config at runtime |

**Deployment Strategy:**
1. **Quick Start:** Deploy without optional components, test immediately
2. **Full Setup:** Add configuration and models for production use

---

## Step 2: Quick Deployment (No Configuration)

Deploy the worker immediately with defaults:

```bash
# Make sure you're logged in
npx wrangler whoami

# Deploy
npm run deploy
```

**Expected Output:**
```
Total Upload: 142.34 KiB / gzip: 41.23 KiB
Uploaded bogus-email-pattern-recognition (1.2 sec)
Published bogus-email-pattern-recognition (0.3 sec)
  https://bogus-email-pattern-recognition.YOUR-SUBDOMAIN.workers.dev
Current Deployment ID: abc12345-1234-1234-1234-123456789abc
```

Success: You'll see a `*.workers.dev` URL

### Test Immediately

```bash
# Replace YOUR-SUBDOMAIN with your actual subdomain from output
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
    "formatValid": true,
    "entropyScore": 0.42,
    "isDisposableDomain": false,
    "patternType": "random",
    "markovDetected": false,
    "isGibberish": false
  }
}
```

Note: Markov detection will be `false` until models are trained and uploaded.

---

## Step 3: Upload Configuration (Recommended)

Add configuration to KV for better control and accuracy.

### Option A: Use CLI (Easiest)

```bash
# Upload default configuration
npm run cli config:sync --remote

# Verify upload
npm run cli kv:get config.json --binding CONFIG --remote
```

### Option B: Use Example Config

```bash
# Upload balanced configuration
npx wrangler kv key put config.json \
  --path examples/config.json \
  --binding CONFIG \
  --remote

# Or strict configuration for higher security
npx wrangler kv key put config.json \
  --path examples/config-strict.json \
  --binding CONFIG \
  --remote
```

### Verify Configuration

```bash
# Get config from KV
npm run cli kv:get config.json --binding CONFIG --remote | jq .
```

**Expected Output:**
```json
{
  "riskThresholds": {
    "block": 0.7,
    "warn": 0.4
  },
  "features": {
    "enableDisposableCheck": true,
    "enablePatternCheck": true,
    "enableMarkovChainDetection": true
  }
}
```

Configuration is now active - no redeployment needed.

---

## Step 4: Train and Upload Models (For Best Accuracy)

Markov Chain models improve fraud detection by ~10-15%.

### Do I need to train models?

| Scenario | Train? |
|----------|--------|
| Just testing | No, skip this |
| Production use | Yes (10-15% accuracy gain) |
| Have training data | Yes, train custom models |
| No training data | Optional, see alternatives |

### Option A: You Have Training Datasets

If you have CSV files with legitimate and fraudulent emails:

```bash
# Place CSV files in ./dataset/ directory
# Format: columns must include "email" and "label" (legit/fraud)

# Train models
npm run cli train:markov

# Upload to KV
npm run cli train:markov --upload --remote
```

**See [DATASETS.md](DATASETS.md) for dataset format details.**

### Option B: No Training Data

You have two options:

**1. Start without Markov models:**
```bash
# Worker will function with 85-90% accuracy
# Other detectors (pattern, gibberish, TLD) still work
```

**2. Use sample datasets:**
```bash
# We don't include datasets in the repo due to size
# You'll need to collect your own or wait for production data

# After collecting data from Analytics Engine:
npm run cli training:extract
npm run cli training:train
```

### Verify Models Uploaded

```bash
# List models in KV
npm run cli kv:list --binding MARKOV_MODEL --remote

# Should show:
# - MM_legit_production
# - MM_fraud_production
```

---

## Step 5: Test Deployment

### Test Basic Validation

```bash
# Test legitimate email
curl -X POST https://your-worker.workers.dev/validate \
  -H "Content-Type: application/json" \
  -d '{"email":"person1.person2@example.com"}' | jq .

# Test sequential pattern (should be flagged)
curl -X POST https://your-worker.workers.dev/validate \
  -H "Content-Type: application/json" \
  -d '{"email":"user123@gmail.com"}' | jq .

# Test gibberish (should be blocked)
curl -X POST https://your-worker.workers.dev/validate \
  -H "Content-Type: application/json" \
  -d '{"email":"xkqw9p2m@test.com"}' | jq .
```

### Test All Detectors

```bash
# Save this as test-deployment.sh
cat > test-deployment.sh << 'EOF'
#!/bin/bash
WORKER_URL="https://your-worker.workers.dev"

echo "=== Testing Fraud Detection API ==="
echo ""

echo "1. Legitimate email:"
curl -s -X POST $WORKER_URL/validate \
  -H "Content-Type: application/json" \
  -d '{"email":"personC.personD@company.com"}' | jq '{decision, riskScore}'

echo ""
echo "2. Sequential pattern:"
curl -s -X POST $WORKER_URL/validate \
  -H "Content-Type: application/json" \
  -d '{"email":"user123@gmail.com"}' | jq '{decision, riskScore, signals: {patternFamily}}'

echo ""
echo "3. Gibberish:"
curl -s -X POST $WORKER_URL/validate \
  -H "Content-Type: application/json" \
  -d '{"email":"zxkqmw@test.com"}' | jq '{decision, riskScore, signals: {isGibberish}}'

echo ""
echo "4. Keyboard walk:"
curl -s -X POST $WORKER_URL/validate \
  -H "Content-Type: application/json" \
  -d '{"email":"qwerty123@yahoo.com"}' | jq '{decision, riskScore, signals: {hasKeyboardWalk}}'

echo ""
echo "5. Disposable domain:"
curl -s -X POST $WORKER_URL/validate \
  -H "Content-Type: application/json" \
  -d '{"email":"test@mailinator.com"}' | jq '{decision, riskScore, signals: {isDisposableDomain}}'
EOF

chmod +x test-deployment.sh
./test-deployment.sh
```

### What to expect

| Test | Decision | Risk Score |
|------|----------|------------|
| Legitimate | allow | 0.05 - 0.25 |
| Sequential | block/warn | 0.60 - 0.90 |
| Gibberish | block | 0.80 - 0.95 |
| Keyboard walk | block/warn | 0.70 - 0.85 |
| Disposable | warn/block | 0.40 - 0.70 |

---

## Step 6: Monitor Logs

Watch real-time logs to see the worker in action:

```bash
# Start tailing logs
npx wrangler tail
```

**In another terminal, make a test request:**
```bash
curl -X POST https://your-worker.workers.dev/validate \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'
```

**You should see logs like:**
```json
{
  "level": "info",
  "event": "validation_completed",
  "decision": "allow",
  "riskScore": 0.15,
  "latency_ms": 2
}
```

Stop tailing with Ctrl+C.

---

## Step 7: Set Up Admin API (Optional)

The Admin API lets you update configuration without redeployment.

### Create Admin API Key

```bash
# Generate a secure random key
openssl rand -base64 32

# Output example: xK9m2Qw7PzJ4nR6fT8hY3vC5bN1aM0sL
```

### Store as Secret

```bash
# Store in Cloudflare
npx wrangler secret put ADMIN_API_KEY
# Paste your key when prompted

# For local dev, add to .dev.vars
echo "ADMIN_API_KEY=xK9m2Qw7PzJ4nR6fT8hY3vC5bN1aM0sL" > .dev.vars
```

### Test Admin API

```bash
# View current config
curl https://your-worker.workers.dev/admin/config \
  -H "X-API-Key: xK9m2Qw7PzJ4nR6fT8hY3vC5bN1aM0sL"

# Update thresholds
curl -X PUT https://your-worker.workers.dev/admin/config \
  -H "X-API-Key: xK9m2Qw7PzJ4nR6fT8hY3vC5bN1aM0sL" \
  -H "Content-Type: application/json" \
  -d '{"riskThresholds": {"block": 0.8, "warn": 0.5}}'
```

---

## Step 8: Set Up Custom Domain (Optional)

Use your own domain instead of `*.workers.dev`.

### Requirements

- Domain registered (can be registered with Cloudflare)
- Domain using Cloudflare nameservers

### Add Custom Domain

**Via Dashboard:**
1. Go to Workers & Pages → Your Worker
2. Click **Triggers** tab
3. Click **Add Custom Domain**
4. Enter your domain (e.g., `fraud.yourdomain.com`)
5. Click **Add Custom Domain**

**Via wrangler.jsonc:**
```jsonc
{
  "routes": [
    {
      "pattern": "fraud.yourdomain.com",
      "custom_domain": true
    }
  ]
}
```

Then deploy:
```bash
npm run deploy
```

**DNS Setup:**
Cloudflare automatically creates the DNS record. Wait 1-2 minutes for propagation.

**Test:**
```bash
curl https://fraud.yourdomain.com/validate \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'
```

---

## Troubleshooting

### Deployment Failed: "Authentication error"

**Problem:** Not logged in to Cloudflare

**Solution:**
```bash
npx wrangler login
# Complete browser authentication
```

### Deployment Failed: "KV namespace not found"

**Problem:** KV namespace IDs in `wrangler.jsonc` don't exist

**Solution:**
```bash
# List your namespaces
npx wrangler kv namespace list

# Update wrangler.jsonc with correct IDs
# See CLOUDFLARE_SETUP.md
```

### Worker Returns 500 Error

**Problem:** Runtime error in worker

**Solution:**
```bash
# Check logs
npx wrangler tail

# Look for error events
```

Common causes:
- Missing KV binding (check `wrangler.jsonc`)
- Invalid configuration JSON
- Model loading failure (non-critical)

### "markov_models_not_found" in Logs

**Problem:** Markov models not uploaded to KV

**Impact:** Worker functions, but Markov detection disabled

**Solution:**
```bash
# Train and upload models
npm run cli train:markov --upload --remote

# Or skip if not needed yet
# Other detectors still work at 85-90% accuracy
```

### High Response Times (>100ms)

**Problem:** Logging too verbose

**Solution:**
```bash
# Update config to reduce logging
curl -X PUT https://your-worker.workers.dev/admin/config \
  -H "X-API-Key: your-admin-key" \
  -H "Content-Type: application/json" \
  -d '{"logging": {"logAllValidations": false, "logLevel": "warn"}}'
```

### Configuration Changes Not Applied

**Problem:** KV cache not cleared

**Solution:**
```bash
# Wait 60 seconds (KV TTL), or
# Update config via Admin API (auto-clears cache), or
# Redeploy worker
npm run deploy
```

---

## Deployment Checklist

Use this checklist for your first deployment:

### Pre-Deployment
- [ ] Node.js v18+ installed
- [ ] Repository cloned
- [ ] Dependencies installed (`npm install`)
- [ ] Tests passing (`npm test`)
- [ ] Cloudflare account created
- [ ] Wrangler authenticated (`npx wrangler whoami` works)
- [ ] KV namespaces created
- [ ] Namespace IDs in `wrangler.jsonc`

### Deployment
- [ ] Deployed successfully (`npm run deploy`)
- [ ] Worker URL received
- [ ] Basic validation test passes

### Optional Configuration
- [ ] Configuration uploaded to KV
- [ ] Configuration verified (`kv:get config.json`)
- [ ] Admin API key created (if needed)
- [ ] Models trained (if datasets available)
- [ ] Models uploaded to KV

### Post-Deployment
- [ ] All detector tests pass
- [ ] Logs show successful validations
- [ ] Response times acceptable (<50ms)
- [ ] Custom domain configured (if desired)

---

## Next Steps

After successful deployment:

1. **Monitor Analytics:**
   ```bash
   npm run cli analytics:stats --last 24
   ```

2. **Set Up Alerts:**
   - Cloudflare Workers Dashboard → Your Worker → Alerts
   - Configure alerts for error rates, latency

3. **Integrate with Your App:**
   - See [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md)
   - Add to signup flows
   - Configure webhooks

4. **Train Custom Models:**
   - See [DATASETS.md](DATASETS.md)
   - Collect production data
   - Retrain models monthly

5. **Optimize Configuration:**
   - Monitor false positive/negative rates
   - Adjust thresholds based on data
   - Use A/B testing for changes

---

## Quick Reference Commands

```bash
# Deploy
npm run deploy

# Test
curl -X POST https://your-worker.workers.dev/validate \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'

# View logs
npx wrangler tail

# Upload config
npm run cli config:sync --remote

# Train models
npm run cli train:markov --upload --remote

# Check deployment
npx wrangler deployments list
```

---

**Need Help?**
- [Getting Started Guide](GETTING_STARTED.md)
- [Datasets Guide](DATASETS.md)
- [Troubleshooting](GETTING_STARTED.md#troubleshooting)
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
