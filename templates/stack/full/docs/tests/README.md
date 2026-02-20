# Test Stack Template (Placeholder)

This folder is a starter blueprint installed by `firestack install --stack full`.

## What is included

- `firestack/tests/unit/example.unit.test.ts`
- `firestack/tests/integration/example.integration.test.ts`
- `firestack/tests/e2e/example.e2e.spec.ts`
- `firestack/tests/integration/Dockerfile`
- runners under `firestack/scripts/run-*.mjs`

## How to customize

1. Replace placeholder tests with project-specific scenarios.
2. Keep naming conventions:
   - unit: `*.test.ts`
   - integration: `*.integration.test.ts`
   - e2e: `*.e2e.spec.ts`
3. Keep E2E tags for suite routing:
   - smoke tests must include `@smoke`
   - full tests must include `@full`

## Default commands

- `npm run fs:env -- --development`
- `npm run fs:test`
- `npm run fs:test -- --ci --docker`
- `npm run fs:test -- --integration`
- `npm run fs:test -- --e2e --full`
