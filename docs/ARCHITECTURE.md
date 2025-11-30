# Architecture (Reset)

The legacy architecture docs covered heavy ensembles, calibration layers, and online learning. None of that code remains on this branch. Until the new decision-tree pipeline is fully spec’d, the high-level story is:

1. **Cloudflare Worker (`src/`)** – parses requests, builds a feature vector, fetches `decision_tree.json` from KV, evaluates it, and logs to D1.
2. **Dashboard** – rebuilt with Astro + React, builds to `public/dashboard/` with modern analytics UI including real-time metrics, model comparison, and query builder.
3. **Offline tooling (CLI)** – export features, train a tree with scikit-learn (via Python subprocess), convert to JSON, and upload to KV.

Once the offline workflow solidifies we’ll expand this document with a proper diagram again. For now see:

- `README.md` for the project snapshot
- `docs/DECISION_TREE.md` for the new scoring plan
