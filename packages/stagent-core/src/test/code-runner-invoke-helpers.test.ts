import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  commandNeedsNetworkAccess,
  DEPENDENCY_INSTALL_TIMEOUT_SEC,
  resolveCodeRunnerTimeoutSeconds,
  resolveSandboxNetworkAllowed,
} from '../CodeRunnerInvokeHelpers';

test('commandNeedsNetworkAccess detects npm install', () => {
  assert.equal(commandNeedsNetworkAccess('cd apps/server && npm install'), true);
  assert.equal(commandNeedsNetworkAccess('npm init -y'), false);
});

test('resolveCodeRunnerTimeoutSeconds bumps inadequate install timeout', () => {
  assert.equal(resolveCodeRunnerTimeoutSeconds('npm install', 120), DEPENDENCY_INSTALL_TIMEOUT_SEC);
});

test('resolveSandboxNetworkAllowed for install', () => {
  assert.equal(resolveSandboxNetworkAllowed('npm install'), true);
  assert.equal(resolveSandboxNetworkAllowed('npm test'), false);
});
