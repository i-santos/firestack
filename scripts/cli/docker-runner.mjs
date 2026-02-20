import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

function runDocker(args, options = {}) {
  return spawnSync('docker', args, options);
}

function fail(logPrefix, message, exitCode = 1) {
  console.error(`${logPrefix} ${message}`);
  process.exit(exitCode);
}

function runDockerStrict(logPrefix, step, args, options = {}) {
  const result = runDocker(args, options);
  if (result.error) {
    fail(logPrefix, `${step}: ${result.error.message}`);
  }
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
  return result;
}

function listDockerLines(args) {
  const result = runDocker(args, { encoding: 'utf8' });
  if ((result.status ?? 1) !== 0 || !result.stdout) {
    return [];
  }
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function removeDockerArtifact(logPrefix, type, artifact, rmArgs) {
  const removeResult = runDocker(rmArgs, { stdio: 'ignore' });
  if ((removeResult.status ?? 1) !== 0) {
    console.warn(`${logPrefix} cleanup skipped for ${type} ${artifact} (likely in use or already removed).`);
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function readFileStrict(path) {
  try {
    return readFileSync(path);
  } catch {
    return null;
  }
}

function readJsonStrict(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function extractDependencyInputs(repoPath) {
  const pkg = readJsonStrict(resolve(repoPath, 'package.json')) ?? {};
  const relevant = {
    dependencies: pkg.dependencies ?? {},
    devDependencies: pkg.devDependencies ?? {},
    optionalDependencies: pkg.optionalDependencies ?? {},
    peerDependencies: pkg.peerDependencies ?? {},
    overrides: pkg.overrides ?? {},
    engines: pkg.engines ?? {},
    packageManager: pkg.packageManager ?? null,
  };
  return stableStringify(relevant);
}

function computeDepsHash(repoPath, dockerfilePath, lockfilePath = 'package-lock.json') {
  const dockerfile = readFileStrict(resolve(repoPath, dockerfilePath));
  const lockfile = readFileStrict(resolve(repoPath, lockfilePath));
  const hash = createHash('sha256');
  hash.update(dockerfile ?? Buffer.from(''));
  hash.update(extractDependencyInputs(repoPath));
  hash.update(lockfile ?? Buffer.from(''));
  return hash.digest('hex').slice(0, 12);
}

function getArtifactNamespace(repoPath, env = process.env) {
  return (env.TEST_DOCKER_NAMESPACE?.trim() || createHash('sha256').update(repoPath).digest('hex').slice(0, 8)).toLowerCase();
}

function cleanupOldDockerArtifacts(logPrefix, imageBaseName, volumePrefix, keepImage, keepVolume) {
  const images = listDockerLines(['image', 'ls', '--format', '{{.Repository}}:{{.Tag}}']);
  for (const image of images) {
    const shouldCleanup = image.startsWith(`${imageBaseName}:`) && image !== keepImage;
    if (shouldCleanup) {
      removeDockerArtifact(logPrefix, 'image', image, ['image', 'rm', image]);
    }
  }

  const volumes = listDockerLines(['volume', 'ls', '--format', '{{.Name}}']);
  for (const volume of volumes) {
    const shouldCleanup = volume.startsWith(volumePrefix) && volume !== keepVolume;
    if (shouldCleanup) {
      removeDockerArtifact(logPrefix, 'volume', volume, ['volume', 'rm', volume]);
    }
  }
}

function ensureImage(logPrefix, image, dockerfilePath, repoPath, depsHash, buildArgs = []) {
  const imageExists = runDocker(['image', 'inspect', image], { stdio: 'ignore' }).status === 0;
  if (imageExists) return;
  console.log(`${logPrefix} building image ${image} (deps hash: ${depsHash})`);
  if (buildArgs.length > 0) {
    console.log(`${logPrefix} building image options: ${buildArgs.join(' ')}`);
  }
  runDockerStrict(
    logPrefix,
    'failed to build docker image',
    ['build', ...buildArgs, '-f', dockerfilePath, '-t', image, repoPath],
    { stdio: 'inherit' }
  );
}

function buildEnvArgs(env, envNames) {
  return envNames
    .filter((name) => typeof env[name] === 'string' && env[name] !== '')
    .flatMap((name) => ['-e', `${name}=${env[name]}`]);
}

function buildResourceArgs(env = process.env) {
  const memory = env.TEST_DOCKER_MEMORY?.trim();
  const memorySwap = env.TEST_DOCKER_MEMORY_SWAP?.trim();
  const cpus = env.TEST_DOCKER_CPUS?.trim();
  const pidsLimit = env.TEST_DOCKER_PIDS_LIMIT?.trim();
  const args = [];

  if (memory) args.push('--memory', memory);
  if (memorySwap) args.push('--memory-swap', memorySwap);
  if (cpus) args.push('--cpus', cpus);
  if (pidsLimit) args.push('--pids-limit', pidsLimit);

  return args;
}

function escapeForDoubleQuotes(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function ensureBindPathsWritableForUser(logPrefix, image, repoPath, uid, gid, workdir = '/work', paths = []) {
  if (!Array.isArray(paths) || paths.length === 0) return;

  const sanitized = paths
    .filter((entry) => typeof entry === 'string' && entry.trim() !== '')
    .map((entry) => entry.trim())
    .filter((entry) => !entry.startsWith('/'))
    .filter((entry) => !entry.includes('..'));

  if (sanitized.length === 0) return;

  const ownership = `${uid}:${gid}`;
  const pathArgs = sanitized.map((entry) => `"${escapeForDoubleQuotes(entry)}"`).join(' ');
  const command = `for rel in ${pathArgs}; do
  target="${workdir}/$rel"
  mkdir -p "$target"
  current="$(stat -c '%u:%g' "$target" 2>/dev/null || true)"
  if [ "$current" != "${ownership}" ]; then
    chown -R ${ownership} "$target"
  fi
done`;

  const result = runDocker([
    'run',
    '--rm',
    '-v',
    `${repoPath}:${workdir}`,
    image,
    'bash',
    '-lc',
    command,
  ], { stdio: 'inherit' });

  if (result.error) {
    fail(logPrefix, `failed to prepare artifact directory permissions: ${result.error.message}`);
  }
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

function ensureVolumeWritableForUser(logPrefix, image, volumeName, uid, gid, workdir = '/work') {
  const ownership = `${uid}:${gid}`;
  const target = `${workdir}/node_modules`;
  const command = [
    `mkdir -p ${target}`,
    `current="$(stat -c '%u:%g' ${target} 2>/dev/null || true)"`,
    `if [ "$current" != "${ownership}" ]; then chown -R ${ownership} ${target}; fi`,
  ].join(' && ');

  const result = runDocker([
    'run',
    '--rm',
    '-v',
    `${volumeName}:${target}`,
    image,
    'bash',
    '-lc',
    command,
  ], { stdio: 'inherit' });

  if (result.error) {
    fail(logPrefix, `failed to prepare node_modules volume permissions: ${result.error.message}`);
  }
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

export function defaultBootstrapCommand() {
  return 'if [ ! -d /work/node_modules/firebase ]; then mkdir -p /work/node_modules && cp -a /opt/deps/node_modules/. /work/node_modules/; fi';
}

export function createDockerTask({ cwd, logPrefix, dockerConfig, env = process.env }) {
  const dockerfilePath = dockerConfig.dockerfile ?? 'tests/integration/Dockerfile';
  const namespace = getArtifactNamespace(cwd, env);
  const imageBaseName = `${dockerConfig.imageBaseName ?? 'firestack-tests'}-${namespace}`;
  const nodeModulesVolumePrefix = `${dockerConfig.nodeModulesVolumePrefix ?? 'firestack-node_modules-'}${namespace}-`;
  const depsHash = computeDepsHash(cwd, dockerfilePath, dockerConfig.lockfilePath ?? 'package-lock.json');
  const image = `${imageBaseName}:${depsHash}`;
  const nodeModulesVolume = `${nodeModulesVolumePrefix}${depsHash}`;
  const workdir = dockerConfig.workdir ?? '/work';
  const addHosts = Array.isArray(dockerConfig.addHosts) ? dockerConfig.addHosts : ['host.docker.internal:host-gateway'];
  const runAsHostUser = dockerConfig.runAsHostUser !== false;
  const supportsUidGid = typeof process.getuid === 'function' && typeof process.getgid === 'function';
  const useHostUser = runAsHostUser && supportsUidGid;
  const userArgs = useHostUser ? ['--user', `${process.getuid()}:${process.getgid()}`] : [];
  const hostArgs = addHosts.flatMap((entry) => ['--add-host', entry]);
  const registry = dockerConfig.registry ?? {};
  const hasLocalHostRegistry =
    typeof registry.defaultHostUrl === 'string' &&
    /https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/i.test(registry.defaultHostUrl);
  const buildNetwork = dockerConfig.buildNetwork ?? (hasLocalHostRegistry ? 'host' : null);
  const buildAddHosts = Array.isArray(dockerConfig.buildAddHosts) ? dockerConfig.buildAddHosts : [];
  const buildHostArgs = buildAddHosts.flatMap((entry) => ['--add-host', entry]);
  const buildNetworkArgs = typeof buildNetwork === 'string' && buildNetwork.trim() !== ''
    ? ['--network', buildNetwork.trim()]
    : [];
  const imageBuildArgs = [...buildNetworkArgs, ...buildHostArgs];
  const writablePaths = Array.isArray(dockerConfig.writablePaths)
    ? dockerConfig.writablePaths
    : ['out', 'test-results'];

  return {
    image,
    nodeModulesVolume,
    prepare() {
      ensureImage(logPrefix, image, dockerfilePath, cwd, depsHash, imageBuildArgs);
      if (useHostUser) {
        ensureBindPathsWritableForUser(logPrefix, image, cwd, process.getuid(), process.getgid(), workdir, writablePaths);
        ensureVolumeWritableForUser(logPrefix, image, nodeModulesVolume, process.getuid(), process.getgid(), workdir);
      }
      if (dockerConfig.cleanup !== false) {
        cleanupOldDockerArtifacts(logPrefix, imageBaseName, nodeModulesVolumePrefix, image, nodeModulesVolume);
      }
    },
    run({ command, envNames = [], extraArgs = [] }) {
      const dockerEnvArgs = buildEnvArgs(env, envNames);
      const resourceArgs = buildResourceArgs(env);
      const args = [
        'run',
        '--rm',
        '-t',
        ...userArgs,
        '-v',
        `${cwd}:${workdir}`,
        '-v',
        `${nodeModulesVolume}:${workdir}/node_modules`,
        '-w',
        workdir,
        ...hostArgs,
        ...resourceArgs,
        ...extraArgs,
        ...dockerEnvArgs,
        image,
        'bash',
        '-lc',
        command,
      ];

      const result = runDocker(args, { stdio: 'inherit' });
      if (result.error) {
        fail(logPrefix, `failed to execute docker: ${result.error.message}`);
      }
      process.exit(result.status ?? 1);
    },
  };
}
