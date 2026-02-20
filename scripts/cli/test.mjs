import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadProjectConfig } from './config.mjs';
import { createDockerTask, defaultBootstrapCommand } from './docker-runner.mjs';

function printHelp() {
  console.log('Usage: firestack test [--ci|--unit|--integration|--e2e|--staging] [--docker] [--full] [--target <dir>] [--config <path>]');
}

function runShell(cwd, script, label, env = process.env) {
  const result = spawnSync('bash', ['-lc', script], {
    cwd,
    stdio: 'inherit',
    env,
  });
  if (result.error) {
    throw new Error(`${label}: ${result.error.message}`);
  }
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

function resolveFirebaseProjectFromRc(cwd) {
  const rcPath = resolve(cwd, '.firebaserc');
  if (!existsSync(rcPath)) return null;

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(rcPath, 'utf8'));
  } catch {
    throw new Error(`invalid JSON in ${rcPath}`);
  }

  const projects = parsed?.projects;
  if (!projects || typeof projects !== 'object') return null;

  const preferredAlias = typeof process.env.FIREBASE_ALIAS === 'string' && process.env.FIREBASE_ALIAS.trim()
    ? process.env.FIREBASE_ALIAS.trim()
    : 'default';

  let alias = preferredAlias;
  let projectId = projects[alias];

  if (typeof projectId !== 'string' || !projectId.trim()) {
    const firstAlias = Object.keys(projects).find((key) => typeof projects[key] === 'string' && projects[key].trim());
    if (!firstAlias) return null;
    alias = firstAlias;
    projectId = projects[firstAlias];
  }

  return { alias, projectId: projectId.trim() };
}

function resolveTestEnv(cwd) {
  if (typeof process.env.GCLOUD_PROJECT === 'string' && process.env.GCLOUD_PROJECT.trim()) {
    return { env: process.env, source: null };
  }

  const resolved = resolveFirebaseProjectFromRc(cwd);
  if (!resolved) {
    return { env: process.env, source: null };
  }

  return {
    env: {
      ...process.env,
      GCLOUD_PROJECT: resolved.projectId,
      FIREBASE_PROJECT_ALIAS: resolved.alias,
    },
    source: resolved,
  };
}

function mapCommandKey(args) {
  const explicitCount = [args.ci, args.unit, args.integration, args.e2e, args.staging].filter(Boolean).length;
  const suffix = args.full ? 'Full' : 'Smoke';

  if (explicitCount === 0 || args.ci) return 'ci';
  if (args.unit) return 'unit';
  if (args.integration) return 'integration';
  if (args.e2e) return `e2e${suffix}`;
  if (args.staging) return `staging${suffix}`;
  return 'ci';
}

function isOverrideAllowed(env = process.env) {
  return env.ALLOW_NON_STAGING_E2E === 'true';
}

function escapeShell(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function assertNoExternalBaseUrlForCi(env, logPrefix) {
  const raw = env.E2E_BASE_URL?.trim();
  if (!raw) return;
  if (isOverrideAllowed(env)) return;
  throw new Error(
    `${logPrefix} refusing E2E_BASE_URL in CI docker gate. Allowed targets are local emulators only. ` +
    'Set ALLOW_NON_STAGING_E2E=true to override explicitly.'
  );
}

function normalizeHost(rawUrl) {
  const url = new URL(rawUrl);
  return url.hostname.toLowerCase();
}

function validateExternalBaseUrl(baseUrl, env, logPrefix) {
  if (!baseUrl) return;
  if (isOverrideAllowed(env)) return;

  let host;
  try {
    host = normalizeHost(baseUrl);
  } catch {
    throw new Error(`${logPrefix} invalid E2E_BASE_URL: ${baseUrl}`);
  }

  const allowedHosts = new Set(['localhost', '127.0.0.1', 'staging.presentgoal.com']);
  if (!allowedHosts.has(host)) {
    throw new Error(
      `${logPrefix} refusing E2E_BASE_URL host "${host}". Allowed: localhost, 127.0.0.1, staging.presentgoal.com. ` +
      'Set ALLOW_NON_STAGING_E2E=true to override explicitly.'
    );
  }
}

function validateStagingBaseUrl(baseUrl, env, logPrefix) {
  if (!baseUrl) return;
  if (isOverrideAllowed(env)) return;

  let host;
  try {
    host = normalizeHost(baseUrl);
  } catch {
    throw new Error(`${logPrefix} invalid E2E_BASE_URL: ${baseUrl}`);
  }

  if (host !== 'staging.presentgoal.com') {
    throw new Error(
      `${logPrefix} refusing E2E_BASE_URL host "${host}" for staging runner. Allowed only: staging.presentgoal.com. ` +
      'Set ALLOW_NON_STAGING_E2E=true to override explicitly.'
    );
  }
}

function requireProject(expectedProjectId, currentProjectId, logPrefix) {
  if (currentProjectId !== expectedProjectId) {
    throw new Error(`${logPrefix} refusing to run with GCLOUD_PROJECT=${currentProjectId}. Expected ${expectedProjectId}.`);
  }
  return currentProjectId;
}

function buildDockerLogPrefix(key) {
  if (key === 'ci') return '[test:ci:docker]';
  if (key === 'integration') return '[test:integration:docker]';
  if (key === 'unit') return '[test:unit:docker]';
  if (key === 'stagingSmoke' || key === 'stagingFull') return '[test:e2e:staging:docker]';
  if (key === 'e2eSmoke' || key === 'e2eFull') return '[test:e2e:docker]';
  return '[test:docker]';
}

export function runTest(argv) {
  const args = {
    target: process.cwd(),
    config: null,
    docker: false,
    ci: false,
    unit: false,
    integration: false,
    e2e: false,
    staging: false,
    full: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
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
    if (token === '--docker') { args.docker = true; continue; }
    if (token === '--ci') { args.ci = true; continue; }
    if (token === '--unit') { args.unit = true; continue; }
    if (token === '--integration') { args.integration = true; continue; }
    if (token === '--e2e') { args.e2e = true; continue; }
    if (token === '--staging') { args.staging = true; continue; }
    if (token === '--full') { args.full = true; continue; }
    if (token === '-h' || token === '--help') {
      printHelp();
      process.exit(0);
    }
    throw new Error(`unknown argument: ${token}`);
  }

  const { data: config } = loadProjectConfig(args.target, args.config);
  const { env: testEnv, source: projectSource } = resolveTestEnv(args.target);
  const commands = config.test?.commands ?? {};
  const key = mapCommandKey(args);
  const command = commands[key];
  if (!command) {
    throw new Error(`missing test command "${key}" in firestack.config.json`);
  }

  if (projectSource) {
    console.log(
      `[firestack] using Firebase project "${projectSource.projectId}" (alias "${projectSource.alias}") from .firebaserc`
    );
  }

  if (!args.docker) {
    runShell(args.target, command, key, testEnv);
    return;
  }

  const dockerConfig = config.test?.docker ?? {};
  const logPrefix = buildDockerLogPrefix(key);
  const externalBaseUrl = testEnv.E2E_BASE_URL?.trim();
  const passThrough = Array.isArray(dockerConfig.passThroughEnv) ? dockerConfig.passThroughEnv : [];

  if (key === 'ci') {
    assertNoExternalBaseUrlForCi(testEnv, logPrefix);
  } else if (key === 'e2eSmoke' || key === 'e2eFull') {
    validateExternalBaseUrl(externalBaseUrl, testEnv, logPrefix);
  } else if (key === 'stagingSmoke' || key === 'stagingFull') {
    const expectedProjectId = dockerConfig.stagingProjectId ?? 'staging-present-goal';
    requireProject(expectedProjectId, testEnv.GCLOUD_PROJECT ?? expectedProjectId, logPrefix);
    validateStagingBaseUrl(testEnv.E2E_BASE_URL ?? 'https://staging.presentgoal.com', testEnv, logPrefix);
  }

  const task = createDockerTask({
    cwd: args.target,
    logPrefix,
    dockerConfig,
    env: testEnv,
  });
  task.prepare();

  const bootstrapCommand = dockerConfig.bootstrapCommand ?? defaultBootstrapCommand();
  const projectId = testEnv.GCLOUD_PROJECT ?? 'demo-present-goal';
  const dockerSuiteCommand = (key === 'e2eSmoke' || key === 'e2eFull') && !externalBaseUrl
    ? `npm --prefix functions run build && npx firebase-tools emulators:exec --project ${escapeShell(projectId)} ${escapeShell(command)}`
    : command;
  const setup = [];
  if (bootstrapCommand) setup.push(bootstrapCommand);
  if (dockerConfig.installEveryRun === true) {
    setup.push(dockerConfig.installCommand ?? 'npm ci');
  }
  setup.push(dockerSuiteCommand);

  console.log(`${logPrefix} image: ${task.image}`);
  console.log(`${logPrefix} node_modules volume: ${task.nodeModulesVolume}`);

  task.run({
    command: setup.join(' && '),
    envNames: passThrough,
  });
}
