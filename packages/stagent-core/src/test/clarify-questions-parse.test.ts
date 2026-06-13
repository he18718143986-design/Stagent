import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { lenientExtractClarifyQuestions } from '../ClarifyQuestionsParse';

test('lenientExtractClarifyQuestions recovers complete questions from truncated JSON', () => {
  const raw = `{"questions": [{"id": "q1", "text": "语音功能是指实时语音通话（类似Clubhouse），还是发送语音消息？", "options": ["实时语音通话", "语音消息", "两者都需要"]}, {"id": "q2", "text": "聊天室是公开的（任何用户可加入）还是私密的（邀请制）？", "options": ["公开聊天室", "私密聊天室", "两}`;
  const qs = lenientExtractClarifyQuestions(raw);
  assert.equal(qs.length, 2);
  assert.equal(qs[0].id, 'q1');
  assert.match(qs[0].text, /语音功能/);
  assert.deepEqual(qs[0].options, ['实时语音通话', '语音消息', '两者都需要']);
  assert.equal(qs[1].id, 'q2');
  assert.match(qs[1].text, /聊天室/);
  assert.equal(qs[1].options, undefined);
});

test('lenientExtractClarifyQuestions returns empty for non-question text', () => {
  assert.deepEqual(lenientExtractClarifyQuestions('not json at all'), []);
});
