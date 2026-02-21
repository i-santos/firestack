import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEMPLATE_DOCKERFILE = join(ROOT, 'templates', 'tests.Dockerfile');
const TEMPLATE_DOCKERIGNORE = join(ROOT, 'templates', 'dockerignore');

function printHelp() {
  console.log('Usage: firestack docker init [--target <dir>] [--force] [--dry-run]');
}

function ensureDockerignoreEntries(targetDir, dryRun) {
  const dockerignorePath = join(targetDir, '.dockerignore');
  const hasDockerignore = existsSync(dockerignorePath);
  const currentContent = hasDockerignore ? readFileSync(dockerignorePath, 'utf8') : '';
  const desiredEntries = readFileSync(TEMPLATE_DOCKERIGNORE, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  const existingEntries = new Set(
    currentContent
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  );
  const missing = desiredEntries.filter((entry) => !existingEntries.has(entry));
  if (missing.length === 0) {
    console.log('[firestack] .dockerignore already contains default entries');
    return;
  }

  if (dryRun) {
    console.log(`[firestack] would add ${missing.length} entries to ${dockerignorePath}`);
    return;
  }

  const endsWithNewline = currentContent === '' || currentContent.endsWith('\n');
  const prefix = currentContent === '' || endsWithNewline ? '' : '\n';
  const next = `${currentContent}${prefix}${missing.join('\n')}\n`;
  writeFileSync(dockerignorePath, next, 'utf8');
  console.log(`[firestack] updated ${dockerignorePath} with ${missing.length} entries`);
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

  const files = [
    { template: TEMPLATE_DOCKERFILE, destination: join(args.target, 'tests', 'Dockerfile'), label: 'tests/Dockerfile' },
  ];
  let skippedExisting = false;

  for (const file of files) {
    if (existsSync(file.destination) && !args.force) {
      console.log(`[firestack] ${file.label} already exists: ${file.destination}`);
      skippedExisting = true;
      continue;
    }

    if (!args.dryRun) {
      mkdirSync(dirname(file.destination), { recursive: true });
      cpSync(file.template, file.destination, { recursive: false });
    }
    console.log(`[firestack] initialized ${file.destination}`);
  }

  if (skippedExisting) {
    console.log('[firestack] use --force to overwrite existing files');
  }
  ensureDockerignoreEntries(args.target, args.dryRun);

  if (args.dryRun) {
    console.log('[firestack] dry-run mode: no files were written');
  }
}
