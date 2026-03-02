# Contributing

## Local setup

1. Install dependencies: `npm ci`
2. Run checks: `npm run check`

## Release process

1. Add a changeset in each release-impacting PR: `npm run changeset`.
2. Merge PRs into the correct track:
- `release/beta` for beta/staging.
- `main` for stable/production.
3. `.github/workflows/release.yml` opens/updates `chore: release packages`.
4. Only `chore: release packages` commits publish (PR-first model).
5. `release/beta` publishes beta track and `main` publishes stable track.

## Trusted Publishing

If the package does not exist on npm yet, the first publish can be manual:

```bash
npm publish --access public
```

After first publish, configure npm Trusted Publisher with:

- owner
- repository
- workflow file (`.github/workflows/release.yml`)
- branches (`release/beta` and `main`)

## Environments

- App environment/deploy workflows are shipped as starter templates under `templates/workflows/`.
- This package repository should keep only package CI/release workflows.
