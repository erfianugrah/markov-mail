FROM oven/bun:1-slim

WORKDIR /app

# Preserve repo-relative paths so ../src/ resolves identically
# in both Docker and local (`bun run container/train.ts`) contexts
COPY container/train.ts ./container/train.ts
COPY container/package.json ./package.json
COPY src/training/ ./src/training/
COPY src/detectors/forest-engine.ts ./src/detectors/forest-engine.ts

# Install dependencies (none expected, but keeps the pattern for future use)
RUN bun install --frozen-lockfile 2>/dev/null || bun install

EXPOSE 8787

CMD ["bun", "run", "container/train.ts"]
