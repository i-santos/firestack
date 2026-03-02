import { spawnSync } from 'node:child_process';

function run(cmd, args, { cwd = process.cwd(), env = process.env, allowFailure = false } = {}) {
  const result = spawnSync(cmd, args, { cwd, env, encoding: 'utf8' });
  if (result.error) {
    throw new Error(`failed to run ${cmd} ${args.join(' ')}: ${result.error.message}`);
  }
  const status = result.status ?? 1;
  if (!allowFailure && status !== 0) {
    const stderr = (result.stderr || '').trim();
    const stdout = (result.stdout || '').trim();
    throw new Error(`command failed (${status}): ${cmd} ${args.join(' ')}${stderr ? `\n${stderr}` : (stdout ? `\n${stdout}` : '')}`);
  }
  return result;
}

function sleep(seconds) {
  run('bash', ['-lc', `sleep ${seconds}`], { allowFailure: false });
}

function ensureDocker() {
  run('docker', ['--version']);
}

function waitForHttp(url, timeoutSeconds = 30) {
  const started = Date.now();
  while (Date.now() - started < timeoutSeconds * 1000) {
    const probe = run('curl', ['-fsS', url], { allowFailure: true });
    if ((probe.status ?? 1) === 0) return;
    sleep(1);
  }
  throw new Error(`timeout waiting for service health at ${url}`);
}

function normalizeService(entry) {
  if (typeof entry === 'string') {
    return { name: entry.trim().toLowerCase() };
  }
  if (!entry || typeof entry !== 'object') return null;
  const name = String(entry.name ?? '').trim().toLowerCase();
  if (!name) return null;
  return { ...entry, name };
}

function resolveServicesForKey(config, key) {
  const raw = config?.test?.services;
  if (!raw || typeof raw !== 'object') return [];

  const from = (k) => Array.isArray(raw[k]) ? raw[k] : [];

  if (key === 'integration') return from('integration');
  if (key.startsWith('ci')) return [...from('ci'), ...from('integration')];
  if (key.startsWith('e2e')) return from('e2e');
  if (key.startsWith('staging')) return [...from('staging'), ...from('e2e')];
  if (key === 'unit') return from('unit');
  return [];
}

function startMailhog(service) {
  ensureDocker();
  const smtpPort = Number(service.smtpPort ?? 1025);
  const httpPort = Number(service.httpPort ?? 8025);
  const image = String(service.image ?? 'mailhog/mailhog:v1.0.1');
  const containerName = String(service.containerName ?? `firestack-mailhog-${smtpPort}-${httpPort}`);
  const healthUrl = String(service.healthUrl ?? `http://127.0.0.1:${httpPort}/api/v2/messages`);
  const timeoutSeconds = Number(service.healthTimeoutSeconds ?? 30);

  run('docker', ['rm', '-f', containerName], { allowFailure: true });
  run('docker', [
    'run', '-d', '--name', containerName,
    '-p', `${smtpPort}:1025`,
    '-p', `${httpPort}:8025`,
    image,
  ]);

  try {
    waitForHttp(healthUrl, timeoutSeconds);
  } catch (error) {
    run('docker', ['logs', containerName], { allowFailure: true });
    run('docker', ['rm', '-f', containerName], { allowFailure: true });
    throw error;
  }

  return {
    stop() {
      run('docker', ['rm', '-f', containerName], { allowFailure: true });
    },
    env: {
      MAILHOG_HOST: String(service.host ?? '127.0.0.1'),
      MAILHOG_PORT: String(smtpPort),
      MAILHOG_API_BASE_URL: `http://127.0.0.1:${httpPort}`,
    },
  };
}

export function startTestServices({ config, key }) {
  const requested = resolveServicesForKey(config, key)
    .map(normalizeService)
    .filter(Boolean);

  const stoppers = [];
  const env = {};

  try {
    for (const service of requested) {
      if (service.name === 'mailhog') {
        const runtime = startMailhog(service);
        stoppers.push(runtime.stop);
        Object.assign(env, runtime.env);
        continue;
      }
      throw new Error(`unsupported test service: ${service.name}`);
    }
  } catch (error) {
    for (const stop of stoppers.reverse()) {
      try { stop(); } catch {}
    }
    throw error;
  }

  return {
    env,
    stop() {
      for (const stop of stoppers.reverse()) {
        try { stop(); } catch {}
      }
    },
  };
}
