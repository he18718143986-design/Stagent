import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { canSwitchActiveInstance } from '../ActiveInstanceGuard';

test('canSwitchActiveInstance 同 key 始终允许', () => {
  assert.deepEqual(
    canSwitchActiveInstance({ currentKey: 'a', targetKey: 'a', executionDepth: 2 }),
    { ok: true },
  );
});

test('canSwitchActiveInstance 执行中禁止跨实例切换', () => {
  const d = canSwitchActiveInstance({ currentKey: 'a', targetKey: 'b', executionDepth: 1 });
  assert.equal(d.ok, false);
  if (!d.ok) {
    assert.equal(d.code, 'execution-in-flight');
  }
});

test('canSwitchActiveInstance 无当前实例或非执行中允许切换', () => {
  assert.deepEqual(
    canSwitchActiveInstance({ currentKey: undefined, targetKey: 'b', executionDepth: 0 }),
    { ok: true },
  );
  assert.deepEqual(
    canSwitchActiveInstance({ currentKey: 'a', targetKey: 'b', executionDepth: 0 }),
    { ok: true },
  );
});
