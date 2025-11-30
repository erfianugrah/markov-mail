# Integration Examples

The `examples/integrations/` directory contains small snippets that show how to call the Worker from various stacks (Express, Next.js App Router, Cloudflare Worker RPC, etc.). They all rely on the same decision-tree middleware exposed at `/validate`.

Legacy configuration samples were removed with this reset. Check the git history (pre-reset tags) if you need them.

## Available integrations

- `integrations/express.js` – adds fraud checks to a Node/Express API.
- `integrations/nextjs.tsx` – validates emails inside a Next.js App Router action.
- `integrations/cloudflare-workers.ts` – demonstrates Worker-to-Worker RPC usage.

Each file is self-contained—copy it into your project and replace the placeholder URLs/API keys with real values. For request/response details, see [`docs/API_DECISION_TREE.md`](../docs/API_DECISION_TREE.md).
