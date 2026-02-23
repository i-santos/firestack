# Changelog

## Unreleased

- `firestack test`: added deterministic Functions env parity for test processes.
  - Firestack now resolves Functions env files per module using:
    1. `<functions.source>/.env`
    2. `<functions.source>/.env.<GCLOUD_PROJECT>`
    3. `<functions.source>/.env.local`
  - The same merged result is injected into spawned test commands (integration/e2e/ci, docker and non-docker), reducing mismatches between test process env and Functions runtime env.
