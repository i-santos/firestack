import test from 'node:test';
import assert from 'node:assert/strict';
import { promoteCiCommandToFullE2E } from '../../scripts/cli/test.mjs';

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
