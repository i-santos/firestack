#!/usr/bin/env node
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = join(__dirname, 'templates');

function parseArgs(argv) {
  const args = {
    target: process.cwd(),
    dryRun: false,
    force: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--target') {
      args.target = resolve(argv[i + 1] ?? '.');
      i += 1;
      continue;
    }
    if (token === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (token === '--force') {
      args.force = true;
      continue;
    }
    if (token === '-h' || token === '--help') {
      printHelp();
      process.exit(0);
    }
    throw new Error(`unknown argument: ${token}`);
  }

  return args;
}

function printHelp() {
  console.log('Usage: node firestack/fs-install.mjs [--target <dir>] [--dry-run] [--force]');
}

function ensurePackageJson(targetDir) {
  const pkgPath = join(targetDir, 'package.json');
  if (!existsSync(pkgPath)) {
    throw new Error(`package.json not found in ${targetDir}`);
  }
  return pkgPath;
}

function inferScript(existing, options) {
  const { primary, fallbacks, defaultValue } = options;
  if (existing[primary]) return `npm run ${primary}`;
  for (const candidate of fallbacks) {
    if (existing[candidate]) return `npm run ${candidate}`;
  }
  return defaultValue;
}

function detectProjectProfile(targetDir, pkg) {
  const dependencies = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
    ...(pkg.peerDependencies ?? {}),
  };

  const isAngular = existsSync(join(targetDir, 'angular.json')) || Boolean(dependencies['@angular/core']);

  return { isAngular };
}

function dockerSuiteCommand(envFile, command) {
  return `bash scripts/firestack/docker-suite.sh --env-file ${envFile} -- ${command}`;
}

function buildFireStackScripts(pkg, profile) {
  const scripts = pkg.scripts ?? {};
  const commands = {
    unit: scripts['test:unit'] ? 'npm run test:unit' : 'npm run fs:test:unit',
    integration: scripts['test:integration:emulator']
      ? 'npm run test:integration:emulator'
      : scripts['test:integration']
        ? 'npm run test:integration'
        : 'npm run fs:test:integration',
    e2eSmoke: scripts['test:e2e:smoke']
      ? 'npm run test:e2e:smoke'
      : scripts['test:e2e']
        ? 'npm run test:e2e'
        : 'npm run fs:test:e2e:smoke',
    ci: scripts['test:ci'] ? 'npm run test:ci' : 'npm run fs:test:ci',
  };

  return {
    'fs:install': 'node firestack/fs-install.mjs',
    'fs:env:check': 'node scripts/firestack/doctor.mjs development',
    'fs:env:check:test:development': 'node scripts/firestack/doctor.mjs testDevelopment',
    'fs:env:check:test:staging': 'node scripts/firestack/doctor.mjs testStaging',
    'fs:dev': inferScript(scripts, {
      primary: 'emulators',
      fallbacks: ['dev'],
      defaultValue: 'firebase emulators:start',
    }),
    'fs:test:unit': inferScript(scripts, {
      primary: 'test:unit',
      fallbacks: ['test'],
      defaultValue: 'node --test',
    }),
    'fs:test:integration': inferScript(scripts, {
      primary: 'test:integration:emulator',
      fallbacks: ['test:integration'],
      defaultValue: 'echo "Configure test:integration first" && exit 1',
    }),
    'fs:test:e2e:smoke': inferScript(scripts, {
      primary: 'test:e2e:smoke',
      fallbacks: ['test:e2e'],
      defaultValue: 'echo "Configure test:e2e:smoke first" && exit 1',
    }),
    'fs:test:ci': inferScript(scripts, {
      primary: 'test:ci',
      fallbacks: [],
      defaultValue: 'npm run fs:test:unit && npm run fs:test:integration && npm run fs:test:e2e:smoke',
    }),
    'fs:test:ci:docker': inferScript(scripts, {
      primary: 'test:ci:docker',
      fallbacks: [],
      defaultValue: dockerSuiteCommand('.env.fs.test.development', commands.ci),
    }),
    'fs:test:staging:gate': inferScript(scripts, {
      primary: 'test:staging:gate',
      fallbacks: ['test:e2e:full:staging'],
      defaultValue: 'echo "Configure staging gate first" && exit 1',
    }),
    'fs:test:staging:gate:docker': inferScript(scripts, {
      primary: 'test:staging:gate:docker',
      fallbacks: ['test:e2e:full:staging:docker'],
      defaultValue: 'echo "Configure staging docker gate first" && exit 1',
    }),
    'fs:test:unit:docker': scripts['test:unit:docker']
      ? 'npm run test:unit:docker'
      : dockerSuiteCommand('.env.fs.test.development', commands.unit),
    'fs:test:integration:docker': scripts['test:integration:docker']
      ? 'npm run test:integration:docker'
      : dockerSuiteCommand('.env.fs.test.development', commands.integration),
    'fs:test:e2e:smoke:docker': scripts['test:e2e:smoke:docker']
      ? 'npm run test:e2e:smoke:docker'
      : dockerSuiteCommand('.env.fs.test.development', commands.e2eSmoke),
    ...(profile.isAngular
      ? {
          'fs:angular:env:sync': 'node scripts/firestack/angular-env-sync.mjs',
          'fs:angular:env:sync:staging': 'node scripts/firestack/angular-env-sync.mjs staging',
          'fs:angular:env:sync:production': 'node scripts/firestack/angular-env-sync.mjs production',
        }
      : {}),
  };
}

function mergeScripts(pkg, force, desired) {
  const existing = pkg.scripts ?? {};
  const merged = { ...existing };
  const created = [];
  const skipped = [];
  const overwritten = [];

  for (const [name, command] of Object.entries(desired)) {
    if (!(name in merged)) {
      merged[name] = command;
      created.push(name);
      continue;
    }

    if (merged[name] === command) continue;

    if (force) {
      merged[name] = command;
      overwritten.push(name);
    } else {
      skipped.push(name);
    }
  }

  pkg.scripts = merged;
  return { created, skipped, overwritten };
}

function ensureGitignore(targetDir, dryRun) {
  const path = join(targetDir, '.gitignore');
  const linesToAdd = [
    '',
    '# FireStack local env files',
    '.env.fs.development',
    '.env.fs.staging',
    '.env.fs.production',
    '.env.fs.test.development',
    '.env.fs.test.staging',
    '!.env.fs.development.example',
    '!.env.fs.staging.example',
    '!.env.fs.production.example',
    '!.env.fs.test.development.example',
    '!.env.fs.test.staging.example',
  ];

  const current = existsSync(path) ? readFileSync(path, 'utf8') : '';
  let next = current;
  let changed = false;

  for (const line of linesToAdd) {
    if (!line) continue;
    if (!current.split(/\r?\n/).includes(line)) {
      next += `${next.endsWith('\n') || next.length === 0 ? '' : '\n'}${line}\n`;
      changed = true;
    }
  }

  if (changed && !dryRun) writeFileSync(path, next, 'utf8');
  return changed;
}

function copyTemplates(targetDir, force, dryRun) {
  const destinations = [
    '.firestack/config.json',
    '.env.fs.development.example',
    '.env.fs.staging.example',
    '.env.fs.production.example',
    '.env.fs.test.development.example',
    '.env.fs.test.staging.example',
    'scripts/firestack/doctor.mjs',
    'scripts/firestack/docker-suite.sh',
    'scripts/firestack/angular-env-sync.mjs',
  ];

  const copied = [];
  const skipped = [];

  for (const relativePath of destinations) {
    const source = join(TEMPLATE_DIR, relativePath);
    const destination = join(targetDir, relativePath);
    mkdirSync(dirname(destination), { recursive: true });

    if (existsSync(destination) && !force) {
      skipped.push(relativePath);
      continue;
    }

    copied.push(relativePath);
    if (!dryRun) {
      cpSync(source, destination, { recursive: false });
      if (destination.endsWith('.sh')) chmodSync(destination, 0o755);
    }
  }

  return { copied, skipped };
}

function copyPortableKit(targetDir, force, dryRun) {
  const sourceDir = __dirname;
  const destinationDir = join(targetDir, 'firestack');
  const sameDirectory = resolve(destinationDir) === resolve(sourceDir);

  if (sameDirectory) {
    return { copied: false, skipped: true };
  }

  if (existsSync(destinationDir) && !force) {
    return { copied: false, skipped: true };
  }

  if (!dryRun) {
    cpSync(sourceDir, destinationDir, { recursive: true });
    chmodSync(join(destinationDir, 'fs-inject.sh'), 0o755);
    chmodSync(join(destinationDir, 'fs-install.mjs'), 0o755);
  }

  return { copied: true, skipped: false };
}

function ensureRootInjector(targetDir, dryRun) {
  const filePath = join(targetDir, 'fs-inject.sh');
  const content = `#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
exec bash "$SCRIPT_DIR/firestack/fs-inject.sh" "$@"
`;
  if (!dryRun) {
    writeFileSync(filePath, content, 'utf8');
    chmodSync(filePath, 0o755);
  }
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  const pkgPath = ensurePackageJson(args.target);
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const profile = detectProjectProfile(args.target, pkg);
  const desiredScripts = buildFireStackScripts(pkg, profile);

  const portableKitResult = copyPortableKit(args.target, args.force, args.dryRun);
  const templateResult = copyTemplates(args.target, args.force, args.dryRun);
  const scriptResult = mergeScripts(pkg, args.force, desiredScripts);
  const gitignoreChanged = ensureGitignore(args.target, args.dryRun);
  ensureRootInjector(args.target, args.dryRun);

  if (!args.dryRun) {
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  }

  console.log(`[firestack] target: ${args.target}`);
  console.log(`[firestack] profile: ${profile.isAngular ? 'angular' : 'generic-node'}`);
  console.log(`[firestack] portable kit copied: ${portableKitResult.copied ? 'yes' : 'no'}`);
  if (portableKitResult.skipped) {
    console.log('[firestack] portable kit skipped (already exists, use --force to overwrite)');
  }
  console.log(`[firestack] templates copied: ${templateResult.copied.length}`);
  if (templateResult.skipped.length > 0) {
    console.log(`[firestack] templates skipped (already exist): ${templateResult.skipped.join(', ')}`);
  }

  console.log(`[firestack] scripts created: ${scriptResult.created.length}`);
  if (scriptResult.overwritten.length > 0) {
    console.log(`[firestack] scripts overwritten: ${scriptResult.overwritten.join(', ')}`);
  }
  if (scriptResult.skipped.length > 0) {
    console.log(`[firestack] scripts skipped (use --force to overwrite): ${scriptResult.skipped.join(', ')}`);
  }

  console.log(`[firestack] .gitignore updated: ${gitignoreChanged ? 'yes' : 'no changes'}`);
  if (args.dryRun) {
    console.log('[firestack] dry-run mode: no files were written');
  }
}

try {
  run();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[firestack] ${message}`);
  process.exit(1);
}
