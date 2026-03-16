#!/usr/bin/env bash
set -euo pipefail

# Markov Mail — First-time setup script
# Creates Cloudflare resources (KV, D1) and updates wrangler.jsonc with the IDs.
# Run once after cloning the repo. Requires: wrangler CLI authenticated.

echo "=== Markov Mail Setup ==="
echo ""

# Check wrangler is available
if ! command -v wrangler &> /dev/null && ! npx wrangler --version &> /dev/null 2>&1; then
    echo "ERROR: wrangler CLI not found. Run: npm install"
    exit 1
fi
WRANGLER="npx wrangler"

# 1. Create KV namespaces
echo "[1/5] Creating KV namespaces..."

CONFIG_OUT=$($WRANGLER kv namespace create CONFIG 2>&1)
CONFIG_ID=$(echo "$CONFIG_OUT" | grep -oP '"id":\s*"\K[^"]+' || echo "")

DISPOSABLE_OUT=$($WRANGLER kv namespace create DISPOSABLE_DOMAINS_LIST 2>&1)
DISPOSABLE_ID=$(echo "$DISPOSABLE_OUT" | grep -oP '"id":\s*"\K[^"]+' || echo "")

TLD_OUT=$($WRANGLER kv namespace create TLD_LIST 2>&1)
TLD_ID=$(echo "$TLD_OUT" | grep -oP '"id":\s*"\K[^"]+' || echo "")

if [ -z "$CONFIG_ID" ] || [ -z "$DISPOSABLE_ID" ] || [ -z "$TLD_ID" ]; then
    echo "ERROR: Failed to create KV namespaces. Check wrangler auth."
    echo "CONFIG: $CONFIG_OUT"
    echo "DISPOSABLE: $DISPOSABLE_OUT"
    echo "TLD: $TLD_OUT"
    exit 1
fi

echo "  CONFIG:                  $CONFIG_ID"
echo "  DISPOSABLE_DOMAINS_LIST: $DISPOSABLE_ID"
echo "  TLD_LIST:                $TLD_ID"

# 2. Create D1 database
echo ""
echo "[2/5] Creating D1 database..."

DB_OUT=$($WRANGLER d1 create markov-db 2>&1)
DB_ID=$(echo "$DB_OUT" | grep -oP '"database_id":\s*"\K[^"]+' || echo "")

if [ -z "$DB_ID" ]; then
    # Try alternate format
    DB_ID=$(echo "$DB_OUT" | grep -oP 'database_id.*:\s*\K[a-f0-9-]+' || echo "")
fi

if [ -z "$DB_ID" ]; then
    echo "WARNING: Could not parse D1 database ID. You may need to create it manually."
    echo "Output: $DB_OUT"
    DB_ID="YOUR_D1_DATABASE_ID"
fi

echo "  Database ID: $DB_ID"

# 3. Update wrangler.jsonc with actual IDs
echo ""
echo "[3/5] Updating wrangler.jsonc..."

if [ -f wrangler.jsonc ]; then
    # Use sed to replace placeholder/existing IDs
    sed -i "s/\"id\": \"CONFIG_KV_NAMESPACE_ID\"/\"id\": \"$CONFIG_ID\"/" wrangler.jsonc
    sed -i "s/\"id\": \"DISPOSABLE_DOMAINS_KV_NAMESPACE_ID\"/\"id\": \"$DISPOSABLE_ID\"/" wrangler.jsonc
    sed -i "s/\"id\": \"TLD_LIST_KV_NAMESPACE_ID\"/\"id\": \"$TLD_ID\"/" wrangler.jsonc
    sed -i "s/\"database_id\": \"D1_DATABASE_ID\"/\"database_id\": \"$DB_ID\"/" wrangler.jsonc
    echo "  Updated wrangler.jsonc with resource IDs"
else
    echo "  WARNING: wrangler.jsonc not found"
fi

# 4. Apply migrations
echo ""
echo "[4/5] Applying D1 migrations..."

$WRANGLER d1 migrations apply markov-db --remote 2>&1 || echo "WARNING: Migration failed. You may need to apply manually."

# 5. Set API key secret
echo ""
echo "[5/5] Setting API key..."
echo "  Generate a key: openssl rand -hex 32"
echo "  Then run: npx wrangler secret put X-API-KEY"
echo ""

# 6. Upload initial config + model to KV
echo "=== Uploading initial config and model to KV ==="

$WRANGLER kv key put config.json --path config/production/config.json \
    --namespace-id "$CONFIG_ID" --remote 2>&1 && echo "  Uploaded config.json" || echo "  WARNING: config upload failed"

$WRANGLER kv key put random_forest.json --path config/production/random-forest.json \
    --namespace-id "$CONFIG_ID" --remote 2>&1 && echo "  Uploaded random_forest.json" || echo "  WARNING: model upload failed"

# 7. Optional: set up Python venv for offline training
echo ""
echo "[6/6] Setting up Python environment (optional)..."
if command -v python3 &> /dev/null; then
    if [ ! -d "venv" ]; then
        python3 -m venv venv 2>/dev/null && \
        source venv/bin/activate 2>/dev/null && \
        pip install -q -r requirements.txt 2>/dev/null && \
        echo "  Python venv created and dependencies installed" || \
        echo "  WARNING: Python venv setup failed (optional — only needed for offline training)"
    else
        echo "  Python venv already exists"
    fi
else
    echo "  Python not found (optional — container pipeline uses TypeScript instead)"
fi

echo ""
echo "=== Setup complete! ==="
echo ""
echo "Next steps:"
echo "  1. Set your API key:    npx wrangler secret put X-API-KEY"
echo "  2. Set custom domain:   Edit 'routes' in wrangler.jsonc (or remove for *.workers.dev)"
echo "  3. Build dashboard:     npm run build:dashboard"
echo "  4. Deploy:              npm run deploy"
echo "  5. Test:                curl -X POST https://your-worker.dev/validate -H 'Content-Type: application/json' -d '{\"email\":\"test@example.com\"}'"
echo ""
echo "After deploying, open the dashboard and read docs/TUNING.md to learn"
echo "how to improve accuracy by correcting labels and adjusting thresholds."
