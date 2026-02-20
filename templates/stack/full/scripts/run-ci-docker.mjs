import { createDockerTask, commonNodeModulesBootstrapCommand } from './lib/docker-runner.mjs';
import { assertNoExternalBaseUrlForCi } from './lib/e2e-runner.mjs';

const LOG_PREFIX = '[test:ci:docker]';

function main() {
  const suite = process.env.E2E_SUITE === 'full' ? 'full' : 'smoke';
  assertNoExternalBaseUrlForCi(LOG_PREFIX);
  const task = createDockerTask(LOG_PREFIX);
  task.prepare();

  console.log(`${LOG_PREFIX} image: ${task.image}`);
  console.log(`${LOG_PREFIX} node_modules volume: ${task.nodeModulesVolume}`);

  task.run({
    command: [
      commonNodeModulesBootstrapCommand(),
      'node --test --experimental-strip-types firestack/tests/unit/**/*.test.ts',
      'npm --prefix functions run build',
      'mkdir -p out/test-results test-results',
      'rm -f out/test-results/integration.junit.xml test-results/e2e-junit.xml out/test-results/emulator-exit-code.txt',
      `(firebase emulators:exec --project demo-present-goal "node firestack/scripts/run-integration-report.mjs && node firestack/scripts/run-e2e.mjs ${suite}" || echo $? > out/test-results/emulator-exit-code.txt)`,
      'node firestack/scripts/report-ci-test-summary.mjs',
    ].join(' && '),
    envNames: [
      'E2E_CLEANUP',
      'E2E_RUN_ID',
      'E2E_EMAIL',
      'E2E_PASSWORD',
      'GCLOUD_PROJECT',
      'STRIPE_WEBHOOK_SECRET',
      'STRIPE_SECRET_KEY',
      'FIREBASE_AUTH_EMULATOR_HOST',
      'FIRESTORE_EMULATOR_HOST',
      'VITE_USE_FIREBASE_EMULATOR',
      'VITE_FIREBASE_EMULATOR_HOST',
    ],
  });
}

main();
