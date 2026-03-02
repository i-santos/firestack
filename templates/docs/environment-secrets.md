# Environment and Secrets

## Branch Mapping

- `develop` -> `staging`
- `main` -> `production`

## Secret Scope

- Keep staging and production secrets isolated.
- Use GitHub Environments with approval gates for `production`.

## Baseline Variables

- `GCLOUD_PROJECT`
- `E2E_BASE_URL`
- `BREVO_API_KEY`
- `MAILOSAUR_API_KEY` or `MAILTRAP_API_TOKEN`
- `FIREBASE_SERVICE_ACCOUNT` (JSON credential for deploy workflow)
- `FIREBASE_DEPLOY_TARGETS` (environment variable, optional; ex: `hosting,functions`)
