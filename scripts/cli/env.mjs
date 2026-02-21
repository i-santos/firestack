import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjectConfig } from './config.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEMPLATE_DIR = join(ROOT, 'templates');

function printHelp() {
  console.log('Usage: firestack env [--profile <alias>] [--development] [--staging] [--production] [--all] [--force] [--target <dir>] [--config <path>]');
}

function normalizeProfileAlias(name) {
  const trimmed = String(name ?? '').trim().toLowerCase();
  if (!trimmed) return '';
  if (trimmed === 'development') return 'default';
  return trimmed;
}

function readFirebaseProjects(targetDir) {
  const rcPath = resolve(targetDir, '.firebaserc');
  if (!existsSync(rcPath)) return {};
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(rcPath, 'utf8'));
  } catch {
    throw new Error(`invalid JSON in ${rcPath}`);
  }
  const projects = parsed?.projects;
  if (!projects || typeof projects !== 'object') return {};

  const normalized = {};
  for (const [alias, projectId] of Object.entries(projects)) {
    if (typeof projectId !== 'string' || !projectId.trim()) continue;
    const profileAlias = normalizeProfileAlias(alias);
    if (!profileAlias) continue;
    normalized[profileAlias] = projectId.trim();
  }
  return normalized;
}

function resolveFallbackProfiles(configProfiles = {}, firebaseProjects = {}) {
  const aliasesFromRc = Object.keys(firebaseProjects);
  if (aliasesFromRc.length > 0) return aliasesFromRc;
  const aliasesFromConfig = Object.keys(configProfiles).map((name) => normalizeProfileAlias(name)).filter(Boolean);
  if (aliasesFromConfig.length > 0) return [...new Set(aliasesFromConfig)];
  return ['default'];
}

function resolveTemplateVariant(profileAlias) {
  if (profileAlias === 'staging') return 'staging';
  if (profileAlias === 'production') return 'production';
  return 'default';
}

function buildGeneratedProfile(profileAlias) {
  const variant = resolveTemplateVariant(profileAlias);
  const files = [
    { target: `.env.${profileAlias}`, template: `env/.env.${variant}.example` },
    { target: `.env.test.${profileAlias}`, template: `env/.env.test.${variant}.example` },
  ];
  return { files };
}

function resolveProfileDefinition(profileAlias, configProfiles) {
  const explicit = configProfiles[profileAlias];
  if (explicit && typeof explicit === 'object') return explicit;
  if (profileAlias === 'default' && configProfiles.development && typeof configProfiles.development === 'object') {
    return configProfiles.development;
  }
  return buildGeneratedProfile(profileAlias);
}

function upsertProjectId(content, projectId) {
  if (!projectId) return content;
  if (/^GCLOUD_PROJECT=.*/m.test(content)) {
    return content.replace(/^GCLOUD_PROJECT=.*/m, `GCLOUD_PROJECT=${projectId}`);
  }
  const prefix = content.endsWith('\n') || content.length === 0 ? '' : '\n';
  return `${content}${prefix}GCLOUD_PROJECT=${projectId}\n`;
}

export function runEnv(argv) {
  const args = {
    target: process.cwd(),
    force: false,
    config: null,
    all: false,
    selectedProfiles: new Set(),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--profile') {
      const alias = normalizeProfileAlias(argv[i + 1] ?? '');
      if (!alias) throw new Error('missing value for --profile');
      args.selectedProfiles.add(alias);
      i += 1;
      continue;
    }
    if (token === '--development') { args.selectedProfiles.add('default'); continue; }
    if (token === '--staging') { args.selectedProfiles.add('staging'); continue; }
    if (token === '--production') { args.selectedProfiles.add('production'); continue; }
    if (token === '--all') { args.all = true; continue; }
    if (token === '--target') {
      args.target = resolve(argv[i + 1] ?? '.');
      i += 1;
      continue;
    }
    if (token === '--config') {
      args.config = resolve(argv[i + 1] ?? 'firestack.config.json');
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
  const configProfiles = config.env?.profiles ?? {};
  const firebaseProjects = readFirebaseProjects(args.target);
  const fallbackProfiles = resolveFallbackProfiles(configProfiles, firebaseProjects);
  const selectedProfiles = args.all
    ? new Set(fallbackProfiles)
    : (args.selectedProfiles.size > 0 ? args.selectedProfiles : new Set(['default']));

  for (const profileAlias of selectedProfiles) {
    const profile = resolveProfileDefinition(profileAlias, configProfiles);
    if (!profile) {
      throw new Error(`missing env profile "${profileAlias}" in firestack.config.json`);
    }
    const mappings = Array.isArray(profile.files) ? profile.files : [];
    if (mappings.length === 0) {
      throw new Error(`profile "${profileAlias}" has no files mapping in firestack.config.json`);
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
      const sourceContent = readFileSync(source, 'utf8');
      const projectId = firebaseProjects[profileAlias] ?? null;
      const nextContent = upsertProjectId(sourceContent, projectId);
      writeFileSync(destination, nextContent, 'utf8');
      console.log(`[firestack] wrote ${destination}`);
    }
  }
}
