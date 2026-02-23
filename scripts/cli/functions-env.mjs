import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function parseEnvFile(content) {
  const parsed = {};
  const lines = String(content).split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim().replace(/^export\s+/, '');
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

function readJsonStrict(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function normalizeRelativePath(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\\/g, '/').replace(/^\.?\//, '');
  if (!trimmed || trimmed.startsWith('/') || trimmed.includes('..')) return null;
  return trimmed;
}

export function discoverFunctionsSourcePaths(cwd, firebaseConfigPath = null) {
  const configPath = firebaseConfigPath ?? resolve(cwd, 'firebase.json');
  const firebaseJson = readJsonStrict(configPath);
  const discovered = [];
  const addCandidate = (candidate) => {
    const normalized = normalizeRelativePath(candidate);
    if (!normalized) return;
    if (existsSync(resolve(cwd, normalized, 'package.json'))) {
      discovered.push(normalized);
    }
  };

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

  if (discovered.length === 0 && existsSync(resolve(cwd, 'functions', 'package.json'))) {
    discovered.push('functions');
  }

  return [...new Set(discovered)];
}

export function resolveFunctionsRuntimeEnv(cwd, { projectId = null, firebaseConfigPath = null } = {}) {
  const sourcePaths = discoverFunctionsSourcePaths(cwd, firebaseConfigPath);
  const merged = {};
  const loadedFiles = [];
  const normalizedProjectId = typeof projectId === 'string' && projectId.trim() ? projectId.trim() : null;

  for (const sourcePath of sourcePaths) {
    const candidates = [
      resolve(cwd, sourcePath, '.env'),
      ...(normalizedProjectId ? [resolve(cwd, sourcePath, `.env.${normalizedProjectId}`)] : []),
      resolve(cwd, sourcePath, '.env.local'),
    ];

    for (const filePath of candidates) {
      if (!existsSync(filePath)) continue;
      Object.assign(merged, parseEnvFile(readFileSync(filePath, 'utf8')));
      loadedFiles.push(filePath);
    }
  }

  return {
    env: merged,
    keys: Object.keys(merged),
    loadedFiles,
    sourcePaths,
  };
}
