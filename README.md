# FireStack (Standalone)

CLI para bootstrap e execução de testes/env em projetos Firebase sem copiar scripts para o repositório do app.

## Modelo Híbrido

Comandos principais:

```bash
npx firestack install
npx firestack init
npx firestack env --development
npx firestack test --ci
```

### `install`

- cria `firestack.config.json` (se não existir)
- adiciona `@playwright/test` em `devDependencies`
- roda `npm install`
- roda `playwright install chromium`

### `init`

Cria apenas `firestack.config.json` no projeto alvo.

### `env`

Gera arquivos `.env` a partir dos templates embutidos no pacote, usando `firestack.config.json`.

Exemplos:

```bash
npx firestack env --development
npx firestack env --staging --production
npx firestack env --all --force
```

Mapeamento padrão por ambiente:

- `development` -> `.env.development` e `.env.test.development`
- `staging` -> `.env.staging` e `.env.test.staging`
- `production` -> `.env.production`

### `test`

Executa suites usando comandos definidos em `firestack.config.json`.

Resolução do projeto Firebase para testes de integração/CI (quando o comando usa `firebase emulators:exec --project ...`):

1. Usa `GCLOUD_PROJECT` se estiver definido.
2. Senão, tenta ler `.firebaserc` no diretório alvo.
3. Para escolher alias no `.firebaserc`, a ordem é: `FIREBASE_ALIAS` (se definido), depois `default`, depois o primeiro alias válido em `projects`.
4. Se não conseguir resolver projeto, falha com erro explícito.

Quando o fallback do `.firebaserc` é usado, o CLI também define `FIREBASE_PROJECT_ALIAS` no ambiente (incluindo execução com `--docker`).

Exemplos:

```bash
npx firestack test
npx firestack test --ci --docker
npx firestack test --unit
npx firestack test --integration
npx firestack test --e2e --full
npx firestack test --staging --full --docker
```

## Docker (Imagem + Rebuild Inteligente)

Configure no `firestack.config.json`:

```json
{
  "test": {
    "docker": {
      "dockerfile": "tests/integration/Dockerfile",
      "imageBaseName": "firestack-tests",
      "nodeModulesVolumePrefix": "firestack-node_modules-",
      "bootstrapCommand": "if [ ! -d /work/node_modules/firebase ]; then mkdir -p /work/node_modules && cp -a /opt/deps/node_modules/. /work/node_modules/; fi",
      "runAsHostUser": true,
      "addHosts": ["host.docker.internal:host-gateway"],
      "stagingProjectId": "staging-present-goal"
    }
  }
}
```

No modo `--docker`, o FireStack:
- builda imagem com tag baseada em hash de `Dockerfile` + lockfile + deps do `package.json`;
- reutiliza imagem/volume quando o hash não muda;
- faz rebuild automático quando deps mudam;
- monta `node_modules` em volume dedicado por hash para acelerar as execuções.

Guards compatíveis com os scripts legados:
- `ci --docker` bloqueia `E2E_BASE_URL` externo (a menos de `ALLOW_NON_STAGING_E2E=true`);
- `e2e --docker` valida host permitido para `E2E_BASE_URL`;
- `staging --docker` valida `GCLOUD_PROJECT` e host staging.

`runAsHostUser: true` mantém escrita no bind mount com UID/GID do host.

## Publish flow (Verdaccio local)

```bash
npm run registry:start
npm adduser --registry http://127.0.0.1:4873
npm run publish:local
```
