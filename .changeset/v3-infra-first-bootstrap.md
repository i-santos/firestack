---
"@i-santos/firestack": major
---

Start Firestack v3 beta with develop/main branch strategy, environment-based workflows, and PR-first release orchestration.

Breaking change details:

- `develop` becomes the beta/staging branch and `main` becomes the stable/production branch.
- Release automation is now PR-first by default across both tracks.
- New staging/production/weekly workflow contracts define environment-scoped execution.
