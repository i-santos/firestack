# FireStack (Standalone)

CLI para bootstrap e execução de testes/env em projetos Firebase sem copiar scripts para o repositório do app.

## Modelo Híbrido

Comandos principais:

```bash
npx firestack install
npx firestack init
npx firestack docker init
npx firestack env --development
npx firestack test --ci
npx firestack test --ci --docker --docker-rebuild
```

### `install`

- cria `firestack.config.json` e `playwright.config.mjs` (se não existirem)
- adiciona `@playwright/test` em `devDependencies`
- roda `npm install`
- roda `playwright install chromium`

### `init`

Cria `firestack.config.json`, `playwright.config.mjs`, `tests/Dockerfile` e `.dockerignore` no projeto alvo.
O template organiza tudo de teste em `out/tests/...`:
- `out/tests/unit`
- `out/tests/integration`
- `out/tests/e2e` (inclui `html/`, `junit.xml` e `artifacts/`)

### `docker init`

Cria (ou atualiza com `--force`) o `tests/Dockerfile` e `.dockerignore` padrão do FireStack no projeto alvo.

### `config migrate`

Aplica migrações pontuais no `firestack.config.json` por versão alvo.

Exemplos:

```bash
npx firestack config migrate --version 0.4.38-beta.0
npx firestack config migrate --version 0.4.38-beta.0 --dry-run
```

Na versão `0.4.38-beta.0`, a migração ajusta `test.commands.integration` (e segmentos legados de integração em `ci`/`ciFailFast`) para usar o runner interno de integração padrão.

### `env`

Gera arquivos `.env` a partir dos templates embutidos no pacote, usando `firestack.config.json`.
Quando existe `.firebaserc`, os aliases em `projects` são usados como perfis de ambiente.

Exemplos:

```bash
npx firestack env --profile default
npx firestack env --development
npx firestack env --staging --production
npx firestack env --all --force
```

Mapeamento padrão por ambiente:

- `default` -> `.env.default` e `.env.test.default`
- `staging` -> `.env.staging` e `.env.test.staging`
- `production` -> `.env.production` e `.env.test.production`

No `--all`, o FireStack prioriza aliases de `.firebaserc` (ex.: `default`, `staging`, `production`) e aplica fallback para perfis do `firestack.config.json` quando `.firebaserc` não existe.

### `test`

Executa suites usando comandos definidos em `firestack.config.json`.

Resolução de perfil/projeto/config Firebase para testes:

1. Resolve `profile` por `--profile <alias>`, senão usa `staging` quando `--staging`, senão `FIREBASE_ALIAS`, senão `default`.
2. Carrega `.env` com fallback por perfil: `.env`, `.env.test`, `.env.<profile>`, `.env.test.<profile>` (para `default`, também considera `development`).
3. Usa `GCLOUD_PROJECT` se estiver definido; senão resolve de `.firebaserc` pelo alias do profile.
4. Resolve config Firebase por `--firebase-config <path>`; se não vier, tenta `firebase.<profile>.json` e depois `firebase.json`.

Quando o fallback do `.firebaserc` é usado, o CLI também define `FIREBASE_PROJECT_ALIAS` no ambiente (incluindo execução com `--docker`).

Exemplos:

```bash
npx firestack test
npx firestack test --ci --docker
npx firestack test --ci --docker --docker-rebuild
npx firestack test --ci --fail-fast
npx firestack test --ci --infra-logs compact
npx firestack test --ci --infra-logs verbose
npx firestack test --ci --no-log-routing
npx firestack test --unit
npx firestack test --integration
npx firestack test --integration --profile default
npx firestack test --staging --profile staging --firebase-config firebase.staging.json
npx firestack test --e2e --full
npx firestack test --staging --full --docker
```

No `--ci`, o padrão é executar `integration` e `e2e smoke` e falhar só no final se qualquer suite falhar.
Para modo fail-fast, use `--fail-fast`.

Roteamento de logs para melhor DX (padrão ativo):
- `--infra-logs compact`: mantém output de testes no terminal e reduz ruído dos emuladores.
- `--infra-logs verbose`: mostra tudo (comportamento tradicional).
- `--infra-logs quiet`: mostra só infra importante (warnings/errors) no terminal.
- `--infra-log-file <path>`: define destino do log completo de infra (default `out/tests/infra/emulator.log`).
- `--suite-log-file <path>`: define destino do log de suites (default `out/tests/suite/output.log`).
- por padrão, os arquivos de log são resetados a cada execução.
- `--log-append`: acumula logs entre execuções (append).
- `--no-log-routing`: desativa roteamento e mantém stdout original sem filtro.

## Docker (Imagem + Rebuild Inteligente)

Configure no `firestack.config.json`:

```json
{
  "test": {
    "docker": {
      "dockerfile": "tests/Dockerfile",
      "imageBaseName": "firestack-tests",
      "nodeModulesVolumePrefix": "firestack-node_modules-",
      "functionsNodeModulesVolumePrefix": "firestack-functions-node_modules-",
      "emulatorCacheVolumePrefix": "firestack-firebase-cache-",
      "buildNetwork": "host",
      "bootstrapCommand": "if [ ! -d /work/node_modules/.bin ]; then mkdir -p /work/node_modules && cp -a /opt/deps/node_modules/. /work/node_modules/; fi && if [ -n \"${FIRESTACK_FUNCTIONS_PATHS:-}\" ]; then IFS=',' read -r -a firestack_functions <<< \"$FIRESTACK_FUNCTIONS_PATHS\"; for rel in \"${firestack_functions[@]}\"; do if [ -n \"$rel\" ] && [ -d \"/opt/deps/$rel/node_modules\" ] && [ -f \"/work/$rel/package.json\" ] && [ ! -d \"/work/$rel/node_modules/.bin\" ]; then mkdir -p \"/work/$rel/node_modules\" && cp -a \"/opt/deps/$rel/node_modules/.\" \"/work/$rel/node_modules/\"; fi; done; fi",
      "runAsHostUser": true,
      "preloadFirestoreEmulator": true,
      "writablePaths": ["out"],
      "addHosts": ["host.docker.internal:host-gateway"],
      "registry": {
        "defaultHostUrl": "http://127.0.0.1:4873",
        "defaultDockerUrl": "http://host.docker.internal:4873"
      }
    }
  }
}
```

No modo `--docker`, o FireStack:
- detecta módulos Cloud Functions automaticamente via config Firebase resolvida (`--firebase-config` ou fallback de profile; `functions.source`, incluindo múltiplos codebases);
- builda imagem com tag baseada em hash de `Dockerfile` + lockfiles + deps de `package.json` (raiz + módulos Functions detectados);
- reutiliza imagem/volume quando o hash não muda;
- faz rebuild automático quando deps mudam;
- monta `node_modules` em volume dedicado por hash para acelerar as execuções.
- monta `<functions.source>/node_modules` em volume dedicado por hash para cada módulo detectado.
- mantém cache persistente dos emulators Firebase em volume Docker dedicado e prioriza seed do cache a partir da imagem.

Para forçar rebuild manual da imagem:

```bash
npx firestack test --ci --docker --docker-rebuild
```

Guards compatíveis com os scripts legados:
- `ci --docker` bloqueia `E2E_BASE_URL` externo (a menos de `ALLOW_NON_STAGING_E2E=true`);
- `e2e --docker` valida host permitido para `E2E_BASE_URL`;
- `staging --docker` valida `GCLOUD_PROJECT` e host staging.
- por padrão, `GCLOUD_PROJECT` é resolvido de `.firebaserc` (ou de env se já definido). Se quiser travar staging em um projeto específico, configure `test.docker.stagingProjectId`.

`runAsHostUser: true` mantém escrita no bind mount com UID/GID do host.
Para lockfiles com pacotes em registry local (`127.0.0.1`), use `buildNetwork: "host"` no Linux para o `npm ci` do build enxergar o Verdaccio do host.
`writablePaths` define diretórios no bind mount que o runner prepara com permissão de escrita para gerar artefatos.
Para E2E, o FireStack também detecta caminhos locais de output no `playwright.config.*` e libera escrita automaticamente.

Layout recomendado de artefatos (centralizado):
- `out/tests/unit/junit.xml`
- `out/tests/integration/serial.junit.xml`
- `out/tests/integration/parallel.junit.xml`
- `out/tests/integration/junit.xml`
- `out/tests/e2e/junit.xml`
- `out/tests/e2e/html/`
- `out/tests/e2e/artifacts/`
- `out/tests/e2e/staging/junit.xml`
- `out/tests/e2e/staging/html/`
- `out/tests/e2e/staging/artifacts/`

O comando `firestack test` também imprime um resumo final consolidado (unit/integration/e2e) com totais e falhas principais.

## Publish flow (Verdaccio local)

```bash
npm run registry:start
npm adduser --registry http://127.0.0.1:4873
npm run publish:local
```

## Publish Strategy (Safe Rollback)

Use pre-release + dist-tags to test in target projects without breaking `latest`.

### 1) Bump beta

```bash
npm run release:beta:bump
```

### 2) Publish beta

```bash
npm run release:beta:publish
```

Or run both in sequence:

```bash
npm run release:beta
```

Install in target project:

```bash
npm i @igorsantos-dev/firestack@beta
```

### 3) Promote tested version to latest

Promotes current `package.json` version:

```bash
npm run release:promote:latest
```

### 4) Rollback latest to previous stable

```bash
npm run release:rollback:latest -- --version 0.4.35
```

### 5) Inspect dist-tags

```bash
npm run release:dist-tags
```
