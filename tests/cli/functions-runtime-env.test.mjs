import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { resolveFunctionsRuntimeEnv } from '../../scripts/cli/functions-env.mjs';
import { resolveTestEnv } from '../../scripts/cli/test.mjs';

function withTempProject(fn) {
  const root = mkdtempSync(join(tmpdir(), 'firestack-env-test-'));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function seedFunctionsProject(root) {
  mkdirSync(join(root, 'functions'), { recursive: true });
  writeFileSync(join(root, 'functions', 'package.json'), '{ "name": "functions-fixture" }\n');
  writeFileSync(join(root, 'firebase.json'), JSON.stringify({ functions: 'functions' }, null, 2));
  writeFileSync(
    join(root, '.firebaserc'),
    JSON.stringify({ projects: { default: 'demo-present-goal' } }, null, 2)
  );
}

test('resolveFunctionsRuntimeEnv merges .env -> .env.<projectId> -> .env.local', () => withTempProject((root) => {
  seedFunctionsProject(root);
  writeFileSync(join(root, 'functions', '.env'), 'A=base\nAUTH_ALLOWLIST=from-base\n');
  writeFileSync(join(root, 'functions', '.env.demo-present-goal'), 'AUTH_ALLOWLIST=\nB=project\n');
  writeFileSync(
    join(root, 'functions', '.env.local'),
    'AUTH_ALLOWLIST=igor@cerebrobinario.com,@presentgoal.com\nC=local\n'
  );

  const resolved = resolveFunctionsRuntimeEnv(root, {
    projectId: 'demo-present-goal',
    firebaseConfigPath: resolve(root, 'firebase.json'),
  });

  assert.equal(resolved.env.A, 'base');
  assert.equal(resolved.env.B, 'project');
  assert.equal(resolved.env.C, 'local');
  assert.equal(resolved.env.AUTH_ALLOWLIST, 'igor@cerebrobinario.com,@presentgoal.com');
  assert.deepEqual(
    resolved.loadedFiles.map((path) => path.replaceAll('\\', '/')),
    [
      join(root, 'functions', '.env'),
      join(root, 'functions', '.env.demo-present-goal'),
      join(root, 'functions', '.env.local'),
    ].map((path) => path.replaceAll('\\', '/'))
  );
}));

test('resolveTestEnv exposes same effective Functions env to test process', () => withTempProject((root) => {
  seedFunctionsProject(root);
  writeFileSync(join(root, 'functions', '.env.demo-present-goal'), 'AUTH_ALLOWLIST=\n');
  writeFileSync(join(root, 'functions', '.env.local'), 'AUTH_ALLOWLIST=igor@cerebrobinario.com,@presentgoal.com\n');

  const original = process.env.GCLOUD_PROJECT;
  delete process.env.GCLOUD_PROJECT;
  try {
    const runtime = resolveFunctionsRuntimeEnv(root, {
      projectId: 'demo-present-goal',
      firebaseConfigPath: resolve(root, 'firebase.json'),
    });
    const resolvedTest = resolveTestEnv(root, {
      profileAlias: 'default',
      firebaseConfigPath: resolve(root, 'firebase.json'),
    });

    assert.equal(
      resolvedTest.env.AUTH_ALLOWLIST,
      'igor@cerebrobinario.com,@presentgoal.com'
    );
    assert.equal(
      resolvedTest.env.AUTH_ALLOWLIST,
      runtime.env.AUTH_ALLOWLIST
    );
    assert.equal(
      resolvedTest.functionsRuntime.env.AUTH_ALLOWLIST,
      runtime.env.AUTH_ALLOWLIST
    );
  } finally {
    if (original === undefined) delete process.env.GCLOUD_PROJECT;
    else process.env.GCLOUD_PROJECT = original;
  }
}));

test('resolveFunctionsRuntimeEnv keeps empty-string values from Functions env files', () => withTempProject((root) => {
  seedFunctionsProject(root);
  writeFileSync(join(root, 'functions', '.env.demo-present-goal'), 'AUTH_ALLOWLIST=\n');

  const resolved = resolveFunctionsRuntimeEnv(root, {
    projectId: 'demo-present-goal',
    firebaseConfigPath: resolve(root, 'firebase.json'),
  });

  assert.equal(resolved.env.AUTH_ALLOWLIST, '');
  assert.ok(resolved.keys.includes('AUTH_ALLOWLIST'));
}));
