import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjectConfig } from './config.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEMPLATE_DIR = join(ROOT, 'templates');

function printHelp() {
  console.log('Usage: firestack env [--development] [--staging] [--production] [--all] [--force] [--target <dir>] [--config <path>]');
}

function selectEnvNames(argv) {
  const selected = new Set();
  const rest = [];
  for (const token of argv) {
    if (token === '--development') selected.add('development');
    else if (token === '--staging') selected.add('staging');
    else if (token === '--production') selected.add('production');
    else if (token === '--all') {
      selected.add('development');
      selected.add('staging');
      selected.add('production');
    } else {
      rest.push(token);
    }
  }
  if (selected.size === 0) selected.add('development');
  return { selected, rest };
}

export function runEnv(argv) {
  const { selected, rest } = selectEnvNames(argv);
  const args = {
    target: process.cwd(),
    force: false,
    config: null,
  };

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === '--target') {
      args.target = resolve(rest[i + 1] ?? '.');
      i += 1;
      continue;
    }
    if (token === '--config') {
      args.config = resolve(rest[i + 1] ?? 'firestack.config.json');
      i += 1;
      continue;
    }
    if (token === '--force') {
      args.force = true;
      continue;
    }
    if (token === '-h' || token === '--help') {
      printHelp();
      process.exit(0);
    }
    throw new Error(`unknown argument: ${token}`);
  }

  const { data: config } = loadProjectConfig(args.target, args.config);
  const profiles = config.env?.profiles ?? {};

  for (const profileName of selected) {
    const profile = profiles[profileName];
    if (!profile) {
      throw new Error(`missing env profile "${profileName}" in firestack.config.json`);
    }
    const mappings = Array.isArray(profile.files) ? profile.files : [];
    if (mappings.length === 0) {
      throw new Error(`profile "${profileName}" has no files mapping in firestack.config.json`);
    }

    for (const mapping of mappings) {
      const targetFile = mapping?.target;
      const templateFile = mapping?.template;
      if (!targetFile || !templateFile) {
        throw new Error(`invalid mapping in profile "${profileName}" (expected target/template)`);
      }

      const source = join(TEMPLATE_DIR, templateFile);
      const destination = resolve(args.target, targetFile);
      if (!existsSync(source)) {
        throw new Error(`missing template in package: ${templateFile}`);
      }
      if (existsSync(destination) && !args.force) {
        console.log(`[firestack] skipped ${destination} (already exists, use --force to overwrite)`);
        continue;
      }
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(source, destination);
      console.log(`[firestack] wrote ${destination}`);
    }
  }
}
