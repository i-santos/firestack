import { spawnSync } from 'node:child_process';

function has(flag) {
  return process.argv.includes(flag);
}

function run(command, args, label) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: process.env });
  if (result.error) {
    throw new Error(`${label}: ${result.error.message}`);
  }
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runShell(script, label) {
  run('bash', ['-lc', script], label);
}

function suiteFromArgs() {
  if (has('--full')) return 'full';
  return 'smoke';
}

function projectId() {
  return process.env.GCLOUD_PROJECT ?? 'demo-present-goal';
}

function runUnit(docker) {
  if (!docker) {
    run('node', ['--test', '--experimental-strip-types', 'firestack/tests/unit/**/*.test.ts'], 'unit');
    return;
  }

  run(
    'bash',
    ['firestack/scripts/docker-suite.sh', '--env-file', 'firestack/env/.env.fs.test.development', '--', 'node', '--test', '--experimental-strip-types', 'firestack/tests/unit/**/*.test.ts'],
    'unit:docker'
  );
}

function runIntegration(docker) {
  const project = projectId();
  const command = `npm --prefix functions run build && firebase emulators:exec --project ${project} "node firestack/scripts/run-integration-report.mjs"`;

  if (!docker) {
    runShell(command, 'integration');
    return;
  }

  run(
    'bash',
    [
      'firestack/scripts/docker-suite.sh',
      '--env-file',
      'firestack/env/.env.fs.test.development',
      '--',
      'bash',
      '-lc',
      command,
    ],
    'integration:docker'
  );
}

function runE2E(docker, suite) {
  if (!docker) {
    run('node', ['firestack/scripts/run-e2e.mjs', suite], 'e2e');
    return;
  }
  run('node', ['firestack/scripts/run-e2e-docker.mjs', suite], 'e2e:docker');
}

function runStaging(docker, suite) {
  if (!docker) {
    run('node', ['--env-file-if-exists=firestack/env/.env.fs.test.staging', 'firestack/scripts/run-e2e-staging.mjs', suite], 'staging');
    return;
  }
  run('node', ['--env-file-if-exists=firestack/env/.env.fs.test.staging', 'firestack/scripts/run-e2e-staging-docker.mjs', suite], 'staging:docker');
}

function runCi(docker, suite) {
  if (docker) {
    runShell(`E2E_SUITE=${suite} node firestack/scripts/run-ci-docker.mjs`, 'ci:docker');
    return;
  }

  runUnit(false);
  runIntegration(false);
  runE2E(false, suite);
}

function main() {
  const docker = has('--docker');
  const suite = suiteFromArgs();

  const explicit = {
    ci: has('--ci'),
    unit: has('--unit'),
    integration: has('--integration'),
    e2e: has('--e2e'),
    staging: has('--staging'),
  };

  const selectedCount = Object.values(explicit).filter(Boolean).length;

  if (selectedCount === 0) {
    runCi(docker, suite);
    return;
  }

  if (explicit.ci) {
    runCi(docker, suite);
    return;
  }

  if (explicit.unit) runUnit(docker);
  if (explicit.integration) runIntegration(docker);
  if (explicit.e2e) runE2E(docker, suite);
  if (explicit.staging) runStaging(docker, suite);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[firestack] test runner failed: ${message}`);
  process.exit(1);
}
