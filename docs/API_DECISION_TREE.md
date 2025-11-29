# Decision-Tree API Quickstart

A minimal reference for calling the reset Worker. The runtime no longer exposes any of the legacy controls—every POST body that includes an `email` field automatically flows through the decision-tree middleware.

## Endpoint

- `POST /validate` – explicit validation endpoint (kept for backward compatibility)
- Any other `POST /*` route – validated implicitly unless the handler sets `c.set('skipFraudDetection', true)`

## Request schema

```json
{
  "email": "user@example.com",
  "consumer": "signup_service",   // optional, logged to D1
  "flow": "REGISTRATION"          // optional, logged to D1
}
```

### cURL example

```bash
curl -X POST https://your-worker.workers.dev/validate \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: …' \  # only needed for /admin routes
  -d '{
    "email": "fraudster+promo@throwaway.zone",
    "consumer": "marketing_site",
    "flow": "NEWSLETTER"
  }'
```

## Response

```json
{
  "valid": false,
  "riskScore": 0.81,
  "decision": "block",
  "message": "Decision tree evaluation complete",
  "signals": {
    "decisionTreeReason": "plus_addressing_abuse",
    "decisionTreePath": [
      "plus_risk >= 0.55 :: left",
      "leaf"
    ],
    "tldRiskScore": 0.72,
    "domainReputationScore": 0.14,
    "linguisticSignals": {
      "pronounceability": 0.11,
      "syllableEstimate": 6
    },
    "structureSignals": {
      "segmentCount": 3,
      "segmentsWithoutVowelsRatio": 0.66
    },
    "statisticalSignals": {
      "localPartLength": 18,
      "digitRatio": 0.22
    }
  },
  "fingerprint": {
    "hash": "2cc0…",
    "country": "US",
    "asn": 13335,
    "botScore": 12
  },
  "metadata": {
    "version": "2.4.2",
    "modelVersion": "tree_2025-01-15"
  }
}
```

Key fields:

- `decision` – `allow`, `warn`, or `block` after threshold comparison
- `riskScore` – raw leaf value (`0..1`)
- `signals.decisionTreeReason` – human-readable explanation you encoded in the leaf
- `signals.decisionTreePath` – traversal trace, handy for debugging
- `metadata.modelVersion` – whatever metadata was returned by `CONFIG.getWithMetadata` when the tree was loaded

## Response headers

Non-admin endpoints echo the decision so upstreams don’t need to parse JSON if they don’t want to:

| Header | Description |
|--------|-------------|
| `X-Fraud-Decision` | `allow` / `warn` / `block`
| `X-Fraud-Risk-Score` | Risk score with two decimals |
| `X-Fraud-Reason` | Only present on HTTP 403 responses |
| `X-Model-Version` | Same as `metadata.modelVersion` |
| `X-Experiment-*` | Present when an A/B test is active |

## Skipping auto-validation

If you have a POST route that should opt-out (e.g., webhook ingest that lacks user-supplied emails), set `c.set('skipFraudDetection', true)` inside your handler before the middleware runs.

```ts
app.post('/webhooks/internal', async (c) => {
  c.set('skipFraudDetection', true);
  // …handle payload…
  return c.json({ ok: true });
});
```

## Admin helpers

Admin routes (`/admin/*`) stay the same—use the CLI or direct API calls to pull config, upload new trees, or query analytics. See [`docs/CONFIGURATION.md`](./CONFIGURATION.md) and [`docs/DECISION_TREE.md`](./DECISION_TREE.md) for the relevant payloads.
