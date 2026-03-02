# Contributing

## Local setup

1. Install dependencies: `npm ci`
2. Run checks: `npm run check`

## Release process

1. Add a changeset in each release-impacting PR: `npm run changeset`.
2. Merge PRs into `main`.
3. `.github/workflows/release.yml` opens/updates `chore: release packages`.
4. Merge the release PR to publish.

## Trusted Publishing

If the package does not exist on npm yet, the first publish can be manual:

```bash
npm publish --access public
```

After first publish, configure npm Trusted Publisher with:

- owner
- repository
- workflow file (`.github/workflows/release.yml`)
- branch (`main`)
