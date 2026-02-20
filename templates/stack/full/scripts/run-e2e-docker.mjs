import { createDockerTask, commonNodeModulesBootstrapCommand } from './lib/docker-runner.mjs';
import { resolveSuite, validateExternalBaseUrl } from './lib/e2e-runner.mjs';

const LOG_PREFIX = '[test:e2e:docker]';

function main() {
  const suite = resolveSuite(process.argv[2]);
  const externalBaseUrl = process.env.E2E_BASE_URL?.trim();
  validateExternalBaseUrl(externalBaseUrl, LOG_PREFIX);

  const task = createDockerTask(LOG_PREFIX);
  task.prepare();

  const command = externalBaseUrl
    ? `${commonNodeModulesBootstrapCommand()} && node firestack/scripts/run-e2e.mjs ${suite}`
    : `${commonNodeModulesBootstrapCommand()} && npm --prefix functions run build && firebase emulators:exec --project demo-present-goal "node firestack/scripts/run-e2e.mjs ${suite}"`;

  console.log(`${LOG_PREFIX} image: ${task.image}`);
  console.log(`${LOG_PREFIX} node_modules volume: ${task.nodeModulesVolume}`);
  console.log(`${LOG_PREFIX} suite: ${suite}`);

  task.run({
    command,
    envNames: [
      'E2E_BASE_URL',
      'E2E_SUITE',
      'E2E_CLEANUP',
      'E2E_EMAIL',
      'E2E_PASSWORD',
      'E2E_RUN_ID',
      'E2E_APP_CHECK_DEBUG_TOKEN',
      'GCLOUD_PROJECT',
      'FIREBASE_AUTH_EMULATOR_HOST',
      'FIRESTORE_EMULATOR_HOST',
      'VITE_USE_FIREBASE_EMULATOR',
      'VITE_FIREBASE_EMULATOR_HOST',
      'ALLOW_NON_STAGING_E2E',
    ],
  });
}

main();
