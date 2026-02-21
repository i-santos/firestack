import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT_DIR = 'out/tests/integration';
const SERIAL_XML = `${OUT_DIR}/serial.junit.xml`;
const PARALLEL_XML = `${OUT_DIR}/parallel.junit.xml`;
const COMBINED_XML = `${OUT_DIR}/junit.xml`;
const SERIAL_MARKER_RE = /@test-mode\s+serial/i;

function listIntegrationTests(dir = 'tests/integration') {
  const entries = readdirSync(dir);
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      if (entry.startsWith('_')) continue;
      files.push(...listIntegrationTests(fullPath));
      continue;
    }
    if (entry.endsWith('.test.ts')) files.push(fullPath);
  }
  return files.sort();
}

function getTestExecutionMode(filePath) {
  const source = readFileSync(filePath, 'utf8');
  return SERIAL_MARKER_RE.test(source) ? 'serial' : 'concurrent';
}

function runNodeTest({ concurrency, destination, tests }) {
  const args = [
    '--test',
    '--experimental-strip-types',
    '--test-reporter=junit',
    `--test-reporter-destination=${destination}`,
    `--test-concurrency=${concurrency}`,
    ...tests,
  ];
  return spawnSync('node', args, { stdio: 'inherit' });
}

function emptyJUnitXml() {
  return '<?xml version="1.0" encoding="utf-8"?>\n<testsuites>\n</testsuites>\n';
}

function extractInnerTestSuites(xml) {
  return xml
    .replace(/^<\?xml[^>]*>\s*/m, '')
    .replace(/^\s*<testsuites>\s*/m, '')
    .replace(/\s*<\/testsuites>\s*$/m, '')
    .trim();
}

function combineJunit(serialPath, parallelPath, outPath) {
  const serialXml = readFileSync(serialPath, 'utf8');
  const parallelXml = readFileSync(parallelPath, 'utf8');
  const serialInner = extractInnerTestSuites(serialXml);
  const parallelInner = extractInnerTestSuites(parallelXml);
  const merged = ['<?xml version="1.0" encoding="utf-8"?>', '<testsuites>', serialInner, parallelInner, '</testsuites>', '']
    .join('\n');
  writeFileSync(outPath, merged, 'utf8');
}

function ensureJUnitFile(path) {
  try {
    readFileSync(path, 'utf8');
  } catch {
    writeFileSync(path, emptyJUnitXml(), 'utf8');
  }
}

function getResultStatus(result) {
  if (!result) return 1;
  if (result.error) {
    console.error(`[test:integration:report] failed to execute node test: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const allTests = listIntegrationTests();
  const serialTests = [];
  const parallelTests = [];
  let serialStatus = 0;
  let parallelStatus = 0;

  for (const file of allTests) {
    if (getTestExecutionMode(file) === 'serial') serialTests.push(file);
    else parallelTests.push(file);
  }

  if (serialTests.length > 0) {
    const serialResult = runNodeTest({
      concurrency: 1,
      destination: SERIAL_XML,
      tests: serialTests,
    });
    ensureJUnitFile(SERIAL_XML);
    serialStatus = getResultStatus(serialResult);
  } else {
    writeFileSync(SERIAL_XML, emptyJUnitXml(), 'utf8');
  }

  const requestedConcurrency = Number(process.env.TEST_CONCURRENCY ?? '');
  const parallelConcurrency = Number.isFinite(requestedConcurrency) && requestedConcurrency > 0 ? requestedConcurrency : 8;

  if (parallelTests.length > 0) {
    const parallelResult = runNodeTest({
      concurrency: parallelConcurrency,
      destination: PARALLEL_XML,
      tests: parallelTests,
    });
    ensureJUnitFile(PARALLEL_XML);
    parallelStatus = getResultStatus(parallelResult);
  } else {
    writeFileSync(PARALLEL_XML, emptyJUnitXml(), 'utf8');
  }

  combineJunit(SERIAL_XML, PARALLEL_XML, COMBINED_XML);

  if (serialStatus !== 0 || parallelStatus !== 0) {
    process.exit(serialStatus !== 0 ? serialStatus : parallelStatus);
  }
}

main();
