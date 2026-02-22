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

function parseArgs(argv) {
  const args = { version: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--version') {
      args.version = String(argv[i + 1] ?? '').trim();
      i += 1;
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  return args;
}

function resolveStableVersion(explicitVersion) {
  if (explicitVersion) return explicitVersion;
  const current = readVersion();
  const withoutPre = current.split('-')[0];
  if (withoutPre !== current) return withoutPre;
  throw new Error(
    `current version "${current}" is already stable. Pass --version <semver> to set the next stable version.`
  );
}

function assertStable(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`stable version must be x.y.z (without prerelease): ${version}`);
  }
}

function main() {
  const { version } = parseArgs(process.argv.slice(2));
  const stableVersion = resolveStableVersion(version);
  assertStable(stableVersion);

  run('npm', ['version', stableVersion, '--no-git-tag-version']);
  run('git', ['add', 'package.json', 'package-lock.json']);
  run('git', ['commit', '-m', `chore(release): bump stable to ${stableVersion}`]);
  run('npm', ['publish']);
}

main();
