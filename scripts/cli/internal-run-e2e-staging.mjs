import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildRunId,
  requireProject,
  resolveStagingCredentials,
  resolveSuite,
  validateStagingBaseUrl,
} from './internal-e2e-runner.mjs';

const suite = resolveSuite(process.argv[2]);
const runId = buildRunId(process.env.E2E_RUN_ID ?? `stg-${suite}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
const configuredProjectId = process.env.STAGING_PROJECT_ID?.trim();
const currentProjectId = process.env.GCLOUD_PROJECT?.trim();
if (!currentProjectId) {
  throw new Error(
    '[test:e2e:staging] missing GCLOUD_PROJECT. Set it explicitly or configure .firebaserc (default alias or FIREBASE_ALIAS).'
  );
}
const projectId = configuredProjectId
  ? requireProject(configuredProjectId, currentProjectId, '[test:e2e:staging]')
  : currentProjectId;
const baseUrl = process.env.E2E_BASE_URL ?? 'https://staging.presentgoal.com';
validateStagingBaseUrl(baseUrl, '[test:e2e:staging]');

const { emailVar, passwordVar, email, password, useFixedUser } = resolveStagingCredentials(suite);
if (!useFixedUser) {
  console.log('[test:e2e:staging] Running with ephemeral user (no fixed credentials provided).');
  console.log(`[test:e2e:staging] To use fixed user set ${emailVar}/${passwordVar} or E2E_STAGING_EMAIL/E2E_STAGING_PASSWORD.`);
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const e2eRunnerPath = join(currentDir, 'internal-run-e2e.mjs');

const result = spawnSync('node', [e2eRunnerPath, suite], {
  stdio: 'inherit',
  env: {
    ...process.env,
    E2E_BASE_URL: baseUrl,
    E2E_SUITE: suite,
    E2E_CLEANUP: process.env.E2E_CLEANUP ?? 'false',
    E2E_RUN_ID: runId,
    GCLOUD_PROJECT: projectId,
    ...(useFixedUser ? { E2E_EMAIL: email, E2E_PASSWORD: password } : {}),
  },
});

process.exit(result.status ?? 1);
