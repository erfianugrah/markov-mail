# Scripts Directory

This directory previously contained utility scripts that have been migrated to the unified CLI system.

## Migration Status

All scripts have been moved to the CLI. See `cli/README.md` for the new interface.

### Old Scripts → New CLI Commands

| Old Script | New CLI Command |
|------------|----------------|
| `generate-fraudulent-emails.js` | `npm run cli test:generate` |
| `test-detectors.js` | `npm run cli test:detectors` |
| `train-markov.ts` | `npm run cli train:markov` |
| `test-complete-integration.ts` | `npm test` (vitest) |

## CLI Usage

```bash
# Show all available commands
npm run cli

# Get help for specific command
npm run cli <command> -- --help

# Examples
npm run cli train:markov
npm run cli test:generate --count 100
npm run cli deploy --minify
```

## Legacy Scripts

Old scripts are preserved in `scripts/legacy/` for reference.

---

**For current usage, see**: `cli/README.md`
