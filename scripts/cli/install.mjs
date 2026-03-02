import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runInit } from './init.mjs';

function printHelp() {
  console.log('Usage: firestack install [--target <dir>] [--force] [--dry-run]');
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

export function runInstall(argv) {
  const args = {
    target: process.cwd(),
    force: false,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--target') {
      args.target = resolve(argv[i + 1] ?? '.');
      i += 1;
      continue;
    }
    if (token === '--force') {
      args.force = true;
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

  runInit([ '--target', args.target, ...(args.force ? ['--force'] : []), ...(args.dryRun ? ['--dry-run'] : []) ]);

  const pkgPath = join(args.target, 'package.json');
  if (!existsSync(pkgPath)) {
    throw new Error(`package.json not found in ${args.target}`);
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const depsResult = mergeDevDependencies(pkg, args.force, {
    'vitest': '^4.0.0',
    '@playwright/test': '^1.58.2',
  });

  if (!args.dryRun) {
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
    runInTarget(args.target, 'npm', ['install']);
    runInTarget(args.target, 'npm', ['exec', 'playwright', 'install', 'chromium']);
  }

  console.log(`[firestack] devDependencies added: ${depsResult.created.length}`);
  if (depsResult.overwritten.length > 0) {
    console.log(`[firestack] devDependencies overwritten: ${depsResult.overwritten.join(', ')}`);
  }
  if (depsResult.skipped.length > 0) {
    console.log(`[firestack] devDependencies skipped (use --force to overwrite): ${depsResult.skipped.join(', ')}`);
  }
  if (args.dryRun) {
    console.log('[firestack] dry-run mode: no files were written');
  }
}
