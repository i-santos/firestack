# FireStack (Standalone)

Standalone repository layout for publishing `@igorsantos-dev/firestack`.

## Install in app projects

```bash
npm config set @igorsantos-dev:registry http://SEU_HOST:4873
npm i -D @igorsantos-dev/firestack
npx firestack install
```

`npx firestack install` agora instala stack completa por padrao (`--stack full`), incluindo:

- `firestack/tests/**` (unit/integration/e2e + helpers)
- `firestack/scripts/*` (runners, helpers e utilitarios)
- `firestack/playwright.config.ts`
- `firestack/docs/tests/README.md`
- `firestack/env/examples/.env*.example`
- `firestack/.gitignore` (escopo local do firestack)
- `firestack/config.json`
- scripts minimos no `package.json`: `fs:install`, `fs:env`, `fs:test`
- `devDependencies` base para E2E (`@playwright/test`)
- `npm install` automatico no projeto alvo
- install de browser E2E: `playwright install chromium`
- estrutura centralizada em `firestack/` na raiz do projeto alvo

Para modo leve (sem stack completa):

```bash
npx firestack install --stack base
```

Forcar sobrescrita:

```bash
npx firestack install --force
```

## CLI no projeto alvo

Gerar envs a partir dos examples:

```bash
npm run fs:env -- --development
npm run fs:env -- --staging --production
npm run fs:env -- --all
npm run fs:env -- --test-development --test-staging --force
```

Executar testes com um unico entrypoint:

```bash
npm run fs:test
npm run fs:test -- --ci --docker
npm run fs:test -- --unit
npm run fs:test -- --integration
npm run fs:test -- --e2e --full
npm run fs:test -- --staging --full --docker
```

## Publish flow (private Verdaccio)

```bash
npm run registry:start
npm adduser --registry http://127.0.0.1:4873
npm run publish:local
```

## Local development

```bash
npm run pack
node fs-install.mjs --dry-run --target /path/to/project
node fs-install.mjs --dry-run --stack full --target /path/to/project
```
