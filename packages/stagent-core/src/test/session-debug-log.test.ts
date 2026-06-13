import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  SESSION_DEBUG_FILENAME,
  sessionDebugLogPath,
  formatSessionLogLine,
  appendSessionLogLine,
} from '../SessionDebugLog';

test('sessionDebugLogPath joins the fixed filename under the storage dir', () => {
  assert.equal(sessionDebugLogPath('/tmp/store'), path.join('/tmp/store', SESSION_DEBUG_FILENAME));
  assert.equal(SESSION_DEBUG_FILENAME, '.session-debug.log');
});

test('formatSessionLogLine encodes ISO ts + session/purpose/event + json payload', () => {
  const line = formatSessionLogLine('task-polish', 'llm_start', { model: 'direct:gpt-4o', promptChars: 12 });
  assert.match(line, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z \[session\] \[task-polish\] \[llm_start\] /);
  assert.match(line, /"model":"direct:gpt-4o"/);
  assert.match(line, /"promptChars":12/);
});

test('formatSessionLogLine omits payload when undefined', () => {
  const line = formatSessionLogLine('clarify-questions', 'llm_end');
  assert.match(line, /\[clarify-questions\] \[llm_end\] $/);
});

test('formatSessionLogLine redacts sensitive fields (sanitizeForLog)', () => {
  const line = formatSessionLogLine('workflow-gen', 'llm_start', { apiKey: 'sk-secret', model: 'm' });
  assert.match(line, /"apiKey":"\[REDACTED\]"/);
  assert.doesNotMatch(line, /sk-secret/);
});

test('appendSessionLogLine creates the dir and appends lines in order', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-log-'));
  const sub = path.join(dir, 'nested-storage'); // not yet created → must be made
  try {
    appendSessionLogLine(sub, formatSessionLogLine('task-polish', 'llm_start', { a: 1 }));
    appendSessionLogLine(sub, formatSessionLogLine('task-polish', 'llm_end', { b: 2 }));

    const raw = fs.readFileSync(sessionDebugLogPath(sub), 'utf-8');
    const lines = raw.trimEnd().split('\n');
    assert.equal(lines.length, 2);
    assert.match(lines[0], /\[llm_start\] .*"a":1/);
    assert.match(lines[1], /\[llm_end\] .*"b":2/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
