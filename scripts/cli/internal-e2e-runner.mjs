export function resolveSuite(rawSuite) {
  const suiteArg = (rawSuite ?? 'smoke').trim().toLowerCase();
  return suiteArg === 'full' ? 'full' : 'smoke';
}

export function isOverrideAllowed() {
  return process.env.ALLOW_NON_STAGING_E2E === 'true';
}

function normalizeHost(rawUrl) {
  const url = new URL(rawUrl);
  return url.hostname.toLowerCase();
}

export function validateExternalBaseUrl(baseUrl, logPrefix) {
  if (!baseUrl) return;
  if (isOverrideAllowed()) return;

  let host;
  try {
    host = normalizeHost(baseUrl);
  } catch {
    throw new Error(`${logPrefix} Invalid E2E_BASE_URL: ${baseUrl}`);
  }

  const allowedHosts = new Set(['localhost', '127.0.0.1', 'staging.presentgoal.com']);
  if (!allowedHosts.has(host)) {
    throw new Error(
      `${logPrefix} Refusing E2E_BASE_URL host "${host}". Allowed: localhost, 127.0.0.1, staging.presentgoal.com. ` +
      'Set ALLOW_NON_STAGING_E2E=true to override explicitly.'
    );
  }
}

export function validateStagingBaseUrl(baseUrl, logPrefix) {
  if (!baseUrl) return;
  if (isOverrideAllowed()) return;

  let host;
  try {
    host = normalizeHost(baseUrl);
  } catch {
    throw new Error(`${logPrefix} Invalid E2E_BASE_URL: ${baseUrl}`);
  }

  if (host !== 'staging.presentgoal.com') {
    throw new Error(
      `${logPrefix} Refusing E2E_BASE_URL host "${host}" for staging runner. Allowed only: staging.presentgoal.com. ` +
      'Set ALLOW_NON_STAGING_E2E=true to override explicitly.'
    );
  }
}

export function grepTagForSuite(suite) {
  return suite === 'full' ? '@full' : '@smoke';
}

export function buildRunId(raw) {
  const value = raw ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return value.replace(/[^a-zA-Z0-9_-]/g, '');
}

export function requireProject(expectedProjectId, currentProjectId, logPrefix) {
  if (currentProjectId !== expectedProjectId) {
    throw new Error(`${logPrefix} Refusing to run with GCLOUD_PROJECT=${currentProjectId}. Expected ${expectedProjectId}.`);
  }
  return currentProjectId;
}

export function resolveStagingCredentials(suite) {
  const emailVar = suite === 'smoke' ? 'E2E_STAGING_SMOKE_EMAIL' : 'E2E_STAGING_FULL_EMAIL';
  const passwordVar = suite === 'smoke' ? 'E2E_STAGING_SMOKE_PASSWORD' : 'E2E_STAGING_FULL_PASSWORD';
  const email = process.env[emailVar] ?? process.env.E2E_STAGING_EMAIL;
  const password = process.env[passwordVar] ?? process.env.E2E_STAGING_PASSWORD;
  const useFixedUser = Boolean(email && password);
  return { emailVar, passwordVar, email, password, useFixedUser };
}
