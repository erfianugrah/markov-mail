# Contributing Guide

**Version**: 3.0.1
**Last Updated**: 2025-12-01

Guidelines for contributing to the Markov Mail fraud detection system, including code standards, testing practices, and development workflow.

## Table of Contents

- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Testing Guidelines](#testing-guidelines)
- [Commit and Pull Request Guidelines](#commit-and-pull-request-guidelines)
- [Security and Configuration](#security-and-configuration)

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- Bun runtime (for CLI tools)
- Python 3.8+ (for model training)
- Wrangler CLI (Cloudflare Workers)
- Git

### Setup

```bash
# 1. Clone repository
git clone https://github.com/yourusername/markov-mail
cd markov-mail

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your API keys

# 4. Run type checking
npm run typecheck

# 5. Run tests
npm test
```

### Development Environment

```bash
# Start worker locally
npm run dev

# Start dashboard (separate terminal)
cd dashboard
npm install
npm run dev

# Run CLI commands
npm run cli -- <command>
```

## Project Structure

### Module Organization

- **`src/`**: Cloudflare Worker runtime
  - `detectors/`: Feature extraction and fraud detection logic
  - `middleware/`: Request processing and scoring
  - `routes/`: API endpoints
  - `services/`: Shared business logic
  - `utils/`: Utility functions
  - `test-utils/`: Testing helpers

- **`dashboard/`**: Vite/React analytics UI
  - `src/components/`: React components
  - `src/lib/`: Utilities and hooks
  - `public/`: Static assets
  - Deploys to `public/dashboard/`

- **`cli/`**: Bun-powered automation
  - `commands/`: CLI command implementations
  - `index.ts`: CLI entry point

- **`tests/`**: Test suites
  - Mirrors `src/` structure
  - Unit, integration, and E2E tests

- **`config/`**: Configuration and models
  - `production/`: Production artifacts
  - Model JSON files
  - Config files

- **`docs/`**: Documentation
  - Architecture, training, operations guides

### File Organization

Keep files organized by domain:
- Detector implementations: `src/detectors/`
- Middleware: `src/middleware/`
- Training scripts: `scripts/`
- CLI commands: `cli/commands/`

Use **kebab-case** for filenames:
- `pattern-analyzer.ts`
- `fraud-detection.ts`
- `export-features.ts`

## Development Workflow

### Feature Development

1. **Create feature branch**:
```bash
git checkout -b feature/your-feature-name
```

2. **Make changes**:
- Follow [Coding Standards](#coding-standards)
- Add tests for new functionality
- Update documentation

3. **Run checks**:
```bash
# Type check
npm run typecheck

# Run tests
npm test

# Run specific test suite
npm run test:unit
npm run test:e2e
```

4. **Commit changes**:
- Follow [Commit Guidelines](#commit-and-pull-request-guidelines)
- Use conventional commit format

5. **Submit pull request**:
- Include description of changes
- Link related issues
- Add test results
- Request review

### Bug Fixes

1. **Reproduce bug**: Write failing test first
2. **Fix issue**: Implement fix
3. **Verify**: Ensure test passes
4. **Document**: Update CHANGELOG.md

### Model Updates

1. **Train new model**:
```bash
npm run pipeline -- \
  --dataset data/main.csv \
  --export-modes full \
  --search '[{"label":"test","nTrees":20}]' \
  --min-recall 0.90 \
  --max-fpr 0.05
```

2. **Validate locally**:
```bash
npm run dev
npm run cli -- test:batch -- \
  --input data/validation.csv \
  --endpoint http://localhost:8787/validate
```

3. **Document changes**: Update CHANGELOG.md with model version and metrics

4. **Deploy**: Follow [OPERATIONS.md](./OPERATIONS.md) deployment process

## Coding Standards

### TypeScript

- **ES2022 modules** everywhere
- **Prefer named exports** over default exports
- **Type all bindings** through `global.d.ts`
- **Avoid `any`** - use proper types

**Example**:
```typescript
// Good
export function analyzePattern(email: string): PatternAnalysis {
  // ...
}

// Bad
export default function(email: any): any {
  // ...
}
```

### Formatting

- **Tabs in Worker code** (`src/`, `cli/`)
- **Two spaces in dashboard** files
- **Single quotes** except for template literals
- **Trailing commas** in multi-line structures

### Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| Files | kebab-case | `pattern-analyzer.ts` |
| Classes | PascalCase | `PatternAnalyzer` |
| Functions | camelCase | `analyzePattern()` |
| Constants | UPPER_SNAKE_CASE | `MX_LOOKUP_TIMEOUT` |
| Interfaces | PascalCase | `FeatureVector` |
| Types | PascalCase | `RiskScore` |

### Code Organization

```typescript
// 1. Imports (external first, then internal)
import { Context } from 'hono';
import { analyzePattern } from './pattern-analyzer';

// 2. Constants
const MAX_RETRIES = 3;

// 3. Types/Interfaces
interface AnalysisResult {
  score: number;
  reason: string;
}

// 4. Functions (exported first, then internal)
export async function processEmail(email: string): Promise<AnalysisResult> {
  const pattern = await analyzePattern(email);
  return formatResult(pattern);
}

function formatResult(pattern: Pattern): AnalysisResult {
  // Internal helper
}
```

### Comments

- **JSDoc for public APIs**:
```typescript
/**
 * Analyzes email pattern for fraud indicators
 * @param email - Email address to analyze
 * @returns Pattern analysis with risk scores
 */
export function analyzePattern(email: string): PatternAnalysis {
  // ...
}
```

- **Inline comments for complex logic**:
```typescript
// Pre-fetch MX records for all unique domains to avoid
// repeated DNS lookups during feature extraction
const mxCache = await prefetchMXRecords(domains);
```

- **Avoid obvious comments**:
```typescript
// Bad
// Set score to 0
score = 0;

// Good (no comment needed - code is self-explanatory)
score = 0;
```

## Testing Guidelines

### Test Organization

Place tests in `tests/` mirroring `src/` structure:
```
src/detectors/pattern-analyzer.ts
tests/detectors/pattern-analyzer.test.ts
```

### Test Categories

#### Unit Tests
```bash
npm run test:unit
```

Test individual functions/classes in isolation:
```typescript
import { describe, it, expect } from 'vitest';
import { analyzePattern } from '../src/detectors/pattern-analyzer';

describe('PatternAnalyzer', () => {
  it('should detect sequential patterns', () => {
    const result = analyzePattern('test123@example.com');
    expect(result.hasSequential).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it('should handle edge cases', () => {
    const result = analyzePattern('a@b.c');
    expect(result).toBeDefined();
  });
});
```

#### Integration Tests
```bash
npm run test:e2e
```

Test component interactions:
```typescript
import { env, createExecutionContext } from 'cloudflare:test';
import worker from '../src/index';

describe('Fraud Detection API', () => {
  it('should validate email and return risk score', async () => {
    const request = new Request('http://localhost/validate', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com' }),
    });

    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty('riskScore');
    expect(data).toHaveProperty('action');
  });
});
```

#### Performance Tests
```bash
npm run test:performance
```

Test latency and throughput.

### Test Utilities

Use helpers from `src/test-utils/`:
```typescript
import { createMockEnv, createMockEmail } from '../src/test-utils';

const env = createMockEnv();
const email = createMockEmail({ domain: 'gmail.com', pattern: 'sequential' });
```

### Coverage Requirements

- **Maintain ≥90% statement coverage**
- Run `npm run test:coverage` before PRs
- Focus on critical paths:
  - Detectors
  - Scoring logic
  - Config management

### Cloudflare Workers Pool

For tests needing KV/D1 access:
```bash
VITEST_CLOUDFLARE_POOL=on npm test
```

Or in specific test files:
```typescript
// @vitest-environment cloudflare-workers
import { describe, it } from 'vitest';
```

### Fixtures

Store test data in `tests/e2e/fixtures/`:
```
tests/e2e/fixtures/
├── emails-legit.json
├── emails-fraud.json
└── feature-vectors.csv
```

## Commit and Pull Request Guidelines

### Commit Messages

Follow conventional commit format:

```
type(scope): subject

[optional body]

[optional footer]
```

**Types**:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `refactor`: Code refactoring
- `test`: Test additions/changes
- `chore`: Tooling, dependencies

**Examples**:
```
feat(detectors): add n-gram naturalness detector

Implements multilingual n-gram analysis to detect gibberish patterns
in email local parts. Includes bigram and trigram scoring with
confidence intervals.

feat(training): add adaptive hyperparameter search

fix(mx-lookup): increase timeout to 1500ms

Resolves production feature mismatch where MX lookups were timing out,
causing 18% performance degradation.

Fixes #123

docs: update operations guide with automation workflow

test(detectors): add edge cases for pattern analyzer

chore: upgrade dependencies
```

### Commit Best Practices

1. **Keep commits focused**: One logical change per commit
2. **Write clear subjects**: Imperative mood, under 72 characters
3. **Provide context**: Explain why, not just what
4. **Reference issues**: Use `Fixes #123` or `Closes #456`

### Pull Requests

#### PR Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
Describe tests performed:
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual testing completed

## Validation Commands
```bash
npm run typecheck
npm test
npm run test:coverage
```

## Risk Assessment
- Risk level: Low/Medium/High
- Impact area: Detectors/Scoring/API/Dashboard

## Screenshots (if applicable)
Add screenshots for UI changes

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Comments added for complex logic
- [ ] Documentation updated
- [ ] Tests added/updated
- [ ] CHANGELOG.md updated
```

#### PR Review Process

1. **Automated checks**: CI must pass (typecheck, tests, build)
2. **Code review**: At least one approval required
3. **Testing**: Reviewer validates test coverage
4. **Documentation**: Verify docs updated if needed

#### PR Size Guidelines

- **Small** (<200 lines): Preferred
- **Medium** (200-500 lines): Acceptable
- **Large** (>500 lines): Break into smaller PRs if possible

## Security and Configuration

### Secrets Management

**Never commit secrets to git**:
- `.dev.vars` is gitignored
- Use `.dev.vars.example` as template
- Store production secrets in Wrangler

**Secrets Checklist**:
- [ ] No API keys in code
- [ ] No passwords in commits
- [ ] No tokens in logs
- [ ] Sensitive data in .gitignore

### Configuration Changes

When modifying configs:

1. **Local first**: Test in `.dev.vars` and `config/development/`
2. **Document**: Note new variables in `docs/CONFIGURATION.md`
3. **Bindings**: Declare in `wrangler.jsonc`
4. **Rollback**: Document rollback procedure

### Sensitive Data

**Never commit**:
- Email addresses (PII)
- Production logs
- User data exports
- API responses with identifiable information

**Verify gitignore**:
```bash
# Check for accidentally staged sensitive files
git status
git diff --cached

# Remove from staging if needed
git reset HEAD <file>
```

**Data exports**: Already gitignored:
- `data*` (all data files)
- `*.archive.json`
- `validations_*.json`
- `d1-validations.json`

## Documentation

### When to Update Docs

Update documentation when:
- Adding new features
- Changing APIs
- Modifying configuration
- Updating deployment process
- Fixing significant bugs

### Documentation Standards

1. **Keep docs current**: Update version and date
2. **Use examples**: Include code samples
3. **Link properly**: Use relative paths for cross-references
4. **Test commands**: Verify all command examples work
5. **Add diagrams**: Use Mermaid for visual explanations

### Documentation Files

| File | Purpose | Update When |
|------|---------|-------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System design | Architecture changes |
| [MODEL_TRAINING.md](./MODEL_TRAINING.md) | Training workflow | Model/training changes |
| [DETECTORS.md](./DETECTORS.md) | Feature reference | New detectors/features |
| [SCORING.md](./SCORING.md) | Risk scoring | Scoring logic changes |
| [CONFIGURATION.md](./CONFIGURATION.md) | Setup guide | Config changes |
| [OPERATIONS.md](./OPERATIONS.md) | Ops procedures | Deployment changes |
| [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | Problem solving | New issues/fixes |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | This file | Process changes |

## Release Process

### Version Numbering

Follow semantic versioning (MAJOR.MINOR.PATCH):
- **MAJOR**: Breaking changes
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes

### Release Checklist

- [ ] All tests pass
- [ ] Documentation updated
- [ ] CHANGELOG.md updated
- [ ] Version bumped in package.json
- [ ] Model artifacts archived
- [ ] Production validation complete
- [ ] Rollback plan documented

### CHANGELOG Updates

Add entries to `CHANGELOG.md`:

```markdown
## [3.1.0] - 2025-12-01

### Added
- Enhanced typosquatting detection with 393 domain variants
- Hybrid MX resolution with well-known provider cache

### Changed
- Increased MX lookup timeout from 350ms to 1500ms
- Updated training dataset to 672K samples

### Fixed
- Feature extraction mismatch causing 18% performance degradation
```

## Getting Help

### Resources

- [Documentation](./README.md)
- [Troubleshooting Guide](./TROUBLESHOOTING.md)
- [Operations Guide](./OPERATIONS.md)

### Questions

- Create GitHub issue for bugs/features
- Use discussions for questions
- Review existing issues first

### Support

For production issues, see [OPERATIONS.md](./OPERATIONS.md#emergency-procedures).

---

**Last Updated**: 2025-12-01
**Version**: 3.0.1
