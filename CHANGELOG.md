# Changelog

## 2.0.0

### Major Changes

- e7ab55f: Rename package scope to `@i-santos` and adopt the Changesets-only release workflow.

  Breaking change details:

  - What changed: the package name moved from `@igorsantos-dev/firestack` to `@i-santos/firestack`.
  - Why: align package identity with the standardized personal brand scope and the new release process.
  - How to migrate: update installs/usages from `@igorsantos-dev/firestack` to `@i-santos/firestack` in scripts and docs.

## Unreleased

- `firestack test`: added deterministic Functions env parity for test processes.
  - Firestack now resolves Functions env files per module using:
    1. `<functions.source>/.env`
    2. `<functions.source>/.env.<GCLOUD_PROJECT>`
    3. `<functions.source>/.env.local`
  - The same merged result is injected into spawned test commands (integration/e2e/ci, docker and non-docker), reducing mismatches between test process env and Functions runtime env.
