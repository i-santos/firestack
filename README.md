# FireStack (Standalone)

Standalone repository layout for publishing `@igorsantos-dev/firestack`.

## Publish flow (private Verdaccio)

```bash
npm run registry:start
npm adduser --registry http://127.0.0.1:4873
npm run publish:local
```

## Install in app projects

```bash
npm config set @igorsantos-dev:registry http://SEU_HOST:4873
npm i -D @igorsantos-dev/firestack
npx firestack install
```

## Local development

```bash
npm run pack
node fs-install.mjs --dry-run --target /path/to/project
```
