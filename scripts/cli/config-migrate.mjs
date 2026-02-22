import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATIONS = ['integration-spec-default'];

function printHelp() {
  console.log(
    'Usage: firestack config migrate --migration <key> [--target <dir>] [--config <path>] [--dry-run]\n' +
    `Available migrations: ${MIGRATIONS.join(', ')}`
  );
}

function loadConfig(path) {
  if (!existsSync(path)) {
    throw new Error(`missing firestack config: ${path}`);
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`invalid JSON in ${path}`);
  }
}

function integrationRunnerCommand() {
  return 'firestack internal run-functions-build && firebase emulators:exec --project ${GCLOUD_PROJECT:?Set GCLOUD_PROJECT} "firestack internal run-integration-report"';
}

function applyIntegrationSpecDefault(config) {
  const next = structuredClone(config);
  const changes = [];

  next.test = next.test ?? {};
  next.test.commands = next.test.commands ?? {};

  const currentIntegration = next.test.commands.integration;
  const desiredIntegration = integrationRunnerCommand();
  if (currentIntegration !== desiredIntegration) {
    next.test.commands.integration = desiredIntegration;
    changes.push('updated test.commands.integration to internal integration runner');
  }

  const ci = String(next.test.commands.ci ?? '');
  if (ci && !ci.includes('firestack internal run-integration-report')) {
    const legacy = /node\s+--test[\s\S]*?tests\/integration\/\*\*\/\*\.test\.ts/g;
    if (legacy.test(ci)) {
      next.test.commands.ci = ci.replace(legacy, 'firestack internal run-integration-report');
      changes.push('updated test.commands.ci integration segment to internal runner');
    }
  }

  const ciFailFast = String(next.test.commands.ciFailFast ?? '');
  if (ciFailFast && !ciFailFast.includes('firestack internal run-integration-report')) {
    const legacy = /node\s+--test[\s\S]*?tests\/integration\/\*\*\/\*\.test\.ts/g;
    if (legacy.test(ciFailFast)) {
      next.test.commands.ciFailFast = ciFailFast.replace(legacy, 'firestack internal run-integration-report');
      changes.push('updated test.commands.ciFailFast integration segment to internal runner');
    }
  }

  return { next, changes };
}

function runNamedMigration(config, migration) {
  if (migration === 'integration-spec-default') return applyIntegrationSpecDefault(config);
  throw new Error(`unsupported --migration "${migration}". available: ${MIGRATIONS.join(', ')}`);
}

export function runConfigMigrate(argv) {
  const args = {
    target: process.cwd(),
    config: null,
    dryRun: false,
    migration: '',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--target') {
      args.target = resolve(argv[i + 1] ?? '.');
      i += 1;
      continue;
    }
    if (token === '--config') {
      args.config = resolve(args.target, argv[i + 1] ?? 'firestack.config.json');
      i += 1;
      continue;
    }
    if (token === '--migration') {
      args.migration = String(argv[i + 1] ?? '').trim();
      i += 1;
      continue;
    }
    if (token === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (token === '-h' || token === '--help') {
      printHelp();
      process.exit(0);
    }
    throw new Error(`unknown argument: ${token}`);
  }

  if (!args.migration) {
    throw new Error('missing required argument: --migration <key>');
  }

  const configPath = args.config ?? resolve(args.target, 'firestack.config.json');
  const current = loadConfig(configPath);
  const { next, changes } = runNamedMigration(current, args.migration);

  if (changes.length === 0) {
    console.log(`[firestack] config already up to date for migration "${args.migration}"`);
    return;
  }

  console.log(`[firestack] config migration (${args.migration}) changes:`);
  for (const change of changes) {
    console.log(`- ${change}`);
  }

  if (args.dryRun) {
    console.log('[firestack] dry-run mode: no file changes written');
    return;
  }

  writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  console.log(`[firestack] migrated ${configPath}`);
}
