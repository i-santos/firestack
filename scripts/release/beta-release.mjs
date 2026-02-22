import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkgPath = resolve(ROOT, 'package.json');

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) {
    throw new Error(`failed to run ${command} ${args.join(' ')}: ${result.error.message}`);
  }
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

function readVersion() {
  return JSON.parse(readFileSync(pkgPath, 'utf8')).version;
}

function main() {
  run('npm', ['run', 'release:beta:bump']);
  const version = readVersion();
  run('git', ['add', 'package.json', 'package-lock.json']);
  run('git', ['commit', '-m', `chore(release): bump beta to ${version}`]);
  run('npm', ['run', 'release:beta:publish']);
}

main();
