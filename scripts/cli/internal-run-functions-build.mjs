import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function readJsonStrict(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function normalizeRelativePath(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\.?\//, '');
  if (!normalized || normalized.startsWith('/') || normalized.includes('..')) return null;
  return normalized;
}

function resolveFirebaseConfigPath(cwd) {
  const configured = process.env.FIRESTACK_FIREBASE_CONFIG_PATH?.trim();
  if (configured) {
    const candidate = resolve(cwd, configured);
    if (!existsSync(candidate)) {
      throw new Error(`[test:functions:build] firebase config not found: ${candidate}`);
    }
    return candidate;
  }
  const fallback = resolve(cwd, 'firebase.json');
  return existsSync(fallback) ? fallback : null;
}

function discoverFunctionsPaths(cwd, firebaseConfigPath) {
  const discovered = [];
  const addCandidate = (candidate) => {
    const normalized = normalizeRelativePath(candidate);
    if (!normalized) return;
    if (existsSync(resolve(cwd, normalized, 'package.json'))) {
      discovered.push(normalized);
    }
  };

  if (firebaseConfigPath) {
    const firebaseJson = readJsonStrict(firebaseConfigPath);
    const functionsConfig = firebaseJson?.functions;
    if (typeof functionsConfig === 'string') {
      addCandidate(functionsConfig);
    } else if (Array.isArray(functionsConfig)) {
      for (const entry of functionsConfig) {
        if (typeof entry === 'string') addCandidate(entry);
        else if (entry && typeof entry === 'object') addCandidate(entry.source);
      }
    } else if (functionsConfig && typeof functionsConfig === 'object') {
      addCandidate(functionsConfig.source);
    }
  }

  if (discovered.length === 0 && existsSync(resolve(cwd, 'functions', 'package.json'))) {
    discovered.push('functions');
  }

  return [...new Set(discovered)];
}

function runBuild(cwd, modulePath) {
  console.log(`[test:functions:build] building ${modulePath}`);
  const result = spawnSync('npm', ['--prefix', modulePath, 'run', 'build'], {
    cwd,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) {
    throw new Error(`[test:functions:build] failed to run npm build in ${modulePath}: ${result.error.message}`);
  }
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

const cwd = process.cwd();
const firebaseConfigPath = resolveFirebaseConfigPath(cwd);
const functionPaths = discoverFunctionsPaths(cwd, firebaseConfigPath);

if (functionPaths.length === 0) {
  console.log('[test:functions:build] no functions modules found. skipping build step.');
  process.exit(0);
}

for (const modulePath of functionPaths) {
  runBuild(cwd, modulePath);
}
