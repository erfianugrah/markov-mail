# Decision-Tree Training Guide

The reset branch keeps training offline and intentionally boring: export features, train a lightweight tree, upload JSON to KV. This page stitches those steps together so you can replace the sample model with a real one in under an hour.

## 0. Prerequisites

- `npm install` already run (the CLI reuses the workspace dependencies)
- Python 3.9+ available for the training script (virtual env recommended)
- Labeled CSV with at least two columns: `email` and `label` (`1`/`0`, `fraud`/`legit`, or anything coercible to a number)

> Tip: keep the raw dataset under `data/` (e.g., `data/main.csv`) so the repo-relative defaults “just work.”

## 1. Export engineered features

Use the Bun CLI to mirror the runtime feature vector:

```bash
npm run cli features:export -- \
  --input data/main.csv \
  --output data/features/export.csv \
  --label-column label \
  --include-email       # optional, handy for auditing
```

What you get:

- A CSV where every column (except `label`/`email`) maps 1:1 to `src/utils/feature-vector.ts`
- Booleans already normalized to `0/1`
- Consistent entropy, plus-addressing, linguistic, structural, identity, geo-consistency, MX, and domain features between training + production

Sanity-check the output before training:

```bash
head -n 5 data/features/export.csv | column -t -s,
```

Regenerate this file any time you add/remove features in TypeScript—don’t hand-edit it.

> MX lookups happen via Cloudflare’s DNS-over-HTTPS endpoint so the tree can learn “provider fingerprints” (Google Apps vs. self-hosted, etc.). If you’re exporting in an environment without outbound network access, pass `--skip-mx` so those columns are zeroed rather than failing the run.

## 2. Train + export the tree

We ship a tiny reference trainer in `ml/export_tree.py`. Feel free to swap it out, but the defaults are tuned for ≤10 depth trees that keep latency sub-millisecond.

```bash
cd ml
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt  # create if you need pinned deps

python export_tree.py \
  --dataset ../data/features/export.csv \
  --output ../config/production/decision-tree.$(date +%F).json \
  --max-depth 6 \
  --min-samples-leaf 50
```

Inspect the JSON (each node/leaf should include `type`/`feature`/`reason`). Keep it in `config/production/` so it’s versioned alongside the Worker.

> Prefer automation? `npm run tree:train -- --upload` runs the exporter, Python trainer, and (optionally) uploads the resulting tree to KV in one go. Pass `--skip-mx` if you’re exporting features in an offline environment.

## 3. Upload to KV

Once you’re happy with the artifact, upload it to the `CONFIG` namespace under the well-known key `decision_tree.json`:

```bash
npm run cli kv:put -- \
  --binding CONFIG \
  decision_tree.json \
  --file config/production/decision-tree.2025-01-15.json
```

Cold starts will pick up the new tree automatically. Hot isolates refresh the cache every ~60 seconds, or immediately if you redeploy/restart `wrangler dev`.

## 4. Verify end-to-end

1. Call the Worker via `npm run cli test:api -- --url https://your-worker.workers.dev/validate --email scam@domain.tld`.
2. Check the logs/D1 row for `modelVersion` and `decisionTreeReason` to confirm the leaf reason matches expectations.
3. Repeat with a legitimate email to ensure both block + allow paths look healthy.

## 5. Iterate

- Need more features? Update `src/utils/feature-vector.ts` + `cli/commands/features/export.ts` together, regenerate the dataset, retrain.
- Want ensembles/gradient boosting? Distill the final scorer down to the JSON schema described in `docs/DECISION_TREE.md` (multiple trees can be encoded if you average leaves yourself).
- Ship every meaningful model to git (`config/production/decision-tree.*.json`) so operators can diff paths between releases.
