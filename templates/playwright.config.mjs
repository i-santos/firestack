import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173';
const junitOutputFile = process.env.PLAYWRIGHT_JUNIT_OUTPUT_FILE ?? 'out/test-results/e2e/junit.xml';
const htmlOutputFolder = process.env.PLAYWRIGHT_HTML_OUTPUT_DIR ?? 'out/test-results/e2e/html';

export default defineConfig({
  testDir: 'tests/e2e',
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
