import { readFileSync, existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';

function parseEnv(contents) {
  const map = new Map();
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    map.set(key, value);
  }
  return map;
}

function loadConfig() {
  const path = resolve('firestack/config.json');
  if (!existsSync(path)) {
    throw new Error('missing firestack/config.json. Run: npx firestack install');
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

function main() {
  const envName = (process.argv[2] ?? 'development').trim();
  const config = loadConfig();
  const envFile = config.envFiles?.[envName];
  if (!envFile) {
    console.error(`[firestack] unknown environment: ${envName}`);
    process.exit(1);
  }

  const fullPath = resolve(envFile);
  if (!existsSync(fullPath)) {
    console.error(`[firestack] missing ${envFile}`);
    console.error(`[firestack] create it from firestack/env/examples/${basename(envFile)}.example`);
    process.exit(1);
  }

  const envMap = parseEnv(readFileSync(fullPath, 'utf8'));
  const shared = config.requiredVars?.shared ?? [];
  const envSpecific = config.requiredVars?.[envName] ?? [];
  const required = [...shared, ...envSpecific];

  const missing = required.filter((key) => !envMap.get(key));
  if (missing.length > 0) {
    console.error(`[firestack] ${envFile} is missing required vars:`);
    for (const key of missing) console.error(`- ${key}`);
    process.exit(1);
  }

  console.log(`[firestack] ${envFile} looks valid for ${envName}.`);
}

main();
