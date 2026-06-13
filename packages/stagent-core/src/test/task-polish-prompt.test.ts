import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildTaskPolishSystemPrompt } from '../TaskPolishPrompt';

test('buildTaskPolishSystemPrompt embeds taskType and Stagent wording', () => {
  const p = buildTaskPolishSystemPrompt('software');
  assert.match(p, /software/);
  assert.match(p, /Stagent/);
});

test('buildTaskPolishSystemPrompt auto mode asks model to infer taskType context', () => {
  const p = buildTaskPolishSystemPrompt('auto');
  assert.match(p, /software \/ refactor \/ debug \/ prototype/);
  assert.match(p, /Python 脚本/);
});
