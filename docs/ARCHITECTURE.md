# Architecture (Reset)

The legacy architecture docs covered heavy ensembles, calibration layers, and online learning. None of that code remains on this branch. Until the new decision-tree pipeline is fully spec’d, the high-level story is:

1. **Cloudflare Worker (`src/`)** – parses requests, builds a feature vector, fetches `decision_tree.json` from KV, evaluates it, and logs to D1.
2. **Dashboard** – the React source tree was removed; a frozen bundle ships from `public/dashboard/` so operators can keep reading D1 until we rebuild the UI.
3. **Offline tooling (`ml/` + CLI)** – export features, train a tree in Python, convert it to JSON, and upload it to KV.

Once the offline workflow solidifies we’ll expand this document with a proper diagram again. For now see:

- `README.md` for the project snapshot
- `docs/DECISION_TREE.md` for the new scoring plan
