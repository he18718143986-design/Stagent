import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildDebugLogCopyResult, getRecentDebugLogLines } from '../DebugLogUtils';

test('copyRecentDebugLog: no log file -> not-found', () => {
  const result = buildDebugLogCopyResult(undefined, 200);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'not-found');
  }
});

test('copyRecentDebugLog: has log -> recent tail when limit passed', () => {
  const raw = Array.from({ length: 5 }, (_, i) => `line-${i + 1}`).join('\n');
  const result = buildDebugLogCopyResult(raw, 3);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.content, 'line-3\nline-4\nline-5');
  }
});

test('copyDebugLog: no tail limit -> entire file', () => {
  const raw = 'alpha\n\nbeta\n';
  const result = buildDebugLogCopyResult(raw);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.content, raw);
  }
});

test('getRecentDebugLogLines trims empty lines and limits count', () => {
  const raw = 'a\n\nb\nc\n';
  assert.equal(getRecentDebugLogLines(raw, 2), 'b\nc');
});
