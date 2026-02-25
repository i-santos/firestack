import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { buildPlaywrightFilterArgs, buildRunId, resolveSuite, validateExternalBaseUrl } from './internal-e2e-runner.mjs';

const hasPlaywrightPkg = existsSync('node_modules/@playwright/test/package.json');
const playwrightBin = process.platform === 'win32'
  ? 'node_modules/.bin/playwright.cmd'
  : 'node_modules/.bin/playwright';

if (!hasPlaywrightPkg || !existsSync(playwrightBin)) {
  console.log('[test:e2e] @playwright/test is not installed. Skipping E2E.');
  console.log('[test:e2e] To enable: npm install -D @playwright/test && npx playwright install');
  process.exit(0);
}

async function waitForUrl(url, timeoutMs = 40_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) return;
    } catch {
      // retry
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 350));
  }
  throw new Error(`Timeout waiting for app at ${url}`);
}

function detectViteUrlFromOutput(line) {
  const clean = line.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');
  const direct = clean.match(/(https?:\/\/127\.0\.0\.1:\d+)/);
  if (direct) return direct[1];
  const local = clean.match(/Local:\s+(https?:\/\/[^\s]+)/);
  return local ? local[1] : null;
}

function startDevServer() {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdoutBuffer = '';
    let stderrBuffer = '';
    const devServer = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173'], {
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        VITE_USE_FIREBASE_EMULATOR: process.env.VITE_USE_FIREBASE_EMULATOR ?? 'true',
        VITE_FIREBASE_EMULATOR_HOST: process.env.VITE_FIREBASE_EMULATOR_HOST ?? '127.0.0.1',
      },
    });

    const onData = (chunk) => {
      const text = chunk.toString();
      process.stdout.write(text);
      if (settled) return;
      stdoutBuffer = `${stdoutBuffer}${text}`.slice(-16_384);
      const foundUrl = detectViteUrlFromOutput(stdoutBuffer);
      if (foundUrl) {
        settled = true;
        resolve({ devServer, baseUrl: foundUrl });
        return;
      }
      // Fallback: if Vite is ready but URL line is styled/fragmented unexpectedly,
      // use the known host/port we launch with.
      if (/VITE\s+v\d/i.test(stdoutBuffer) && /\bready in\b/i.test(stdoutBuffer)) {
        settled = true;
        resolve({ devServer, baseUrl: 'http://127.0.0.1:5173' });
      }
    };

    const onError = (chunk) => {
      const text = chunk.toString();
      process.stderr.write(text);
      stderrBuffer = `${stderrBuffer}${text}`.slice(-8_192);
      if (!settled && /error/i.test(text)) {
        settled = true;
        reject(new Error(`[test:e2e] failed to start app: ${stderrBuffer.trim()}`));
      }
    };

    devServer.stdout.on('data', onData);
    devServer.stderr.on('data', onError);
    devServer.on('exit', (code) => {
      if (!settled) {
        settled = true;
        reject(new Error(`[test:e2e] dev server exited before startup (code=${code ?? 'null'})`));
      }
    });
  });
}

function stopDevServer(devServer) {
  if (!devServer || devServer.killed) return;
  try {
    if (process.platform !== 'win32' && typeof devServer.pid === 'number') {
      process.kill(-devServer.pid, 'SIGTERM');
      return;
    }
    devServer.kill('SIGTERM');
  } catch {
    // ignore teardown errors
  }
}

async function main() {
  const suite = resolveSuite(process.argv[2]);
  const filterArgs = buildPlaywrightFilterArgs(suite);
  const runId = buildRunId(process.env.E2E_RUN_ID);
  const externalBaseUrl = process.env.E2E_BASE_URL?.trim();
  validateExternalBaseUrl(externalBaseUrl, '[test:e2e]');
  const shouldStartDevServer = !externalBaseUrl;
  const projectId = process.env.GCLOUD_PROJECT?.trim();
  let devServer = null;
  let baseUrl = externalBaseUrl ?? '';

  try {
    if (shouldStartDevServer) {
      console.log('[test:e2e] starting app with Vite (prefers 5173; auto-fallback enabled)...');
      const started = await startDevServer();
      devServer = started.devServer;
      baseUrl = started.baseUrl;
      await waitForUrl(baseUrl);
    } else {
      console.log(`[test:e2e] using existing app at ${baseUrl}`);
    }

    const cleanup = process.env.E2E_CLEANUP ?? (shouldStartDevServer ? 'true' : 'false');
    const result = spawnSync(playwrightBin, ['test', '--project=chromium', ...filterArgs, 'tests/e2e'], {
      stdio: 'inherit',
      env: {
        ...process.env,
        E2E_SUITE: suite,
        E2E_RUN_ID: runId,
        E2E_CLEANUP: cleanup,
        E2E_BASE_URL: baseUrl,
        ...(projectId ? { GCLOUD_PROJECT: projectId } : {}),
        FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099',
        FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080',
      },
    });

    process.exit(result.status ?? 1);
  } finally {
    stopDevServer(devServer);
  }
}

main().catch((error) => {
  console.error('[test:e2e] failed to run e2e:', error);
  process.exit(1);
});
