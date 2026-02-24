import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePlaywrightOutputBaseDir } from '../../templates/playwright.config.mjs';

test('resolvePlaywrightOutputBaseDir: default path for local/non-staging context', () => {
  assert.equal(resolvePlaywrightOutputBaseDir({}), 'out/tests/e2e');
  assert.equal(resolvePlaywrightOutputBaseDir({ E2E_BASE_URL: 'http://127.0.0.1:5173' }), 'out/tests/e2e');
});

test('resolvePlaywrightOutputBaseDir: staging path when project alias is staging', () => {
  assert.equal(
    resolvePlaywrightOutputBaseDir({ FIREBASE_PROJECT_ALIAS: 'staging' }),
    'out/tests/e2e/staging'
  );
});

test('resolvePlaywrightOutputBaseDir: staging path when target host is staging.presentgoal.com', () => {
  assert.equal(
    resolvePlaywrightOutputBaseDir({ E2E_BASE_URL: 'https://staging.presentgoal.com' }),
    'out/tests/e2e/staging'
  );
});

test('resolvePlaywrightOutputBaseDir: explicit PLAYWRIGHT output overrides keep base default', () => {
  assert.equal(
    resolvePlaywrightOutputBaseDir({ PLAYWRIGHT_HTML_OUTPUT_DIR: 'custom/html/path' }),
    'out/tests/e2e'
  );
});
