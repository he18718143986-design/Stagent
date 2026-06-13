import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { normalizeQuestions } from '../QuestionNormalization';

test('normalizeQuestions maps prompt/question/title to text and fills id', () => {
  const out = normalizeQuestions(
    [{ prompt: '超时时间是多少？', hint: '30s', required: true }, { question: '错误策略？' }, { title: '阈值？' }],
    'stage_impl_x',
    'before',
  );
  assert.ok(out);
  assert.equal(out.length, 3);
  assert.equal(out[0].id, 'before_q_1');
  assert.equal(out[0].text, '超时时间是多少？');
  assert.equal(out[1].text, '错误策略？');
  assert.equal(out[2].text, '阈值？');
});

test('normalizeQuestions returns undefined for empty input', () => {
  assert.equal(normalizeQuestions(undefined, 'stage_impl_x', 'before'), undefined);
  assert.equal(normalizeQuestions([], 'stage_impl_x', 'after'), undefined);
});
