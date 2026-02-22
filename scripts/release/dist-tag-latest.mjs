import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
const packageName = pkg.name;

function parseArgs(argv) {
  const args = {
    mode: '',
    version: '',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!args.mode && (token === 'promote' || token === 'rollback')) {
      args.mode = token;
      continue;
    }
    if (token === '--version') {
      args.version = String(argv[i + 1] ?? '').trim();
      i += 1;
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  if (!args.mode) {
    throw new Error('usage: node scripts/release/dist-tag-latest.mjs <promote|rollback> [--version <semver>]');
  }
  return args;
}

function getTargetVersion(mode, explicitVersion) {
  if (explicitVersion) return explicitVersion;
  if (mode === 'promote') return pkg.version;
  throw new Error('rollback requires --version <previous_version>');
}

function main() {
  const { mode, version } = parseArgs(process.argv.slice(2));
  const targetVersion = getTargetVersion(mode, version);
  const target = `${packageName}@${targetVersion}`;
  const result = spawnSync('npm', ['dist-tag', 'add', target, 'latest'], {
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error) {
    throw new Error(`failed to run npm dist-tag add: ${result.error.message}`);
  }
  process.exit(result.status ?? 1);
}

main();
