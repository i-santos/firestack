#!/usr/bin/env node
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { runInstall } from '../scripts/cli/install.mjs';
import { runInit } from '../scripts/cli/init.mjs';
import { runDockerInit } from '../scripts/cli/docker-init.mjs';
import { runEnv } from '../scripts/cli/env.mjs';
import { runTest } from '../scripts/cli/test.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = dirname(__dirname);
const pkgPath = join(root, 'package.json');

function printHelp() {
  console.log(`FireStack CLI

Usage:
  firestack install [--target <dir>] [--dry-run] [--force]
  firestack init [--target <dir>] [--dry-run] [--force]
  firestack docker init [--target <dir>] [--dry-run] [--force]
  firestack env [--development|--staging|--production|--all] [--force] [--target <dir>] [--config <path>]
  firestack test [--ci|--unit|--integration|--e2e|--staging] [--docker] [--docker-rebuild] [--fail-fast] [--full] [--target <dir>] [--config <path>]
  firestack version
  firestack help`);
}

function runInternal(rest) {
  const [internalCommand, ...internalArgs] = rest;
  const internalScriptMap = {
    'run-integration-report': join(root, 'scripts', 'cli', 'internal-run-integration-report.mjs'),
    'run-e2e': join(root, 'scripts', 'cli', 'internal-run-e2e.mjs'),
    'run-e2e-staging': join(root, 'scripts', 'cli', 'internal-run-e2e-staging.mjs'),
  };

  const scriptPath = internalScriptMap[internalCommand];
  if (!scriptPath) {
    console.error(`[firestack] unknown internal command: ${internalCommand ?? '(empty)'}`);
    process.exit(1);
  }

  const result = spawnSync(process.execPath, [scriptPath, ...internalArgs], {
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error) {
    console.error(`[firestack] failed to run internal command "${internalCommand}": ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

function printVersion() {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  console.log(pkg.version);
}

const [command, ...rest] = process.argv.slice(2);

if (!command || command === 'help' || command === '--help' || command === '-h') {
  printHelp();
  process.exit(0);
}

if (command === 'version' || command === '--version' || command === '-v') {
  printVersion();
  process.exit(0);
}

if (command === 'install') {
  runInstall(rest);
  process.exit(0);
}

if (command === 'init') {
  runInit(rest);
  process.exit(0);
}

if (command === 'env') {
  runEnv(rest);
  process.exit(0);
}

if (command === 'docker') {
  const [dockerCommand, ...dockerArgs] = rest;
  if (dockerCommand === 'init') {
    runDockerInit(dockerArgs);
    process.exit(0);
  }
  console.error(`[firestack] unknown docker command: ${dockerCommand ?? '(empty)'}`);
  process.exit(1);
}

if (command === 'test') {
  runTest(rest);
  process.exit(0);
}

if (command === 'internal') {
  runInternal(rest);
  process.exit(0);
}

console.error(`[firestack] unknown command: ${command}`);
printHelp();
process.exit(1);
