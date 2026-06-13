import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mapSandboxError, SandboxExecutionError } from '../SandboxExecutor';

test('mapSandboxError maps sandbox execution errors', () => {
  assert.equal(
    mapSandboxError(new SandboxExecutionError('mem', 'sandbox-memory-exceeded')),
    'sandbox-memory-exceeded',
  );
  assert.equal(mapSandboxError(new Error('code-runner-timeout')), 'code-runner-timeout');
  assert.equal(mapSandboxError(new Error('other')), undefined);
});
