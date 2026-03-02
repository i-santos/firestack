# FireStack (Standalone)

CLI para padronizar execução de testes e bootstrap de infra em projetos Firebase, com foco em paridade local/CI.

## Modelo

- Repositório do pacote (`@i-santos/firestack`): CI/release do npm package.
- Projetos alvo: recebem workflows/docs/config via `firestack init`.
- Branch model do pacote (create-package-starter): `main` + `release/beta`.

## Comandos

```bash
npx firestack install
npx firestack init
npx firestack docker init
npx firestack test --ci
npx firestack test --integration
npx firestack test --e2e --full
```

## `install`

- inicializa arquivos base (`firestack.config.json`, `vitest.config.mjs`, `playwright.config.mjs`, `tests/Dockerfile`, workflows/docs templates)
- adiciona `vitest` e `@playwright/test` em `devDependencies`
- roda `npm install`
- roda `playwright install chromium`

## `init`

Cria scaffold padrão para app repo:

- `firestack.config.json`
- `vitest.config.mjs`
- `playwright.config.mjs`
- `tests/Dockerfile` e `.dockerignore`
- `.github/workflows/*` (quality gate, staging, production, weekly)
- `docs/*` (policy, env/secrets, runbook)

## `test`

Executa suites definidas em `firestack.config.json`.

Escopos:

- `--unit`
- `--integration`
- `--e2e` (smoke/full)
- `--staging` (smoke/full)
- `--ci` (unit + integration + e2e smoke)

Stack padrão v3 beta:

- Unit/Integration: Vitest
- E2E: Playwright

### Serviços de teste (paridade local/CI)

`firestack test` suporta `test.services` no config. Exemplo padrão: MailHog para integração/CI.

```json
{
  "test": {
    "services": {
      "integration": [{ "name": "mailhog", "smtpPort": 1025, "httpPort": 8025 }],
      "ci": [{ "name": "mailhog", "smtpPort": 1025, "httpPort": 8025 }]
    }
  }
}
```

O runner sobe/aguarda/derruba os serviços automaticamente, com variáveis injetadas (`MAILHOG_HOST`, `MAILHOG_PORT`, `MAILHOG_API_BASE_URL`).

### Configuração de ambiente

A v3 reduz escopo de arquivos `.env.*` gerados pelo Firestack.

- Não há mais comando `firestack env` no fluxo padrão.
- `--profile` continua disponível para seleção de contexto de execução.
- Variáveis devem vir do ambiente do processo/CI e secrets de workflow.

## Docker

`firestack test --docker` mantém o contrato semântico de execução e usa o mesmo `firestack.config.json`.

## Release (Changesets + create-package-starter)

Comandos oficiais do pacote:

```bash
npm run check
npm run changeset
npm run version-packages
npm run release
npm run beta:enter
npm run beta:version
npm run beta:publish
```

Fluxo do pacote:

1. Crie changeset na PR.
2. Merge em `release/beta` (beta) ou `main` (stable).
3. Workflow `release.yml` abre/atualiza PR `chore: release packages`.
4. Merge da PR de release publica no npm.

Pre-req de publicação:

- npm Trusted Publishing para `i-santos/firestack`
- workflow: `.github/workflows/release.yml`
- branches: `release/beta` e `main`
- auth de automação via `GH_APP_CLIENT_ID` + `GH_APP_PRIVATE_KEY`
