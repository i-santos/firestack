import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

const EXAMPLES_DIR = resolve('firestack/env/examples');
const TARGET_DIR = resolve('firestack/env');

const MAP = {
  development: '.env.fs.development',
  staging: '.env.fs.staging',
  production: '.env.fs.production',
  testDevelopment: '.env.fs.test.development',
  testStaging: '.env.fs.test.staging',
};

function parseArgs(argv) {
  const args = {
    force: false,
    selected: new Set(),
  };

  for (const token of argv) {
    if (token === '--force') {
      args.force = true;
      continue;
    }
    if (token === '--development') {
      args.selected.add('development');
      continue;
    }
    if (token === '--staging') {
      args.selected.add('staging');
      continue;
    }
    if (token === '--production') {
      args.selected.add('production');
      continue;
    }
    if (token === '--test-development') {
      args.selected.add('testDevelopment');
      continue;
    }
    if (token === '--test-staging') {
      args.selected.add('testStaging');
      continue;
    }
    if (token === '--all') {
      Object.keys(MAP).forEach((k) => args.selected.add(k));
      continue;
    }
    if (token === '-h' || token === '--help') {
      console.log('Usage: npm run fs:env -- [--development] [--staging] [--production] [--test-development] [--test-staging] [--all] [--force]');
      process.exit(0);
    }
    throw new Error(`unknown argument: ${token}`);
  }

  if (args.selected.size === 0) {
    args.selected.add('development');
  }

  return args;
}

function ensureExamplePath(envFile) {
  const examplePath = resolve(EXAMPLES_DIR, `${basename(envFile)}.example`);
  if (!existsSync(examplePath)) {
    throw new Error(`missing example file: ${examplePath}`);
  }
  return examplePath;
}

function createEnvFile(envFile, force) {
  const targetPath = resolve(TARGET_DIR, envFile);
  const examplePath = ensureExamplePath(envFile);

  mkdirSync(dirname(targetPath), { recursive: true });

  if (existsSync(targetPath) && !force) {
    return { targetPath, created: false, skipped: true };
  }

  copyFileSync(examplePath, targetPath);
  return { targetPath, created: true, skipped: false };
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const results = [];
  for (const key of args.selected) {
    const envFile = MAP[key];
    if (!envFile) {
      throw new Error(`unknown env key: ${key}`);
    }
    results.push(createEnvFile(envFile, args.force));
  }

  for (const item of results) {
    if (item.created) {
      console.log(`[firestack] created ${item.targetPath}`);
    } else if (item.skipped) {
      console.log(`[firestack] skipped ${item.targetPath} (already exists, use --force to overwrite)`);
    }
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[firestack] ${message}`);
  process.exit(1);
}
