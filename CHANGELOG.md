# Changelog

## 3.0.0-beta.1

### Patch Changes

- 299e046: Refactor v3 beta test stack to Vitest for unit/integration, simplify env handling, and add test service orchestration (MailHog) for local/CI parity.

## 3.0.0-beta.0

### Major Changes

- Start Firestack v3 beta with develop/main branch strategy, environment-based workflows, and PR-first release orchestration.

  Breaking change details:

  - `develop` becomes the beta/staging branch and `main` becomes the stable/production branch.
  - Release automation is now PR-first by default across both tracks.
  - New staging/production/weekly workflow contracts define environment-scoped execution.

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
