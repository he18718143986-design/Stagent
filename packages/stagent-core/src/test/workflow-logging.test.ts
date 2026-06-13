import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { formatDebugLogLine, sanitizeForLog } from '../WorkflowLogging';

test('sanitizeForLog redacts sensitive keys and truncates long strings', () => {
  const out = sanitizeForLog({
    apiKey: 'secret',
    nested: { password: 'p', token: 't', ok: 'v' },
    text: 'x'.repeat(600),
  }) as Record<string, unknown>;

  assert.equal(out.apiKey, '[REDACTED]');
  assert.equal((out.nested as Record<string, unknown>).password, '[REDACTED]');
  assert.equal((out.nested as Record<string, unknown>).token, '[REDACTED]');
  assert.equal((out.nested as Record<string, unknown>).ok, 'v');
  assert.equal(typeof out.text, 'string');
  assert.equal((out.text as string).endsWith('...'), true);
});

test('sanitizeForLog does not redact outputKey or unrelated *key* field names', () => {
  const out = sanitizeForLog({
    outputKey: 'decisionRecord',
    monkey: 'business',
    tool_config_snapshot: { apiKey: 'x' },
  }) as Record<string, unknown>;

  assert.equal(out.outputKey, 'decisionRecord');
  assert.equal(out.monkey, 'business');
  assert.equal((out.tool_config_snapshot as Record<string, unknown>).apiKey, '[REDACTED]');
});

test('formatDebugLogLine includes trace/stage/event/attempt markers', () => {
  const line = formatDebugLogLine('trace_x', 'stage_a', 'stage_start', 1, { ok: true });
  assert.match(line, /\[trace_x\] \[stage_a\] \[stage_start\] \[1\]/);
  assert.match(line, /\{"ok":true\}/);
});
