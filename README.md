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

Exemplos:

```bash
npx firestack test
npx firestack test --ci --docker
npx firestack test --unit
npx firestack test --integration
npx firestack test --e2e --full
npx firestack test --staging --full --docker
```

## Docker + Registry local (host)

Configure no `firestack.config.json`:

```json
{
  "test": {
    "docker": {
      "addHosts": ["host.docker.internal:host-gateway"],
      "registry": {
        "url": "http://host.docker.internal:4873",
        "scope": "@igorsantos-dev"
      }
    }
  }
}
```

Isso evita `ECONNREFUSED 127.0.0.1:4873` dentro do container e deixa o registry parametrizável.

## Publish flow (Verdaccio local)

```bash
npm run registry:start
npm adduser --registry http://127.0.0.1:4873
npm run publish:local
```
