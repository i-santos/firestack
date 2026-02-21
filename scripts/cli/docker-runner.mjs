import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';

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

function normalizeRelativePath(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\\/g, '/').replace(/^\.?\//, '');
  if (!trimmed || trimmed.startsWith('/') || trimmed.includes('..')) return null;
  return trimmed;
}

function discoverFunctionsPaths(repoPath, firebaseConfigPath = null) {
  const configPath = firebaseConfigPath ?? resolve(repoPath, 'firebase.json');
  const firebaseJson = readJsonStrict(configPath);
  const discovered = [];
  const addCandidate = (candidate) => {
    const normalized = normalizeRelativePath(candidate);
    if (!normalized) return;
    if (existsSync(resolve(repoPath, normalized, 'package.json'))) {
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

  if (discovered.length === 0 && existsSync(resolve(repoPath, 'functions', 'package.json'))) {
    discovered.push('functions');
  }

  return [...new Set(discovered)];
}

function extractDependencyInputs(repoPath, functionsPaths = []) {
  const pkg = readJsonStrict(resolve(repoPath, 'package.json')) ?? {};
  const functionsPkgs = functionsPaths.map((path) => ({
    path,
    pkg: readJsonStrict(resolve(repoPath, path, 'package.json')) ?? null,
  }));
  const relevant = {
    dependencies: pkg.dependencies ?? {},
    devDependencies: pkg.devDependencies ?? {},
    optionalDependencies: pkg.optionalDependencies ?? {},
    peerDependencies: pkg.peerDependencies ?? {},
    overrides: pkg.overrides ?? {},
    engines: pkg.engines ?? {},
    packageManager: pkg.packageManager ?? null,
    functions: functionsPkgs
      .filter(({ pkg }) => pkg)
      .map(({ path, pkg: functionPkg }) => ({
        path,
        dependencies: functionPkg.dependencies ?? {},
        devDependencies: functionPkg.devDependencies ?? {},
        optionalDependencies: functionPkg.optionalDependencies ?? {},
        peerDependencies: functionPkg.peerDependencies ?? {},
        overrides: functionPkg.overrides ?? {},
        engines: functionPkg.engines ?? {},
      })),
  };
  return stableStringify(relevant);
}

function computeDepsHash(repoPath, dockerfilePath, lockfilePath = 'package-lock.json', functionsPaths = []) {
  const dockerfile = readFileStrict(resolve(repoPath, dockerfilePath));
  const lockfile = readFileStrict(resolve(repoPath, lockfilePath));
  const hash = createHash('sha256');
  hash.update(dockerfile ?? Buffer.from(''));
  hash.update(extractDependencyInputs(repoPath, functionsPaths));
  hash.update(lockfile ?? Buffer.from(''));
  for (const functionsPath of functionsPaths) {
    const functionsLockfile = readFileStrict(resolve(repoPath, functionsPath, 'package-lock.json'));
    const functionsNpmShrinkwrap = readFileStrict(resolve(repoPath, functionsPath, 'npm-shrinkwrap.json'));
    hash.update(functionsLockfile ?? Buffer.from(''));
    hash.update(functionsNpmShrinkwrap ?? Buffer.from(''));
  }
  return hash.digest('hex').slice(0, 12);
}

function getArtifactNamespace(repoPath, env = process.env) {
  return (env.TEST_DOCKER_NAMESPACE?.trim() || createHash('sha256').update(repoPath).digest('hex').slice(0, 8)).toLowerCase();
}

function cleanupOldDockerArtifacts(logPrefix, imageBaseName, volumePrefixes, keepImage, keepVolumes = []) {
  const images = listDockerLines(['image', 'ls', '--format', '{{.Repository}}:{{.Tag}}']);
  for (const image of images) {
    const shouldCleanup = image.startsWith(`${imageBaseName}:`) && image !== keepImage;
    if (shouldCleanup) {
      removeDockerArtifact(logPrefix, 'image', image, ['image', 'rm', image]);
    }
  }

  const prefixes = Array.isArray(volumePrefixes) ? volumePrefixes : [volumePrefixes];
  const keepSet = new Set((Array.isArray(keepVolumes) ? keepVolumes : [keepVolumes]).filter(Boolean));
  const volumes = listDockerLines(['volume', 'ls', '--format', '{{.Name}}']);
  for (const volume of volumes) {
    const shouldCleanup = prefixes.some((prefix) => typeof prefix === 'string' && volume.startsWith(prefix)) &&
      !keepSet.has(volume);
    if (shouldCleanup) {
      removeDockerArtifact(logPrefix, 'volume', volume, ['volume', 'rm', volume]);
    }
  }
}

function ensureImage(logPrefix, image, dockerfilePath, repoPath, depsHash, buildArgs = [], forceRebuild = false) {
  const imageExists = runDocker(['image', 'inspect', image], { stdio: 'ignore' }).status === 0;
  if (imageExists && !forceRebuild) return;
  if (imageExists && forceRebuild) {
    console.log(`${logPrefix} force rebuild enabled. removing cached image ${image}`);
    runDockerStrict(logPrefix, 'failed to remove docker image for rebuild', ['image', 'rm', image], { stdio: 'inherit' });
  }
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

function ensureVolumeWritableForUser(logPrefix, image, volumeName, uid, gid, workdir = '/work', relativePath = 'node_modules') {
  const ownership = `${uid}:${gid}`;
  const target = `${workdir}/${relativePath}`;
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

function ensureFirestoreEmulatorCached(logPrefix, image, cacheVolume, uid, gid) {
  const userArgs = Number.isInteger(uid) && Number.isInteger(gid) ? ['--user', `${uid}:${gid}`] : [];
  const command = [
    'set -e',
    'mkdir -p /firestack-cache/firebase/emulators',
    'if ls /opt/firebase/emulators/cloud-firestore-emulator-*.jar >/dev/null 2>&1; then',
    `  echo '${logPrefix} seeding firestore emulator cache from image...'`,
    '  cp -f /opt/firebase/emulators/cloud-firestore-emulator-*.jar /firestack-cache/firebase/emulators/',
    'fi',
    'if ls /firestack-cache/firebase/emulators/cloud-firestore-emulator-*.jar >/dev/null 2>&1; then',
    `  echo '${logPrefix} firestore emulator already cached.'`,
    '  exit 0',
    'fi',
    `echo '${logPrefix} preloading firestore emulator into docker cache volume...'`,
    'if [ -x /opt/deps/node_modules/.bin/firebase ]; then',
    '  FIREBASE_EMULATORS_PATH=/firestack-cache/firebase/emulators /opt/deps/node_modules/.bin/firebase setup:emulators:firestore',
    '  exit 0',
    'fi',
    'if [ -x node_modules/.bin/firebase ]; then',
    '  FIREBASE_EMULATORS_PATH=/firestack-cache/firebase/emulators node_modules/.bin/firebase setup:emulators:firestore',
    '  exit 0',
    'fi',
    'FIREBASE_EMULATORS_PATH=/firestack-cache/firebase/emulators firebase setup:emulators:firestore',
  ].join('\n');

  const result = runDocker([
    'run',
    '--rm',
    ...userArgs,
    '-v',
    `${cacheVolume}:/firestack-cache`,
    '-e',
    'FIREBASE_EMULATORS_PATH=/firestack-cache/firebase/emulators',
    image,
    'bash',
    '-lc',
    command,
  ], { stdio: 'inherit' });

  if (result.error) {
    console.warn(`${logPrefix} unable to warm firestore emulator cache: ${result.error.message}`);
    return false;
  }
  if ((result.status ?? 1) !== 0) {
    console.warn(`${logPrefix} firestore emulator cache warmup exited with code ${result.status ?? 'unknown'}. continuing without warmup.`);
    return false;
  }
  return true;
}

export function defaultBootstrapCommand() {
  return [
    'if [ ! -d /work/node_modules/.bin ]; then mkdir -p /work/node_modules && cp -a /opt/deps/node_modules/. /work/node_modules/; fi',
    'if [ -n "${FIRESTACK_FUNCTIONS_PATHS:-}" ]; then IFS=\',\' read -r -a firestack_functions <<< "$FIRESTACK_FUNCTIONS_PATHS"; for rel in "${firestack_functions[@]}"; do if [ -n "$rel" ] && [ -d "/opt/deps/$rel/node_modules" ] && [ -f "/work/$rel/package.json" ] && [ ! -d "/work/$rel/node_modules/.bin" ]; then mkdir -p "/work/$rel/node_modules" && cp -a "/opt/deps/$rel/node_modules/." "/work/$rel/node_modules/"; fi; done; fi',
  ].join(' && ');
}

export function createDockerTask({ cwd, logPrefix, dockerConfig, env = process.env, firebaseConfigPath = null, forceRebuild = false }) {
  const dockerfilePath = dockerConfig.dockerfile ?? 'tests/Dockerfile';
  const dockerfileAbsolutePath = resolve(cwd, dockerfilePath);
  const resolvedFirebaseConfigPath = firebaseConfigPath
    ? (resolve(cwd, firebaseConfigPath))
    : resolve(cwd, 'firebase.json');
  const functionsPaths = discoverFunctionsPaths(cwd, resolvedFirebaseConfigPath);
  if (!existsSync(dockerfileAbsolutePath)) {
    fail(
      logPrefix,
      `missing dockerfile "${dockerfilePath}" in target project. ` +
      'Run "npx firestack docker init" (or "npx firestack init") and try again.'
    );
  }
  const namespace = getArtifactNamespace(cwd, env);
  const imageBaseName = `${dockerConfig.imageBaseName ?? 'firestack-tests'}-${namespace}`;
  const nodeModulesVolumePrefix = `${dockerConfig.nodeModulesVolumePrefix ?? 'firestack-node_modules-'}${namespace}-`;
  const functionsNodeModulesVolumePrefix = `${dockerConfig.functionsNodeModulesVolumePrefix ?? 'firestack-functions-node_modules-'}${namespace}-`;
  const emulatorCacheVolume = `${dockerConfig.emulatorCacheVolumePrefix ?? 'firestack-firebase-cache-'}${namespace}`;
  const depsHash = computeDepsHash(cwd, dockerfilePath, dockerConfig.lockfilePath ?? 'package-lock.json', functionsPaths);
  const image = `${imageBaseName}:${depsHash}`;
  const nodeModulesVolume = `${nodeModulesVolumePrefix}${depsHash}`;
  const functionModuleMounts = functionsPaths.map((path) => {
    const pathHash = createHash('sha256').update(path).digest('hex').slice(0, 8);
    return {
      path,
      volume: `${functionsNodeModulesVolumePrefix}${pathHash}-${depsHash}`,
    };
  });
  const functionsPathsCsv = functionsPaths.join(',');
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
  const firebaseConfigRelPathRaw = relative(cwd, resolvedFirebaseConfigPath).replaceAll('\\', '/');
  if (firebaseConfigRelPathRaw.startsWith('..') || isAbsolute(firebaseConfigRelPathRaw)) {
    fail(logPrefix, `firebase config path must be inside project root: ${resolvedFirebaseConfigPath}`);
  }
  const firebaseConfigRelPath = firebaseConfigRelPathRaw || 'firebase.json';
  const imageBuildArgs = [
    ...buildNetworkArgs,
    ...buildHostArgs,
    '--build-arg',
    `FIREBASE_CONFIG_PATH=${firebaseConfigRelPath}`,
  ];
  const writablePaths = Array.isArray(dockerConfig.writablePaths)
    ? dockerConfig.writablePaths
    : ['out'];
  const preloadFirestoreEmulator = dockerConfig.preloadFirestoreEmulator !== false;

  return {
    image,
    nodeModulesVolume,
    emulatorCacheVolume,
    prepare() {
      ensureImage(logPrefix, image, dockerfilePath, cwd, depsHash, imageBuildArgs, forceRebuild);
      if (useHostUser) {
        ensureBindPathsWritableForUser(logPrefix, image, cwd, process.getuid(), process.getgid(), workdir, writablePaths);
        ensureVolumeWritableForUser(logPrefix, image, nodeModulesVolume, process.getuid(), process.getgid(), workdir);
        for (const mount of functionModuleMounts) {
          ensureVolumeWritableForUser(
            logPrefix,
            image,
            mount.volume,
            process.getuid(),
            process.getgid(),
            workdir,
            `${mount.path}/node_modules`
          );
        }
        ensureVolumeWritableForUser(logPrefix, image, emulatorCacheVolume, process.getuid(), process.getgid(), '/firestack-cache', 'firebase/emulators');
      }
      if (preloadFirestoreEmulator) {
        ensureFirestoreEmulatorCached(
          logPrefix,
          image,
          emulatorCacheVolume,
          useHostUser ? process.getuid() : null,
          useHostUser ? process.getgid() : null
        );
      }
      if (dockerConfig.cleanup !== false) {
        cleanupOldDockerArtifacts(
          logPrefix,
          imageBaseName,
          [nodeModulesVolumePrefix, functionsNodeModulesVolumePrefix, `${dockerConfig.emulatorCacheVolumePrefix ?? 'firestack-firebase-cache-'}${namespace}`],
          image,
          [nodeModulesVolume, ...functionModuleMounts.map((mount) => mount.volume), emulatorCacheVolume]
        );
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
        ...functionModuleMounts.flatMap((mount) => ['-v', `${mount.volume}:${workdir}/${mount.path}/node_modules`]),
        '-v',
        `${emulatorCacheVolume}:/firestack-cache`,
        '-w',
        workdir,
        ...hostArgs,
        ...resourceArgs,
        ...extraArgs,
        ...dockerEnvArgs,
        '-e',
        'FIREBASE_EMULATORS_PATH=/firestack-cache/firebase/emulators',
        '-e',
        `FIRESTACK_FUNCTIONS_PATHS=${functionsPathsCsv}`,
        image,
        'bash',
        '-lc',
        command,
      ];

      const result = runDocker(args, { stdio: 'inherit' });
      if (result.error) {
        fail(logPrefix, `failed to execute docker: ${result.error.message}`);
      }
      return result.status ?? 1;
    },
  };
}
