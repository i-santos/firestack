import test from 'node:test';
import assert from 'node:assert/strict';
import { mapCommandKey, promoteCiCommandToFullE2E } from '../../scripts/cli/test.mjs';

test('promoteCiCommandToFullE2E upgrades internal run-e2e smoke to full', () => {
  const command = 'firestack internal run-integration-report && firestack internal run-e2e smoke';
  const promoted = promoteCiCommandToFullE2E(command);
  assert.equal(promoted, 'firestack internal run-integration-report && firestack internal run-e2e full');
});

test('promoteCiCommandToFullE2E supports rewritten internal runner command', () => {
  const command = "node '/firestack-cli/bin/firestack.mjs' internal run-e2e smoke";
  const promoted = promoteCiCommandToFullE2E(command);
  assert.equal(promoted, "node '/firestack-cli/bin/firestack.mjs' internal run-e2e full");
});

test('promoteCiCommandToFullE2E keeps command unchanged when no smoke stage exists', () => {
  const command = 'firestack internal run-integration-report && echo done';
  const promoted = promoteCiCommandToFullE2E(command);
  assert.equal(promoted, command);
});

test('mapCommandKey resolves ci --full and ci --fail-fast --full variants explicitly', () => {
  assert.equal(mapCommandKey({
    ci: true, unit: false, integration: false, e2e: false, staging: false, failFast: false, full: true,
  }), 'ciFull');
  assert.equal(mapCommandKey({
    ci: true, unit: false, integration: false, e2e: false, staging: false, failFast: true, full: true,
  }), 'ciFailFastFull');
});

test('mapCommandKey keeps legacy keys for non-full ci and explicit suite keys for e2e/staging', () => {
  assert.equal(mapCommandKey({
    ci: true, unit: false, integration: false, e2e: false, staging: false, failFast: false, full: false,
  }), 'ci');
  assert.equal(mapCommandKey({
    ci: false, unit: false, integration: false, e2e: true, staging: false, failFast: false, full: true,
  }), 'e2eFull');
  assert.equal(mapCommandKey({
    ci: false, unit: false, integration: false, e2e: false, staging: true, failFast: false, full: false,
  }), 'stagingSmoke');
});

test('mapCommandKey rejects conflicting explicit test scopes', () => {
  assert.throws(() => mapCommandKey({
    ci: false, unit: true, integration: true, e2e: false, staging: false, failFast: false, full: false,
  }), /invalid test scope/);
});
