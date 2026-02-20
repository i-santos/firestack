import { existsSync, readFileSync } from 'node:fs';

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

function parseTestcases(xml) {
  const cases = [];
  const caseRe = /<testcase\b([\s\S]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  let match = caseRe.exec(xml);
  while (match) {
    const attrs = parseAttributes(match[1] ?? '');
    const body = match[2] ?? '';

    const failureAttr = attrs.failure ? attrs.failure : null;
    const failureTag = body.match(/<failure\b[\s\S]*?message="([^"]*)"[\s\S]*?<\/failure>/);
    const skippedTag = body.match(/<skipped\b[\s\S]*?>/);

    const durationMs = Number.isFinite(Number(attrs.time))
      ? Math.round(Number(attrs.time) * 1000)
      : 0;

    let status = 'pass';
    let failureMessage = null;
    if (skippedTag) status = 'skipped';
    if (failureAttr || failureTag) {
      status = 'fail';
      failureMessage = decodeXmlEntities(failureAttr || failureTag?.[1] || 'failed');
    }

    cases.push({
      name: attrs.name || '(unnamed testcase)',
      durationMs,
      status,
      failureMessage,
    });

    match = caseRe.exec(xml);
  }
  return cases;
}

function readJUnit(path, suiteName) {
  if (!existsSync(path)) return null;
  const xml = readFileSync(path, 'utf8');
  const cases = parseTestcases(xml);
  const tests = cases.length;
  const failures = cases.filter((c) => c.status === 'fail').length;
  const skipped = cases.filter((c) => c.status === 'skipped').length;
  const durationMs = cases.reduce((sum, c) => sum + c.durationMs, 0);

  return {
    suiteName,
    cases,
    tests,
    failures,
    skipped,
    durationMs,
  };
}

function readEmulatorExitCode() {
  const path = 'out/test-results/emulator-exit-code.txt';
  if (!existsSync(path)) return 0;
  const raw = readFileSync(path, 'utf8').trim();
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 1;
}

function printCaseLine(testcase, suiteName) {
  const prefix = suiteName ? `[${suiteName}] ` : '';
  if (testcase.status === 'fail') {
    console.log(`✖ ${prefix}${testcase.name} (${testcase.durationMs}ms)`);
    if (testcase.failureMessage) {
      console.log(`  ↳ ${testcase.failureMessage}`);
    }
    return;
  }
  if (testcase.status === 'skipped') {
    console.log(`○ ${prefix}${testcase.name} (${testcase.durationMs}ms)`);
    return;
  }
  console.log(`✔ ${prefix}${testcase.name} (${testcase.durationMs}ms)`);
}

function printNodeStyleSummary(suites) {
  const ranSuites = suites.filter(Boolean);
  const tests = ranSuites.reduce((sum, s) => sum + s.tests, 0);
  const fail = ranSuites.reduce((sum, s) => sum + s.failures, 0);
  const skipped = ranSuites.reduce((sum, s) => sum + s.skipped, 0);
  const pass = Math.max(tests - fail - skipped, 0);
  const durationMs = ranSuites.reduce((sum, s) => sum + s.durationMs, 0);

  console.log(`ℹ tests ${tests}`);
  console.log(`ℹ suites 0`);
  console.log(`ℹ pass ${pass}`);
  console.log(`ℹ fail ${fail}`);
  console.log(`ℹ cancelled 0`);
  console.log(`ℹ skipped ${skipped}`);
  console.log(`ℹ todo 0`);
  console.log(`ℹ duration_ms ${durationMs}`);
}

function main() {
  const integration = readJUnit('out/test-results/integration.junit.xml', 'integration');
  const e2e = readJUnit('test-results/e2e-junit.xml', 'e2e');
  const emulatorExitCode = readEmulatorExitCode();

  if (integration) {
    integration.cases.forEach((testcase) => printCaseLine(testcase, integration.suiteName));
  } else {
    console.log('[integration] not run');
  }

  if (e2e) {
    e2e.cases.forEach((testcase) => printCaseLine(testcase, e2e.suiteName));
  } else {
    console.log('[e2e] not run');
  }

  printNodeStyleSummary([integration, e2e]);

  const integrationFailed = (integration?.failures ?? 0) > 0;
  const e2eFailed = (e2e?.failures ?? 0) > 0;
  const integrationMissing = !integration;
  const e2eMissingUnexpected = !e2e && !integrationFailed;

  if (integrationMissing || e2eMissingUnexpected) {
    console.error('[ci:summary] missing expected JUnit artifact(s).');
    process.exit(1);
  }

  if (integrationFailed || e2eFailed) {
    process.exit(1);
  }

  if (emulatorExitCode !== 0) {
    console.error(`[ci:summary] emulator run exited with code ${emulatorExitCode}.`);
    process.exit(emulatorExitCode);
  }

  process.exit(0);
}

main();
