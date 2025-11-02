# Legacy Scripts

This directory contains scripts that have been superseded by the unified CLI system or proper test suite.

## Files

### Training
- **train-markov.ts** - Original Markov Chain training script
  - **Superseded by**: `npm run cli train:markov`
  - **Why migrated**: Integrated into CLI with better error handling, progress tracking, and KV upload support

### Testing
- **test-complete-integration.ts** - Manual integration test for all detectors
  - **Superseded by**: `npm test` (vitest test suite)
  - **Why migrated**: Proper vitest tests are faster, more maintainable, and CI/CD ready

- **test-detectors.js** - Quick detector testing script
  - **Superseded by**: `npm run cli test:detectors`
  - **Why migrated**: CLI provides better output formatting and error handling

### Data Generation
- **generate-fraudulent-emails.js** - Test data generation
  - **Superseded by**: `npm run cli test:generate`
  - **Why migrated**: CLI interface with better argument parsing

## Migration Benefits

✅ **Unified Interface**: Single `npm run cli` entry point
✅ **Better UX**: Color-coded output, progress bars, help text
✅ **Type Safety**: TypeScript throughout
✅ **Error Handling**: Consistent error messages
✅ **Extensibility**: Easy to add new commands

## Recommended Approach

### For Training
```bash
npm run cli train:markov --upload --remote
```

### For Testing
```bash
npm test                    # Run all vitest tests
npm run cli test:detectors  # Quick detector check
npm run cli test:api        # Test live API
```

### For Data Generation
```bash
npm run cli test:generate --count 100
```

---

**See**: `cli/README.md` for complete CLI documentation
