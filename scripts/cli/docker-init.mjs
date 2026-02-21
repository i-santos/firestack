import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEMPLATE_DOCKERFILE = join(ROOT, 'templates', 'tests.Dockerfile');

function printHelp() {
  console.log('Usage: firestack docker init [--target <dir>] [--force] [--dry-run]');
}

export function runDockerInit(argv) {
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

  const destination = join(args.target, 'tests', 'Dockerfile');
  if (existsSync(destination) && !args.force) {
    console.log(`[firestack] tests/Dockerfile already exists: ${destination}`);
    console.log('[firestack] use --force to overwrite existing files');
    return;
  }

  if (!args.dryRun) {
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(TEMPLATE_DOCKERFILE, destination, { recursive: false });
  }
  console.log(`[firestack] initialized ${destination}`);
  if (args.dryRun) {
    console.log('[firestack] dry-run mode: no files were written');
  }
}
