import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjectConfig } from './config.mjs';
import { createDockerTask, defaultBootstrapCommand } from './docker-runner.mjs';
import { parseEnvFile, resolveFunctionsRuntimeEnv } from './functions-env.mjs';

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

function supportsAnsiColor() {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR === '0') return false;
  if (process.env.FORCE_COLOR) return true;
  if (!process.stdout.isTTY) return false;
  return process.env.TERM !== 'dumb';
}

const COLORS_ENABLED = supportsAnsiColor();

function paint(text, ...styles) {
  if (!COLORS_ENABLED || styles.length === 0) return text;
  return `${styles.join('')}${text}${ANSI.reset}`;
}

function printHelp() {
  console.log(
    'Usage: firestack test [--ci|--unit|--integration|--e2e|--staging] [--docker] [--docker-rebuild] [--fail-fast] [--full] ' +
    '[--profile <alias>] [--firebase-config <path>] ' +
    '[--infra-logs <compact|verbose|quiet>] [--infra-log-file <path>] [--suite-log-file <path>] [--log-append] [--no-log-routing] ' +
    '[--target <dir>] [--config <path>]'
  );
}

function runShell(cwd, script, label, env = process.env) {
  const result = spawnSync('bash', ['-lc', script], {
    cwd,
    stdio: 'inherit',
    env,
  });
  if (result.error) {
    throw new Error(`${label}: ${result.error.message}`);
  }
  return result.status ?? 1;
}

function resolveFirebaseProjectFromRc(cwd, { preferredAlias = null, strictAlias = false } = {}) {
  const rcPath = resolve(cwd, '.firebaserc');
  if (!existsSync(rcPath)) return null;

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(rcPath, 'utf8'));
  } catch {
    throw new Error(`invalid JSON in ${rcPath}`);
  }

  const projects = parsed?.projects;
  if (!projects || typeof projects !== 'object') return null;

  const envAlias = typeof process.env.FIREBASE_ALIAS === 'string' && process.env.FIREBASE_ALIAS.trim()
    ? process.env.FIREBASE_ALIAS.trim()
    : null;
  const selectedAlias = preferredAlias || envAlias || 'default';

  let alias = selectedAlias;
  let projectId = projects[alias];

  if (typeof projectId !== 'string' || !projectId.trim()) {
    if (strictAlias) {
      throw new Error(`missing Firebase project alias "${alias}" in ${rcPath}`);
    }
    const firstAlias = Object.keys(projects).find((key) => typeof projects[key] === 'string' && projects[key].trim());
    if (!firstAlias) return null;
    alias = firstAlias;
    projectId = projects[firstAlias];
  }

  return { alias, projectId: projectId.trim() };
}

function profileVariants(alias) {
  if (alias === 'default') return ['default', 'development'];
  return [alias];
}

function loadProfileEnv(cwd, profileAlias) {
  const variants = profileVariants(profileAlias);
  const candidates = [
    '.env',
    '.env.test',
    ...variants.flatMap((variant) => [`.env.${variant}`, `.env.test.${variant}`]),
  ];
  const merged = {};
  for (const fileName of candidates) {
    const fullPath = resolve(cwd, fileName);
    if (!existsSync(fullPath)) continue;
    Object.assign(merged, parseEnvFile(readFileSync(fullPath, 'utf8')));
  }
  return merged;
}

function resolveProfileAlias(args) {
  const explicit = typeof args.profile === 'string' ? args.profile.trim() : '';
  if (explicit) return explicit;
  if (args.staging) return 'staging';
  const envAlias = typeof process.env.FIREBASE_ALIAS === 'string' ? process.env.FIREBASE_ALIAS.trim() : '';
  return envAlias || 'default';
}

function resolveFirebaseConfigPath(cwd, { explicitPath = null, profileAlias = 'default' } = {}) {
  if (explicitPath) {
    const resolvedPath = isAbsolute(explicitPath) ? explicitPath : resolve(cwd, explicitPath);
    if (!existsSync(resolvedPath)) {
      throw new Error(`firebase config file not found: ${resolvedPath}`);
    }
    return resolvedPath;
  }

  const candidates = [
    ...profileVariants(profileAlias).map((variant) => resolve(cwd, `firebase.${variant}.json`)),
    resolve(cwd, 'firebase.json'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export function resolveTestEnv(cwd, { profileAlias, firebaseConfigPath = null }) {
  const profileEnv = loadProfileEnv(cwd, profileAlias);
  const baseEnv = {
    ...process.env,
    ...profileEnv,
  };
  let source = null;
  let env = { ...baseEnv };

  if (!(typeof process.env.GCLOUD_PROJECT === 'string' && process.env.GCLOUD_PROJECT.trim())) {
    const resolved = resolveFirebaseProjectFromRc(cwd, {
      preferredAlias: profileAlias,
      strictAlias: profileAlias !== 'default' || Boolean(process.env.FIREBASE_ALIAS?.trim()),
    });
    if (resolved) {
      source = resolved;
      env = {
        ...env,
        GCLOUD_PROJECT: resolved.projectId,
        FIREBASE_PROJECT_ALIAS: resolved.alias,
      };
    }
  }

  const functionsRuntime = resolveFunctionsRuntimeEnv(cwd, {
    projectId: env.GCLOUD_PROJECT?.trim() || null,
    firebaseConfigPath,
  });

  return {
    env: {
      ...env,
      ...functionsRuntime.env,
    },
    source,
    functionsRuntime,
  };
}

function mapCommandKey(args) {
  const explicitCount = [args.ci, args.unit, args.integration, args.e2e, args.staging].filter(Boolean).length;
  const suffix = args.full ? 'Full' : 'Smoke';

  if (explicitCount === 0 || args.ci) return args.failFast ? 'ciFailFast' : 'ci';
  if (args.unit) return 'unit';
  if (args.integration) return 'integration';
  if (args.e2e) return `e2e${suffix}`;
  if (args.staging) return `staging${suffix}`;
  return args.failFast ? 'ciFailFast' : 'ci';
}

function isOverrideAllowed(env = process.env) {
  return env.ALLOW_NON_STAGING_E2E === 'true';
}

function escapeShell(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function assertNoExternalBaseUrlForCi(env, logPrefix) {
  const raw = env.E2E_BASE_URL?.trim();
  if (!raw) return;
  if (isOverrideAllowed(env)) return;
  throw new Error(
    `${logPrefix} refusing E2E_BASE_URL in CI docker gate. Allowed targets are local emulators only. ` +
    'Set ALLOW_NON_STAGING_E2E=true to override explicitly.'
  );
}

function normalizeHost(rawUrl) {
  const url = new URL(rawUrl);
  return url.hostname.toLowerCase();
}

function validateExternalBaseUrl(baseUrl, env, logPrefix) {
  if (!baseUrl) return;
  if (isOverrideAllowed(env)) return;

  let host;
  try {
    host = normalizeHost(baseUrl);
  } catch {
    throw new Error(`${logPrefix} invalid E2E_BASE_URL: ${baseUrl}`);
  }

  const allowedHosts = new Set(['localhost', '127.0.0.1', 'staging.presentgoal.com']);
  if (!allowedHosts.has(host)) {
    throw new Error(
      `${logPrefix} refusing E2E_BASE_URL host "${host}". Allowed: localhost, 127.0.0.1, staging.presentgoal.com. ` +
      'Set ALLOW_NON_STAGING_E2E=true to override explicitly.'
    );
  }
}

function validateStagingBaseUrl(baseUrl, env, logPrefix) {
  if (!baseUrl) return;
  if (isOverrideAllowed(env)) return;

  let host;
  try {
    host = normalizeHost(baseUrl);
  } catch {
    throw new Error(`${logPrefix} invalid E2E_BASE_URL: ${baseUrl}`);
  }

  if (host !== 'staging.presentgoal.com') {
    throw new Error(
      `${logPrefix} refusing E2E_BASE_URL host "${host}" for staging runner. Allowed only: staging.presentgoal.com. ` +
      'Set ALLOW_NON_STAGING_E2E=true to override explicitly.'
    );
  }
}

function requireProject(expectedProjectId, currentProjectId, logPrefix) {
  if (currentProjectId !== expectedProjectId) {
    throw new Error(`${logPrefix} refusing to run with GCLOUD_PROJECT=${currentProjectId}. Expected ${expectedProjectId}.`);
  }
  return currentProjectId;
}

function buildDockerLogPrefix(key) {
  if (key === 'ci' || key === 'ciFailFast') return '[test:ci:docker]';
  if (key === 'integration') return '[test:integration:docker]';
  if (key === 'unit') return '[test:unit:docker]';
  if (key === 'stagingSmoke' || key === 'stagingFull') return '[test:e2e:staging:docker]';
  if (key === 'e2eSmoke' || key === 'e2eFull') return '[test:e2e:docker]';
  return '[test:docker]';
}

function parsePlaywrightConfigPathFromCommand(command) {
  const fromEquals = command.match(/--config=([^\s"'`]+)/);
  if (fromEquals) return fromEquals[1];
  const fromSpace = command.match(/--config\s+([^\s"'`]+)/);
  if (fromSpace) return fromSpace[1];
  return null;
}

function resolvePlaywrightConfigPath(cwd, command) {
  const explicit = process.env.PLAYWRIGHT_CONFIG_PATH?.trim() || parsePlaywrightConfigPathFromCommand(command);
  if (explicit) {
    const candidate = isAbsolute(explicit) ? explicit : resolve(cwd, explicit);
    if (existsSync(candidate)) return candidate;
  }

  const defaultNames = [
    'playwright.config.ts',
    'playwright.config.mts',
    'playwright.config.cts',
    'playwright.config.js',
    'playwright.config.mjs',
    'playwright.config.cjs',
  ];
  for (const fileName of defaultNames) {
    const candidate = resolve(cwd, fileName);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function rewriteInternalFirestackInvocations(command, internalBinPath) {
  if (typeof command !== 'string' || command.length === 0) return command;
  const replacement = `node ${escapeShell(internalBinPath)} internal`;
  return command.replace(
    /\b(?:npx\s+@igorsantos-dev\/firestack|npx\s+firestack|firestack)\s+internal\b/g,
    replacement
  );
}

function rewriteFirebaseCliInvocations(command) {
  if (typeof command !== 'string' || command.length === 0) return command;
  return command.replace(/\bnpx\s+firebase-tools\b/g, 'firebase');
}

function applyFirebaseConfigToCommand(command, firebaseConfigPath) {
  if (typeof command !== 'string' || command.length === 0 || !firebaseConfigPath) return command;
  const configArg = `--config ${escapeShell(firebaseConfigPath)}`;
  return command.replace(/\bfirebase\s+emulators:exec\b/g, `firebase ${configArg} emulators:exec`);
}

function buildLogRoutedCommand(command, { routerScriptPath, mode, infraLogFile, suiteLogFile, appendLogs }) {
  const ttyWidth = Number.isFinite(Number(process.stdout.columns)) && Number(process.stdout.columns) > 0
    ? String(process.stdout.columns)
    : '120';
  const forcedStyleEnv = [
    'FORCE_COLOR=1',
    'CLICOLOR_FORCE=1',
    'NPM_CONFIG_COLOR=always',
    `PLAYWRIGHT_FORCE_TTY=${ttyWidth}`,
    'TERM=xterm-256color',
  ].join(' ');
  const routerCommand = [
    'node',
    escapeShell(routerScriptPath),
    '--mode',
    escapeShell(mode),
    '--infra-log',
    escapeShell(infraLogFile),
    '--suite-log',
    escapeShell(suiteLogFile),
    ...(appendLogs ? ['--append'] : ['--reset']),
  ].join(' ');
  return `set -o pipefail; env ${forcedStyleEnv} bash -lc ${escapeShell(command)} 2>&1 | ${routerCommand}`;
}

function normalizeRelativeWritablePath(cwd, rawPath) {
  if (typeof rawPath !== 'string') return null;
  const trimmed = rawPath.trim();
  if (!trimmed) return null;
  if (trimmed.includes('://')) return null;
  if (trimmed.startsWith('~')) return null;

  const absoluteCandidate = isAbsolute(trimmed) ? trimmed : resolve(cwd, trimmed);
  const rel = relative(cwd, absoluteCandidate);
  if (!rel || rel === '.') return null;
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  return normalize(rel).replaceAll('\\', '/').replace(/\/+$/, '');
}

function detectWritablePathsFromPlaywrightConfig(cwd, command, logPrefix) {
  const configPath = resolvePlaywrightConfigPath(cwd, command);
  if (!configPath) return [];

  let source = '';
  try {
    source = readFileSync(configPath, 'utf8');
  } catch {
    return [];
  }

  const paths = new Set();
  const extractors = [
    /outputFolder\s*:\s*['"`]([^'"`]+)['"`]/g,
    /outputFile\s*:\s*['"`]([^'"`]+)['"`]/g,
    /outputDir\s*:\s*['"`]([^'"`]+)['"`]/g,
  ];

  for (const regex of extractors) {
    let match = regex.exec(source);
    while (match) {
      const raw = match[1];
      const candidate = regex.source.includes('outputFile') ? dirname(raw) : raw;
      const normalizedPath = normalizeRelativeWritablePath(cwd, candidate);
      if (normalizedPath) {
        paths.add(normalizedPath);
      } else if (candidate) {
        console.warn(`${logPrefix} ignored non-local playwright output path: ${candidate}`);
      }
      match = regex.exec(source);
    }
  }

  return Array.from(paths);
}

function resolveDockerWritablePaths(cwd, key, command, dockerConfig, logPrefix) {
  const configured = Array.isArray(dockerConfig.writablePaths) && dockerConfig.writablePaths.length > 0
    ? dockerConfig.writablePaths
    : ['out'];
  const merged = new Set(configured.map((entry) => String(entry).trim()).filter(Boolean));
  const includesE2E = key === 'ci' || key === 'e2eSmoke' || key === 'e2eFull' || key === 'stagingSmoke' || key === 'stagingFull';

  if (!includesE2E) {
    return Array.from(merged);
  }

  const fromPlaywright = detectWritablePathsFromPlaywrightConfig(cwd, command, logPrefix);
  for (const path of fromPlaywright) {
    merged.add(path);
  }

  if (fromPlaywright.length === 0) {
    merged.add('out');
  }

  return Array.from(merged);
}

function decodeXmlEntities(text) {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

function parseAttributes(tagSource) {
  const attrs = {};
  const attrRe = /([a-zA-Z_:][\w:.-]*)="([^"]*)"/g;
  let match = attrRe.exec(tagSource);
  while (match) {
    attrs[match[1]] = decodeXmlEntities(match[2]);
    match = attrRe.exec(tagSource);
  }
  return attrs;
}

function extractFailureSummary(rawFailureText, failureMessage) {
  if (typeof rawFailureText === 'string' && rawFailureText.trim()) {
    const errorMatch = rawFailureText.match(/Error:\s*(.+)/);
    if (errorMatch?.[1]) return errorMatch[1].trim();
    const firstMeaningfulLine = rawFailureText
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith('at ') && !line.startsWith('attachment #') && !line.startsWith('Usage:'));
    if (firstMeaningfulLine) return firstMeaningfulLine;
  }
  if (typeof failureMessage === 'string' && failureMessage.trim()) {
    return failureMessage.trim();
  }
  return 'failed';
}

function extractFailureDetails(rawFailureText) {
  if (typeof rawFailureText !== 'string' || !rawFailureText.trim()) return {};
  const expectedPattern = rawFailureText.match(/Expected pattern:\s*(.+)/)?.[1]?.trim();
  const receivedString = rawFailureText.match(/Received string:\s*"([^"]+)"/)?.[1]?.trim();
  const timeoutMs = rawFailureText.match(/Timeout:\s*(\d+)ms/)?.[1]?.trim();
  return {
    expectedPattern: expectedPattern || null,
    receivedString: receivedString || null,
    timeoutMs: timeoutMs || null,
  };
}

function extractArtifactPaths(rawFailureText) {
  if (typeof rawFailureText !== 'string' || !rawFailureText.trim()) return [];
  const pathRe = /(?:^|\s)(out\/tests\/[^\s]+(?:\.(?:png|webm|zip|md)|\/?))/gm;
  const artifacts = [];
  let match = pathRe.exec(rawFailureText);
  while (match) {
    const value = match[1].trim();
    if (value && !artifacts.includes(value)) artifacts.push(value);
    match = pathRe.exec(rawFailureText);
  }
  return artifacts;
}

function parseTestcases(xml) {
  const cases = [];
  const caseRe = /<testcase\b([\s\S]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  let match = caseRe.exec(xml);
  while (match) {
    const attrs = parseAttributes(match[1] ?? '');
    const body = match[2] ?? '';
    const failureTag = body.match(/<failure\b([\s\S]*?)>([\s\S]*?)<\/failure>/);
    const skippedTag = body.match(/<skipped\b[\s\S]*?>/);
    const durationMs = Number.isFinite(Number(attrs.time)) ? Math.round(Number(attrs.time) * 1000) : 0;
    let status = 'pass';
    if (skippedTag) status = 'skipped';
    if (failureTag) status = 'fail';
    let failureMessage = null;
    let failureLocation = null;
    let failureSummary = null;
    let artifactPaths = [];
    let failureDetails = {};
    if (failureTag) {
      const failureAttrs = parseAttributes(failureTag[1] ?? '');
      failureMessage = decodeXmlEntities(failureAttrs.message ?? 'failed');
      const rawFailureText = decodeXmlEntities(
        (failureTag[2] ?? '')
          .replace('<![CDATA[', '')
          .replace(']]>', '')
          .trim()
      );
      failureSummary = extractFailureSummary(rawFailureText, failureMessage);
      failureDetails = extractFailureDetails(rawFailureText);
      artifactPaths = extractArtifactPaths(rawFailureText);
      const locationMatch = rawFailureText.match(/([A-Za-z0-9_./\\-]+\.(?:[cm]?[jt]sx?|mjs|cjs)):(\d+):(\d+)/);
      if (locationMatch) {
        failureLocation = `${locationMatch[1]}:${locationMatch[2]}:${locationMatch[3]}`;
      } else if (attrs.classname) {
        failureLocation = attrs.classname;
      }
    }
    cases.push({
      name: attrs.name || '(unnamed testcase)',
      durationMs,
      status,
      failureMessage,
      failureLocation,
      failureSummary,
      failureDetails,
      artifactPaths,
    });
    match = caseRe.exec(xml);
  }
  return cases;
}

function readJUnit(path, suiteName) {
  if (!existsSync(path)) return null;
  try {
    const xml = readFileSync(path, 'utf8');
    const cases = parseTestcases(xml);
    const tests = cases.length;
    const failures = cases.filter((c) => c.status === 'fail').length;
    const skipped = cases.filter((c) => c.status === 'skipped').length;
    const passed = Math.max(tests - failures - skipped, 0);
    const durationMs = cases.reduce((sum, c) => sum + c.durationMs, 0);
    return { suiteName, tests, failures, skipped, passed, durationMs, cases };
  } catch {
    return null;
  }
}

function buildSummaryTable(suites, total) {
  const rows = suites.map((suite) => ({
    suite: suite.suiteName,
    tests: suite.tests,
    pass: suite.passed,
    fail: suite.failures,
    skip: suite.skipped,
    time: (suite.durationMs / 1000).toFixed(2),
  }));

  const totalRow = {
    suite: 'total',
    tests: total.tests,
    pass: total.passed,
    fail: total.failures,
    skip: total.skipped,
    time: (total.durationMs / 1000).toFixed(2),
  };

  const header = {
    suite: 'suite',
    tests: 'tests',
    pass: 'pass',
    fail: 'fail',
    skip: 'skip',
    time: 'time(s)',
  };

  const widths = {
    suite: Math.max(header.suite.length, ...rows.map((row) => row.suite.length), totalRow.suite.length),
    tests: Math.max(header.tests.length, ...rows.map((row) => String(row.tests).length), String(totalRow.tests).length),
    pass: Math.max(header.pass.length, ...rows.map((row) => String(row.pass).length), String(totalRow.pass).length),
    fail: Math.max(header.fail.length, ...rows.map((row) => String(row.fail).length), String(totalRow.fail).length),
    skip: Math.max(header.skip.length, ...rows.map((row) => String(row.skip).length), String(totalRow.skip).length),
    time: Math.max(header.time.length, ...rows.map((row) => row.time.length), totalRow.time.length),
  };

  const colorSuite = (value, row, isTotal) => {
    if (isTotal) return paint(value, ANSI.bold);
    if (row.fail > 0) return paint(value, ANSI.red);
    if (row.skip > 0) return paint(value, ANSI.yellow);
    return paint(value, ANSI.green);
  };

  const colorPass = (value, isHeader) => (isHeader ? paint(value, ANSI.bold, ANSI.green) : paint(value, ANSI.green));
  const colorFail = (value, count, isHeader) => {
    if (isHeader) return paint(value, ANSI.bold, ANSI.red);
    return count > 0 ? paint(value, ANSI.red) : paint(value, ANSI.dim);
  };
  const colorSkip = (value, count, isHeader) => {
    if (isHeader) return paint(value, ANSI.bold, ANSI.yellow);
    return count > 0 ? paint(value, ANSI.yellow) : paint(value, ANSI.dim);
  };

  const formatDataRow = (row, { isTotal = false } = {}) => {
    const suiteCell = row.suite.padEnd(widths.suite, ' ');
    const testsCell = String(row.tests).padStart(widths.tests, ' ');
    const passCell = String(row.pass).padStart(widths.pass, ' ');
    const failCell = String(row.fail).padStart(widths.fail, ' ');
    const skipCell = String(row.skip).padStart(widths.skip, ' ');
    const timeCell = row.time.padStart(widths.time, ' ');

    return (
      `  ${colorSuite(suiteCell, row, isTotal)} | ` +
      `${isTotal ? paint(testsCell, ANSI.bold) : testsCell} | ` +
      `${isTotal ? paint(passCell, ANSI.bold, ANSI.green) : colorPass(passCell, false)} | ` +
      `${isTotal ? colorFail(paint(failCell, ANSI.bold), row.fail, false) : colorFail(failCell, row.fail, false)} | ` +
      `${isTotal ? colorSkip(paint(skipCell, ANSI.bold), row.skip, false) : colorSkip(skipCell, row.skip, false)} | ` +
      `${isTotal ? paint(timeCell, ANSI.bold) : timeCell}`
    );
  };

  const formatHeaderRow = () => {
    const suiteCell = header.suite.padEnd(widths.suite, ' ');
    const testsCell = header.tests.padStart(widths.tests, ' ');
    const passCell = header.pass.padStart(widths.pass, ' ');
    const failCell = header.fail.padStart(widths.fail, ' ');
    const skipCell = header.skip.padStart(widths.skip, ' ');
    const timeCell = header.time.padStart(widths.time, ' ');
    return (
      `  ${paint(suiteCell, ANSI.bold, ANSI.cyan)} | ` +
      `${paint(testsCell, ANSI.bold, ANSI.cyan)} | ` +
      `${colorPass(passCell, true)} | ` +
      `${colorFail(failCell, 0, true)} | ` +
      `${colorSkip(skipCell, 0, true)} | ` +
      `${paint(timeCell, ANSI.bold, ANSI.cyan)}`
    );
  };

  const separator = (
    `  ${'-'.repeat(widths.suite)}-+-` +
    `${'-'.repeat(widths.tests)}-+-` +
    `${'-'.repeat(widths.pass)}-+-` +
    `${'-'.repeat(widths.fail)}-+-` +
    `${'-'.repeat(widths.skip)}-+-` +
    `${'-'.repeat(widths.time)}`
  );

  return {
    header: formatHeaderRow(),
    separator: paint(separator, ANSI.dim),
    rows: rows.map((row) => formatDataRow(row)),
    total: formatDataRow(totalRow, { isTotal: true }),
  };
}

function printTestSummary(cwd, key) {
  const suiteMap = {
    unit: readJUnit(resolve(cwd, 'out/tests/unit/junit.xml'), 'unit'),
    integration: readJUnit(resolve(cwd, 'out/tests/integration/junit.xml'), 'integration'),
    e2e: readJUnit(resolve(cwd, 'out/tests/e2e/junit.xml'), 'e2e'),
    'e2e-staging': readJUnit(resolve(cwd, 'out/tests/e2e/staging/junit.xml'), 'e2e-staging'),
  };

  let expectedSuiteKeys = ['unit', 'integration', 'e2e', 'e2e-staging'];
  if (key === 'unit') expectedSuiteKeys = ['unit'];
  if (key === 'integration') expectedSuiteKeys = ['integration'];
  if (key === 'e2eSmoke' || key === 'e2eFull') expectedSuiteKeys = ['e2e'];
  if (key === 'stagingSmoke' || key === 'stagingFull') expectedSuiteKeys = ['e2e-staging'];
  if (key === 'ci' || key === 'ciFailFast') expectedSuiteKeys = ['unit', 'integration', 'e2e'];

  const suites = expectedSuiteKeys
    .map((suiteKey) => suiteMap[suiteKey])
    .filter(Boolean);

  if (suites.length === 0) return;

  const total = suites.reduce((acc, suite) => ({
    tests: acc.tests + suite.tests,
    passed: acc.passed + suite.passed,
    failures: acc.failures + suite.failures,
    skipped: acc.skipped + suite.skipped,
    durationMs: acc.durationMs + suite.durationMs,
  }), { tests: 0, passed: 0, failures: 0, skipped: 0, durationMs: 0 });

  console.log('\n=== Firestack Test Report ===');
  console.log(`  Command: ${key}`);
  const table = buildSummaryTable(suites, total);
  console.log(table.separator);
  console.log(table.header);
  console.log(table.separator);
  table.rows.forEach((row) => console.log(row));
  console.log(table.separator);
  console.log(table.total);

  const failedCases = suites.flatMap((suite) => suite.cases
    .filter((testcase) => testcase.status === 'fail')
    .slice(0, 5)
    .map((testcase) => ({ suiteName: suite.suiteName, testcase })));
  if (failedCases.length > 0) {
    console.log(`\n  ${paint('Failures:', ANSI.bold, ANSI.red)}`);
    failedCases.forEach(({ suiteName, testcase }) => {
      const suiteLabel = paint(`[${suiteName}]`, ANSI.bold, ANSI.red);
      console.log(`    - ${suiteLabel} ${paint(testcase.name, ANSI.bold)}`);
      if (testcase.failureLocation) {
        console.log(`      ${paint('location:', ANSI.dim)} ${paint(testcase.failureLocation, ANSI.cyan)}`);
      }
      if (testcase.failureSummary) {
        console.log(`      ${paint('error:', ANSI.dim)} ${paint(testcase.failureSummary, ANSI.red)}`);
      } else if (testcase.failureMessage) {
        console.log(`      ${paint('error:', ANSI.dim)} ${paint(testcase.failureMessage, ANSI.red)}`);
      }
      if (testcase.failureDetails?.expectedPattern) {
        console.log(`      ${paint('expected:', ANSI.dim)} ${paint(testcase.failureDetails.expectedPattern, ANSI.green)}`);
      }
      if (testcase.failureDetails?.receivedString) {
        console.log(`      ${paint('received:', ANSI.dim)} ${paint(`"${testcase.failureDetails.receivedString}"`, ANSI.red)}`);
      }
      if (testcase.failureDetails?.timeoutMs) {
        console.log(`      ${paint('timeout:', ANSI.dim)} ${paint(`${testcase.failureDetails.timeoutMs}ms`, ANSI.yellow)}`);
      }
      if (Array.isArray(testcase.artifactPaths) && testcase.artifactPaths.length > 0) {
        const firstArtifacts = testcase.artifactPaths.slice(0, 4);
        console.log(`      ${paint('artifacts:', ANSI.dim)} ${firstArtifacts.join(', ')}`);
      }
    });
  }
}

function expectedJUnitPaths(cwd, key) {
  const mapping = {
    unit: [resolve(cwd, 'out/tests/unit/junit.xml')],
    integration: [resolve(cwd, 'out/tests/integration/junit.xml')],
    e2eSmoke: [resolve(cwd, 'out/tests/e2e/junit.xml')],
    e2eFull: [resolve(cwd, 'out/tests/e2e/junit.xml')],
    stagingSmoke: [resolve(cwd, 'out/tests/e2e/staging/junit.xml')],
    stagingFull: [resolve(cwd, 'out/tests/e2e/staging/junit.xml')],
    ci: [
      resolve(cwd, 'out/tests/unit/junit.xml'),
      resolve(cwd, 'out/tests/integration/junit.xml'),
      resolve(cwd, 'out/tests/e2e/junit.xml'),
    ],
    ciFailFast: [
      resolve(cwd, 'out/tests/unit/junit.xml'),
      resolve(cwd, 'out/tests/integration/junit.xml'),
      resolve(cwd, 'out/tests/e2e/junit.xml'),
    ],
  };
  return mapping[key] ?? [];
}

function clearExpectedJUnitReports(cwd, key) {
  for (const reportPath of expectedJUnitPaths(cwd, key)) {
    try {
      rmSync(reportPath, { force: true });
    } catch {
      // ignore cleanup errors; test run will recreate reports when successful.
    }
  }
}

export function runTest(argv) {
  const args = {
    target: process.cwd(),
    config: null,
    profile: '',
    firebaseConfig: null,
    docker: false,
    dockerRebuild: false,
    failFast: false,
    ci: false,
    unit: false,
    integration: false,
    e2e: false,
    staging: false,
    full: false,
    logRouting: true,
    infraLogs: 'compact',
    infraLogFile: 'out/tests/infra/emulator.log',
    suiteLogFile: 'out/tests/suite/output.log',
    logAppend: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--target') {
      args.target = resolve(argv[i + 1] ?? '.');
      i += 1;
      continue;
    }
    if (token === '--config') {
      args.config = resolve(argv[i + 1] ?? 'firestack.config.json');
      i += 1;
      continue;
    }
    if (token === '--profile') {
      args.profile = String(argv[i + 1] ?? '').trim();
      i += 1;
      continue;
    }
    if (token === '--firebase-config') {
      args.firebaseConfig = String(argv[i + 1] ?? '').trim();
      i += 1;
      continue;
    }
    if (token === '--docker') { args.docker = true; continue; }
    if (token === '--docker-rebuild') { args.dockerRebuild = true; continue; }
    if (token === '--fail-fast') { args.failFast = true; continue; }
    if (token === '--ci') { args.ci = true; continue; }
    if (token === '--unit') { args.unit = true; continue; }
    if (token === '--integration') { args.integration = true; continue; }
    if (token === '--e2e') { args.e2e = true; continue; }
    if (token === '--staging') { args.staging = true; continue; }
    if (token === '--full') { args.full = true; continue; }
    if (token === '--infra-logs') {
      args.infraLogs = String(argv[i + 1] ?? '').trim().toLowerCase();
      i += 1;
      continue;
    }
    if (token === '--infra-log-file') {
      args.infraLogFile = String(argv[i + 1] ?? args.infraLogFile).trim() || args.infraLogFile;
      i += 1;
      continue;
    }
    if (token === '--suite-log-file') {
      args.suiteLogFile = String(argv[i + 1] ?? args.suiteLogFile).trim() || args.suiteLogFile;
      i += 1;
      continue;
    }
    if (token === '--log-append') { args.logAppend = true; continue; }
    if (token === '--no-log-routing') { args.logRouting = false; continue; }
    if (token === '-h' || token === '--help') {
      printHelp();
      process.exit(0);
    }
    throw new Error(`unknown argument: ${token}`);
  }

  const { data: config } = loadProjectConfig(args.target, args.config);
  const profileAlias = resolveProfileAlias(args);
  const resolvedFirebaseConfigPath = resolveFirebaseConfigPath(args.target, {
    explicitPath: args.firebaseConfig,
    profileAlias,
  });
  const {
    env: testEnv,
    source: projectSource,
    functionsRuntime,
  } = resolveTestEnv(args.target, {
    profileAlias,
    firebaseConfigPath: resolvedFirebaseConfigPath,
  });
  const firebaseConfigRuntimePath = resolvedFirebaseConfigPath
    ? (() => {
      const rel = relative(args.target, resolvedFirebaseConfigPath).replaceAll('\\', '/');
      return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : resolvedFirebaseConfigPath;
    })()
    : null;
  if (firebaseConfigRuntimePath) {
    testEnv.FIRESTACK_FIREBASE_CONFIG_PATH = firebaseConfigRuntimePath;
  }
  const commands = config.test?.commands ?? {};
  const key = mapCommandKey(args);
  const firestackCliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const internalRunnerBin = args.docker
    ? '/firestack-cli/bin/firestack.mjs'
    : resolve(firestackCliRoot, 'bin/firestack.mjs');
  const logRouterScriptPath = args.docker
    ? '/firestack-cli/scripts/cli/internal-log-router.mjs'
    : resolve(firestackCliRoot, 'scripts/cli/internal-log-router.mjs');
  if (!new Set(['compact', 'verbose', 'quiet']).has(args.infraLogs)) {
    throw new Error(`invalid --infra-logs value "${args.infraLogs}" (expected compact|verbose|quiet)`);
  }
  const configuredCommand = commands[key] ?? (key === 'ciFailFast' ? commands.ci : null);
  const commandFirebaseConfigPath = args.docker
    ? firebaseConfigRuntimePath
    : resolvedFirebaseConfigPath;
  const command = applyFirebaseConfigToCommand(
    rewriteFirebaseCliInvocations(
      rewriteInternalFirestackInvocations(configuredCommand, internalRunnerBin)
    ),
    commandFirebaseConfigPath
  );
  if (!command) {
    throw new Error(`missing test command "${key}" in firestack.config.json`);
  }
  if (key === 'ciFailFast' && !commands.ciFailFast) {
    console.log('[firestack] ciFailFast command not found; falling back to "ci" command from config.');
  }

  if (projectSource) {
    console.log(
      `[firestack] using Firebase project "${projectSource.projectId}" (alias "${projectSource.alias}") from .firebaserc`
    );
  }
  if (resolvedFirebaseConfigPath) {
    console.log(`[firestack] using Firebase config "${resolvedFirebaseConfigPath}" for profile "${profileAlias}"`);
  }
  if (Array.isArray(functionsRuntime?.loadedFiles) && functionsRuntime.loadedFiles.length > 0) {
    const listed = functionsRuntime.loadedFiles.map((path) => {
      const rel = relative(args.target, path).replaceAll('\\', '/');
      return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : path;
    });
    console.log(`[firestack] merged Functions runtime env from: ${listed.join(', ')}`);
  }

  if (!args.docker) {
    clearExpectedJUnitReports(args.target, key);
    const routedCommand = args.logRouting
      ? buildLogRoutedCommand(command, {
        routerScriptPath: logRouterScriptPath,
        mode: args.infraLogs,
        infraLogFile: args.infraLogFile,
        suiteLogFile: args.suiteLogFile,
        appendLogs: args.logAppend,
      })
      : command;
    const status = runShell(args.target, routedCommand, key, testEnv);
    printTestSummary(args.target, key);
    process.exit(status);
  }

  const dockerConfig = config.test?.docker ?? {};
  const logPrefix = buildDockerLogPrefix(key);
  const externalBaseUrl = testEnv.E2E_BASE_URL?.trim();
  const passThrough = Array.isArray(dockerConfig.passThroughEnv) ? dockerConfig.passThroughEnv : [];
  const dockerEnvNames = Array.from(new Set([
    ...passThrough,
    'FIRESTACK_FIREBASE_CONFIG_PATH',
    ...(functionsRuntime?.keys ?? []),
  ]));

  if (key === 'ci' || key === 'ciFailFast') {
    assertNoExternalBaseUrlForCi(testEnv, logPrefix);
  } else if (key === 'e2eSmoke' || key === 'e2eFull') {
    validateExternalBaseUrl(externalBaseUrl, testEnv, logPrefix);
  } else if (key === 'stagingSmoke' || key === 'stagingFull') {
    const configuredStagingProjectId = typeof dockerConfig.stagingProjectId === 'string'
      ? dockerConfig.stagingProjectId.trim()
      : '';
    if (configuredStagingProjectId) {
      requireProject(configuredStagingProjectId, testEnv.GCLOUD_PROJECT ?? configuredStagingProjectId, logPrefix);
    } else if (!testEnv.GCLOUD_PROJECT?.trim()) {
      throw new Error(
        `${logPrefix} missing GCLOUD_PROJECT. Set it explicitly or configure .firebaserc (alias "default" or FIREBASE_ALIAS).`
      );
    }
    validateStagingBaseUrl(testEnv.E2E_BASE_URL ?? 'https://staging.presentgoal.com', testEnv, logPrefix);
  }

  const writablePaths = resolveDockerWritablePaths(args.target, key, command, dockerConfig, logPrefix);
  const task = createDockerTask({
    cwd: args.target,
    logPrefix,
    dockerConfig: {
      ...dockerConfig,
      writablePaths,
    },
    env: testEnv,
    firebaseConfigPath: resolvedFirebaseConfigPath,
    forceRebuild: args.dockerRebuild,
  });
  task.prepare();

  const bootstrapCommand = dockerConfig.bootstrapCommand ?? defaultBootstrapCommand();
  const projectId = testEnv.GCLOUD_PROJECT?.trim();
  if ((key === 'e2eSmoke' || key === 'e2eFull') && !externalBaseUrl && !projectId) {
    throw new Error(
      `${logPrefix} missing GCLOUD_PROJECT for emulator-backed E2E. Set it explicitly or configure .firebaserc.`
    );
  }
  const firebaseConfigArg = firebaseConfigRuntimePath
    ? ` --config ${escapeShell(firebaseConfigRuntimePath)}`
    : '';
  const dockerSuiteCommand = (key === 'e2eSmoke' || key === 'e2eFull') && !externalBaseUrl
    ? `firestack internal run-functions-build && firebase${firebaseConfigArg} emulators:exec --project ${escapeShell(projectId)} ${escapeShell(command)}`
    : command;
  const setup = [];
  if (bootstrapCommand) setup.push(bootstrapCommand);
  if (dockerConfig.installEveryRun === true) {
    setup.push(dockerConfig.installCommand ?? 'npm ci');
  }
  setup.push(dockerSuiteCommand);
  const runnableCommand = args.logRouting
    ? buildLogRoutedCommand(setup.join(' && '), {
      routerScriptPath: logRouterScriptPath,
      mode: args.infraLogs,
      infraLogFile: args.infraLogFile,
      suiteLogFile: args.suiteLogFile,
      appendLogs: args.logAppend,
    })
    : setup.join(' && ');

  console.log(`${logPrefix} image: ${task.image}`);
  console.log(`${logPrefix} node_modules volume: ${task.nodeModulesVolume}`);
  console.log(`${logPrefix} emulator cache volume: ${task.emulatorCacheVolume}`);

  clearExpectedJUnitReports(args.target, key);
  const status = task.run({
    command: runnableCommand,
    envNames: dockerEnvNames,
    extraArgs: ['-v', `${firestackCliRoot}:/firestack-cli:ro`],
  });
  printTestSummary(args.target, key);
  process.exit(status);
}
