import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173';

function normalizeHost(rawUrl) {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function resolvePlaywrightOutputBaseDir(env = process.env) {
  const explicitJunit = env.PLAYWRIGHT_JUNIT_OUTPUT_FILE?.trim();
  const explicitHtml = env.PLAYWRIGHT_HTML_OUTPUT_DIR?.trim();
  const explicitArtifacts = env.PLAYWRIGHT_OUTPUT_DIR?.trim();
  if (explicitJunit || explicitHtml || explicitArtifacts) {
    return 'out/tests/e2e';
  }

  const profileAlias = env.FIREBASE_PROJECT_ALIAS?.trim().toLowerCase();
  if (profileAlias === 'staging') {
    return 'out/tests/e2e/staging';
  }

  const host = normalizeHost(env.E2E_BASE_URL?.trim());
  if (host === 'staging.presentgoal.com') {
    return 'out/tests/e2e/staging';
  }

  return 'out/tests/e2e';
}

const baseOutputDir = resolvePlaywrightOutputBaseDir(process.env);
const junitOutputFile = process.env.PLAYWRIGHT_JUNIT_OUTPUT_FILE ?? `${baseOutputDir}/junit.xml`;
const htmlOutputFolder = process.env.PLAYWRIGHT_HTML_OUTPUT_DIR ?? `${baseOutputDir}/html`;
const outputDir = process.env.PLAYWRIGHT_OUTPUT_DIR ?? `${baseOutputDir}/artifacts`;

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: htmlOutputFolder, open: 'never' }],
    ['junit', { outputFile: junitOutputFile }],
  ],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
