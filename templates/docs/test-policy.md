# Test Policy

## Daily / PR

- Run `npx firestack test --ci --profile staging`.
- Focus on unit + integration in emulator context and low-cost smoke checks.

## Staging Smoke

- Run `npx firestack test --staging --profile staging`.
- Validate provider contract and traceability with low volume.

## Weekly Extended

- Run `npx firestack test --staging --full --profile staging`.
- Enable observability level 3 with bounded polling and message caps.
