import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const DOCKERFILE_PATH = 'firestack/tests/integration/Dockerfile';
const REPO_PATH = process.cwd();
const LEGACY_IMAGE_BASE_NAME = 'present-goal-e2e-tests';
const LEGACY_VOLUME_PREFIX = 'present-goal-e2e-node_modules-';

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

function extractDependencyInputs() {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
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

function computeDepsHash() {
  const hash = createHash('sha256');
  hash.update(readFileSync(DOCKERFILE_PATH));
  hash.update(extractDependencyInputs());
  hash.update(readFileSync('package-lock.json'));
  return hash.digest('hex').slice(0, 12);
}

function getArtifactNamespace() {
  return (process.env.TEST_DOCKER_NAMESPACE?.trim() || createHash('sha256').update(REPO_PATH).digest('hex').slice(0, 8)).toLowerCase();
}

function ensureImage(logPrefix, image, depsHash) {
  const imageExists = runDocker(['image', 'inspect', image], { stdio: 'ignore' }).status === 0;
  if (imageExists) return;

  console.log(`${logPrefix} building image ${image} (deps hash: ${depsHash})`);
  runDockerStrict(logPrefix, 'failed to build docker image', ['build', '-f', DOCKERFILE_PATH, '-t', image, REPO_PATH], { stdio: 'inherit' });
}

function cleanupOldDockerArtifacts(logPrefix, imageBaseName, volumePrefix, keepImage, keepVolume) {
  const imagePrefixes = [imageBaseName, LEGACY_IMAGE_BASE_NAME];
  const volumePrefixes = [volumePrefix, LEGACY_VOLUME_PREFIX];

  const images = listDockerLines(['image', 'ls', '--format', '{{.Repository}}:{{.Tag}}']);
  for (const image of images) {
    const shouldCleanup = imagePrefixes.some((prefix) => image.startsWith(`${prefix}:`)) && image !== keepImage;
    if (shouldCleanup) {
      removeDockerArtifact(logPrefix, 'image', image, ['image', 'rm', image]);
    }
  }

  const volumes = listDockerLines(['volume', 'ls', '--format', '{{.Name}}']);
  for (const volume of volumes) {
    const shouldCleanup = volumePrefixes.some((prefix) => volume.startsWith(prefix)) && volume !== keepVolume;
    if (shouldCleanup) {
      removeDockerArtifact(logPrefix, 'volume', volume, ['volume', 'rm', volume]);
    }
  }
}

function buildEnvArgs(envNames) {
  return envNames
    .filter((name) => typeof process.env[name] === 'string' && process.env[name] !== '')
    .flatMap((name) => ['-e', `${name}=${process.env[name]}`]);
}

function buildResourceArgs() {
  const memory = process.env.TEST_DOCKER_MEMORY?.trim();
  const memorySwap = process.env.TEST_DOCKER_MEMORY_SWAP?.trim();
  const cpus = process.env.TEST_DOCKER_CPUS?.trim();
  const pidsLimit = process.env.TEST_DOCKER_PIDS_LIMIT?.trim();
  const args = [];

  if (memory) {
    args.push('--memory', memory);
  }
  if (memorySwap) {
    args.push('--memory-swap', memorySwap);
  }
  if (cpus) {
    args.push('--cpus', cpus);
  }
  if (pidsLimit) {
    args.push('--pids-limit', pidsLimit);
  }

  return args;
}

export function createDockerTask(logPrefix) {
  const namespace = getArtifactNamespace();
  const imageBaseName = `${LEGACY_IMAGE_BASE_NAME}-${namespace}`;
  const volumePrefix = `${LEGACY_VOLUME_PREFIX}${namespace}-`;
  const depsHash = computeDepsHash();
  const image = `${imageBaseName}:${depsHash}`;
  const nodeModulesVolume = `${volumePrefix}${depsHash}`;

  return {
    logPrefix,
    image,
    nodeModulesVolume,
    prepare() {
      ensureImage(logPrefix, image, depsHash);
      cleanupOldDockerArtifacts(logPrefix, imageBaseName, volumePrefix, image, nodeModulesVolume);
    },
    run({ command, envNames, extraArgs = [] }) {
      const dockerEnvArgs = buildEnvArgs(envNames);
      const resourceArgs = buildResourceArgs();
      const args = [
        'run',
        '--rm',
        '-t',
        '-v',
        `${REPO_PATH}:/work`,
        '-v',
        `${nodeModulesVolume}:/work/node_modules`,
        '-w',
        '/work',
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

export function commonNodeModulesBootstrapCommand() {
  return 'if [ ! -d /work/node_modules/firebase ]; then mkdir -p /work/node_modules && cp -a /opt/deps/node_modules/. /work/node_modules/; fi';
}

export function failWithPrefix(logPrefix, message, exitCode = 1) {
  fail(logPrefix, message, exitCode);
}
