#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
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
    stack: 'full',
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
    if (token === '--stack') {
      args.stack = (argv[i + 1] ?? '').trim();
      i += 1;
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
  console.log('Usage: node firestack/fs-install.mjs [--target <dir>] [--dry-run] [--force] [--stack <full|base>]');
}

function ensurePackageJson(targetDir) {
  const pkgPath = join(targetDir, 'package.json');
  if (!existsSync(pkgPath)) {
    throw new Error(`package.json not found in ${targetDir}`);
  }
  return pkgPath;
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

function buildFireStackScripts(profile) {
  return {
    'fs:install': 'npx firestack install',
    'fs:env': 'node firestack/scripts/env-init.mjs',
    ...(profile.isAngular
      ? {
          'fs:angular:env:sync': 'node firestack/scripts/angular-env-sync.mjs',
          'fs:angular:env:sync:staging': 'node firestack/scripts/angular-env-sync.mjs staging',
          'fs:angular:env:sync:production': 'node firestack/scripts/angular-env-sync.mjs production',
        }
      : {}),
  };
}

function buildFullFsAliasScripts() {
  return {
    'fs:test': 'node firestack/scripts/test.mjs',
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

function mergeDevDependencies(pkg, force, desired) {
  const existing = pkg.devDependencies ?? {};
  const merged = { ...existing };
  const created = [];
  const skipped = [];
  const overwritten = [];

  for (const [name, version] of Object.entries(desired)) {
    if (!(name in merged)) {
      merged[name] = version;
      created.push(name);
      continue;
    }

    if (merged[name] === version) continue;

    if (force) {
      merged[name] = version;
      overwritten.push(name);
    } else {
      skipped.push(name);
    }
  }

  pkg.devDependencies = merged;
  return { created, skipped, overwritten };
}

function copyTemplates(targetDir, force, dryRun) {
  const destinations = [
    { source: '.firestack/config.json', destination: 'firestack/config.json' },
    { source: '.env.fs.development.example', destination: 'firestack/env/examples/.env.fs.development.example' },
    { source: '.env.fs.staging.example', destination: 'firestack/env/examples/.env.fs.staging.example' },
    { source: '.env.fs.production.example', destination: 'firestack/env/examples/.env.fs.production.example' },
    { source: '.env.fs.test.development.example', destination: 'firestack/env/examples/.env.fs.test.development.example' },
    { source: '.env.fs.test.staging.example', destination: 'firestack/env/examples/.env.fs.test.staging.example' },
    {
      source: 'firestack/.gitignore',
      destination: 'firestack/.gitignore',
      fallbackContent: '# Local env files generated from examples\nenv/.env*\n!env/examples/\n!env/examples/.env*.example\n',
    },
    { source: 'scripts/firestack/env-init.mjs', destination: 'firestack/scripts/env-init.mjs' },
    { source: 'scripts/firestack/doctor.mjs', destination: 'firestack/scripts/doctor.mjs' },
    { source: 'scripts/firestack/docker-suite.sh', destination: 'firestack/scripts/docker-suite.sh' },
    { source: 'scripts/firestack/angular-env-sync.mjs', destination: 'firestack/scripts/angular-env-sync.mjs' },
  ];

  const copied = [];
  const skipped = [];

  for (const item of destinations) {
    const source = join(TEMPLATE_DIR, item.source);
    const destination = join(targetDir, item.destination);
    mkdirSync(dirname(destination), { recursive: true });

    if (existsSync(destination) && !force) {
      skipped.push(item.destination);
      continue;
    }

    copied.push(item.destination);
    if (!dryRun) {
      if (existsSync(source)) {
        cpSync(source, destination, { recursive: false });
      } else if (typeof item.fallbackContent === 'string') {
        writeFileSync(destination, item.fallbackContent, 'utf8');
      } else {
        throw new Error(
          `missing template file: ${item.source}. Reinstall or update @igorsantos-dev/firestack package.`
        );
      }
      if (destination.endsWith('.sh')) chmodSync(destination, 0o755);
    }
  }

  return { copied, skipped };
}

function copyFullTestStackTemplates(targetDir, force, dryRun) {
  const destinations = [
    { source: '.env.test.development.example', destination: 'firestack/env/examples/.env.test.development.example' },
    { source: '.env.test.staging.example', destination: 'firestack/env/examples/.env.test.staging.example' },
    { source: 'playwright.config.ts', destination: 'firestack/playwright.config.ts' },
    { source: 'docs/tests/README.md', destination: 'firestack/docs/tests/README.md' },
    { source: 'scripts/test.mjs', destination: 'firestack/scripts/test.mjs' },
    { source: 'scripts/lib/docker-runner.mjs', destination: 'firestack/scripts/lib/docker-runner.mjs' },
    { source: 'scripts/lib/e2e-runner.mjs', destination: 'firestack/scripts/lib/e2e-runner.mjs' },
    { source: 'scripts/report-ci-test-summary.mjs', destination: 'firestack/scripts/report-ci-test-summary.mjs' },
    { source: 'scripts/run-ci-docker.mjs', destination: 'firestack/scripts/run-ci-docker.mjs' },
    { source: 'scripts/run-e2e-docker.mjs', destination: 'firestack/scripts/run-e2e-docker.mjs' },
    { source: 'scripts/run-e2e-staging-docker.mjs', destination: 'firestack/scripts/run-e2e-staging-docker.mjs' },
    { source: 'scripts/run-e2e-staging.mjs', destination: 'firestack/scripts/run-e2e-staging.mjs' },
    { source: 'scripts/run-e2e.mjs', destination: 'firestack/scripts/run-e2e.mjs' },
    { source: 'scripts/run-integration-report.mjs', destination: 'firestack/scripts/run-integration-report.mjs' },
  ];
  const copied = [];
  const skipped = [];

  for (const item of destinations) {
    const source = join(TEMPLATE_DIR, 'stack/full', item.source);
    const destination = join(targetDir, item.destination);
    mkdirSync(dirname(destination), { recursive: true });

    if (existsSync(destination) && !force) {
      skipped.push(item.destination);
      continue;
    }

    copied.push(item.destination);
    if (!dryRun) {
      cpSync(source, destination, { recursive: false });
    }
  }

  const sourceTestsDir = join(TEMPLATE_DIR, 'stack/full/tests');
  const destinationTestsDir = join(targetDir, 'firestack/tests');
  if (existsSync(destinationTestsDir) && !force) {
    skipped.push('firestack/tests/**');
  } else {
    copied.push('firestack/tests/**');
    if (!dryRun) {
      mkdirSync(dirname(destinationTestsDir), { recursive: true });
      cpSync(sourceTestsDir, destinationTestsDir, { recursive: true });
    }
  }

  return { copied, skipped };
}

function runInTarget(targetDir, command, args) {
  const result = spawnSync(command, args, {
    cwd: targetDir,
    stdio: 'inherit',
  });
  if (result.error) {
    throw new Error(`failed to execute "${command} ${args.join(' ')}": ${result.error.message}`);
  }
  if ((result.status ?? 1) !== 0) {
    throw new Error(`command failed (${result.status ?? 1}): ${command} ${args.join(' ')}`);
  }
}

function installStackRuntime(targetDir) {
  runInTarget(targetDir, 'npm', ['install']);
  runInTarget(targetDir, 'npm', ['exec', 'playwright', 'install', 'chromium']);
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.stack !== 'base' && args.stack !== 'full') {
    throw new Error(`invalid --stack value: ${args.stack} (expected "full" or "base")`);
  }
  const pkgPath = ensurePackageJson(args.target);
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const profile = detectProjectProfile(args.target, pkg);
  const desiredScripts = {
    ...buildFireStackScripts(profile),
    ...(args.stack === 'full' ? buildFullFsAliasScripts() : {}),
  };
  const desiredDevDependencies = args.stack === 'full'
    ? {
        '@playwright/test': '^1.58.2',
      }
    : {};

  const templateResult = copyTemplates(args.target, args.force, args.dryRun);
  const fullTemplateResult =
    args.stack === 'full'
      ? copyFullTestStackTemplates(args.target, args.force, args.dryRun)
      : { copied: [], skipped: [] };
  const scriptResult = mergeScripts(pkg, args.force, desiredScripts);
  const depsResult = mergeDevDependencies(pkg, args.force, desiredDevDependencies);

  if (!args.dryRun) {
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
    if (args.stack === 'full') {
      console.log('[firestack] installing project dependencies...');
      installStackRuntime(args.target);
    }
  }

  console.log(`[firestack] target: ${args.target}`);
  console.log(`[firestack] stack profile: ${args.stack}`);
  console.log(`[firestack] profile: ${profile.isAngular ? 'angular' : 'generic-node'}`);
  console.log(`[firestack] templates copied: ${templateResult.copied.length}`);
  if (templateResult.skipped.length > 0) {
    console.log(`[firestack] templates skipped (already exist): ${templateResult.skipped.join(', ')}`);
  }
  if (args.stack === 'full') {
    console.log(`[firestack] full-stack templates copied: ${fullTemplateResult.copied.length}`);
    if (fullTemplateResult.skipped.length > 0) {
      console.log(`[firestack] full-stack templates skipped (already exist): ${fullTemplateResult.skipped.join(', ')}`);
    }
  }

  console.log(`[firestack] scripts created: ${scriptResult.created.length}`);
  if (scriptResult.overwritten.length > 0) {
    console.log(`[firestack] scripts overwritten: ${scriptResult.overwritten.join(', ')}`);
  }
  if (scriptResult.skipped.length > 0) {
    console.log(`[firestack] scripts skipped (use --force to overwrite): ${scriptResult.skipped.join(', ')}`);
  }
  if (args.stack === 'full') {
    console.log(`[firestack] devDependencies added: ${depsResult.created.length}`);
    if (depsResult.overwritten.length > 0) {
      console.log(`[firestack] devDependencies overwritten: ${depsResult.overwritten.join(', ')}`);
    }
    if (depsResult.skipped.length > 0) {
      console.log(`[firestack] devDependencies skipped (use --force to overwrite): ${depsResult.skipped.join(', ')}`);
    }
  }
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
