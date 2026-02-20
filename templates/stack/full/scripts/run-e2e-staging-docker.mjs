import { createDockerTask, commonNodeModulesBootstrapCommand, failWithPrefix } from './lib/docker-runner.mjs';
import { requireProject, resolveSuite, validateStagingBaseUrl } from './lib/e2e-runner.mjs';

const LOG_PREFIX = '[test:e2e:staging:docker]';

function main() {
  const suite = resolveSuite(process.argv[2]);

  try {
    requireProject('staging-present-goal', process.env.GCLOUD_PROJECT ?? 'staging-present-goal', LOG_PREFIX);
    validateStagingBaseUrl(process.env.E2E_BASE_URL ?? 'https://staging.presentgoal.com', LOG_PREFIX);
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(`${LOG_PREFIX} `, '') : String(error);
    failWithPrefix(LOG_PREFIX, message);
  }

  const task = createDockerTask(LOG_PREFIX);
  task.prepare();

  console.log(`${LOG_PREFIX} image: ${task.image}`);
  console.log(`${LOG_PREFIX} node_modules volume: ${task.nodeModulesVolume}`);
  console.log(`${LOG_PREFIX} suite: ${suite}`);

  task.run({
    command: `${commonNodeModulesBootstrapCommand()} && node firestack/scripts/run-e2e-staging.mjs ${suite}`,
    envNames: [
      'GCLOUD_PROJECT',
      'E2E_BASE_URL',
      'E2E_CLEANUP',
      'E2E_RUN_ID',
      'E2E_STAGING_EMAIL',
      'E2E_STAGING_PASSWORD',
      'E2E_STAGING_SMOKE_EMAIL',
      'E2E_STAGING_SMOKE_PASSWORD',
      'E2E_STAGING_FULL_EMAIL',
      'E2E_STAGING_FULL_PASSWORD',
      'E2E_APP_CHECK_DEBUG_TOKEN',
      'ALLOW_NON_STAGING_E2E',
    ],
  });
}

main();
