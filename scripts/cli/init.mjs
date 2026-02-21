import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEMPLATE_CONFIG = join(ROOT, 'templates', 'firestack.config.json');
const TEMPLATE_PLAYWRIGHT_CONFIG = join(ROOT, 'templates', 'playwright.config.mjs');
const TEMPLATE_DOCKERFILE = join(ROOT, 'templates', 'tests.Dockerfile');
const TEMPLATE_DOCKERIGNORE = join(ROOT, 'templates', 'dockerignore');

function printHelp() {
  console.log('Usage: firestack init [--target <dir>] [--force] [--dry-run]');
}

function ensureOutIgnored(targetDir, dryRun) {
  const gitignorePath = join(targetDir, '.gitignore');
  const desiredEntry = 'out/';
  const hasGitignore = existsSync(gitignorePath);
  const content = hasGitignore ? readFileSync(gitignorePath, 'utf8') : '';
  const normalizedLines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const alreadyIgnored = normalizedLines.some((line) => line === desiredEntry || line === 'out' || line === '/out/');
  if (alreadyIgnored) {
    console.log(`[firestack] .gitignore already contains ${desiredEntry}`);
    return;
  }

  if (dryRun) {
    console.log(`[firestack] would add ${desiredEntry} to ${gitignorePath}`);
    return;
  }

  const endsWithNewline = content === '' || content.endsWith('\n');
  const prefix = content === '' || endsWithNewline ? '' : '\n';
  const next = `${content}${prefix}${desiredEntry}\n`;
  writeFileSync(gitignorePath, next, 'utf8');
  console.log(`[firestack] updated ${gitignorePath} with ${desiredEntry}`);
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

export function runInit(argv) {
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
    { template: TEMPLATE_CONFIG, relativePath: 'firestack.config.json', label: 'firestack.config.json' },
    { template: TEMPLATE_PLAYWRIGHT_CONFIG, relativePath: 'playwright.config.mjs', label: 'playwright.config.mjs' },
    { template: TEMPLATE_DOCKERFILE, relativePath: 'tests/Dockerfile', label: 'tests/Dockerfile' },
  ];
  let skippedExisting = false;

  for (const file of files) {
    const destination = join(args.target, file.relativePath);
    if (existsSync(destination) && !args.force) {
      console.log(`[firestack] ${file.label} already exists: ${destination}`);
      skippedExisting = true;
      continue;
    }
    if (!args.dryRun) {
      mkdirSync(dirname(destination), { recursive: true });
      cpSync(file.template, destination, { recursive: false });
    }
    console.log(`[firestack] initialized ${destination}`);
  }

  if (skippedExisting) {
    console.log('[firestack] use --force to overwrite existing files');
  }
  ensureDockerignoreEntries(args.target, args.dryRun);
  ensureOutIgnored(args.target, args.dryRun);
  if (args.dryRun) {
    console.log('[firestack] dry-run mode: no files were written');
  }
}
