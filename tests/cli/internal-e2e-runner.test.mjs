import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlaywrightFilterArgs, resolveSuite } from '../../scripts/cli/internal-e2e-runner.mjs';

test('resolveSuite maps unknown values to smoke and keeps full', () => {
  assert.equal(resolveSuite('smoke'), 'smoke');
  assert.equal(resolveSuite('full'), 'full');
  assert.equal(resolveSuite('anything-else'), 'smoke');
});

test('buildPlaywrightFilterArgs: smoke includes @smoke and always excludes @skip', () => {
  assert.deepEqual(buildPlaywrightFilterArgs('smoke'), ['--grep', '@smoke', '--grep-invert', '@skip']);
});

test('buildPlaywrightFilterArgs: full runs all tests except @skip', () => {
  assert.deepEqual(buildPlaywrightFilterArgs('full'), ['--grep-invert', '@skip']);
});
