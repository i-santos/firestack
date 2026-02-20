#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = dirname(__dirname);
const installerPath = join(root, 'fs-install.mjs');
const pkgPath = join(root, 'package.json');

function printHelp() {
  console.log(`FireStack CLI

Usage:
  firestack install [--target <dir>] [--dry-run] [--force] [--stack <full|base>]
  firestack inject [--target <dir>] [--dry-run] [--force] [--stack <full|base>]
  firestack version
  firestack help`);
}

function runInstaller(args) {
  const result = spawnSync(process.execPath, [installerPath, ...args], {
    stdio: 'inherit',
  });
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

if (command === 'install' || command === 'inject') {
  runInstaller(rest);
}

console.error(`[firestack] unknown command: ${command}`);
printHelp();
process.exit(1);
