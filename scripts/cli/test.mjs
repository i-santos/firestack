import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadProjectConfig } from './config.mjs';

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

function normalizeRegistryUrl(rawUrl) {
  if (!rawUrl) return null;
  const url = new URL(rawUrl);
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    url.hostname = 'host.docker.internal';
  }
  return url.toString().replace(/\/$/, '');
}

function escapeShell(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function buildRegistrySetupCommands(registryConfig) {
  const mappings = Array.isArray(registryConfig.mappings) ? registryConfig.mappings : [];
  const commands = [];
  const defaultDockerUrl = normalizeRegistryUrl(registryConfig.defaultDockerUrl ?? registryConfig.dockerUrl ?? '');

  // Always set a default registry in Docker so npm can rewrite lockfile-hosted URLs consistently.
  if (defaultDockerUrl) {
    commands.push(`npm config set registry ${escapeShell(defaultDockerUrl)}`);
  }

  for (const mapping of mappings) {
    if (!mapping || typeof mapping !== 'object') continue;
    const scope = typeof mapping.scope === 'string' ? mapping.scope.trim() : '';
    const dockerUrl = normalizeRegistryUrl(
      mapping.dockerUrl ?? mapping.url ?? registryConfig.defaultDockerUrl ?? registryConfig.dockerUrl ?? ''
    );
    if (!dockerUrl) continue;

    if (scope) {
      commands.push(`npm config set ${escapeShell(`${scope}:registry`)} ${escapeShell(dockerUrl)}`);
    } else {
      commands.push(`npm config set registry ${escapeShell(dockerUrl)}`);
    }
  }

  if (commands.length > 0) {
    commands.push('npm config set replace-registry-host always');
  }

  return commands;
}

function buildDockerCommand(command, dockerConfig, runtime = {}) {
  const installCommand = dockerConfig.installCommand ?? 'npm ci';
  const registry = dockerConfig.registry ?? {};
  const npmCachePath = runtime.npmCachePath ?? '/root/.npm';
  const homeDir = runtime.homeDir ?? '/root';

  const setup = [];
  setup.push(`mkdir -p ${escapeShell(homeDir)} ${escapeShell(npmCachePath)}`);
  setup.push(...buildRegistrySetupCommands(registry));
  setup.push(installCommand);
  setup.push(command);

  return setup.join(' && ');
}

function buildDockerArgs(cwd, command, dockerConfig, env = process.env) {
  const image = dockerConfig.image ?? 'node:22-bookworm';
  const workdir = dockerConfig.workdir ?? '/work';
  const npmCacheVolume = dockerConfig.npmCacheVolume ?? 'firestack-npm-cache';
  const addHosts = Array.isArray(dockerConfig.addHosts) ? dockerConfig.addHosts : ['host.docker.internal:host-gateway'];
  const passThrough = Array.isArray(dockerConfig.passThroughEnv) ? dockerConfig.passThroughEnv : [];
  const runAsHostUser = dockerConfig.runAsHostUser !== false;
  const supportsUidGid = typeof process.getuid === 'function' && typeof process.getgid === 'function';
  const useHostUser = runAsHostUser && supportsUidGid;
  const userArg = useHostUser ? [`${process.getuid()}:${process.getgid()}`] : null;
  const npmCachePath = useHostUser
    ? (dockerConfig.npmCachePath ?? `${workdir}/.firestack/npm-cache`)
    : '/root/.npm';
  const homeDir = useHostUser ? (dockerConfig.homeDir ?? '/tmp/firestack-home') : '/root';

  const envArgs = passThrough
    .filter((name) => typeof env[name] === 'string' && env[name] !== '')
    .flatMap((name) => ['-e', `${name}=${env[name]}`]);
  envArgs.push('-e', `HOME=${homeDir}`, '-e', `npm_config_cache=${npmCachePath}`);

  const hostArgs = addHosts.flatMap((entry) => ['--add-host', entry]);
  const userArgs = userArg ? ['--user', userArg[0]] : [];
  const cacheVolumeArgs = useHostUser ? [] : ['-v', `${npmCacheVolume}:${npmCachePath}`];

  return [
    'run',
    '--rm',
    '-t',
    '--init',
    ...userArgs,
    ...hostArgs,
    '-v', `${cwd}:${workdir}`,
    ...cacheVolumeArgs,
    '-w', workdir,
    ...envArgs,
    image,
    'bash',
    '-lc',
    buildDockerCommand(command, dockerConfig, { npmCachePath, homeDir }),
  ];
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
  const dockerArgs = buildDockerArgs(args.target, command, dockerConfig, testEnv);

  const result = spawnSync('docker', dockerArgs, { stdio: 'inherit' });
  if (result.error) {
    throw new Error(`docker: ${result.error.message}`);
  }
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}
