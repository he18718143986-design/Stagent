import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  DEFAULT_MAX_GRILL_ROUNDS,
  buildGrillProgress,
  isCodeExplorableQuestion,
  nextGrillAction,
  selectNextGrillQuestion,
} from '../GrillLoopPolicy';
import type { Question } from '../WorkflowDefinition';

function q(id: string, text: string, required = true, hint?: string): Question {
  return { id, text, required, hint };
}

test('isCodeExplorableQuestion：现状类可查代码', () => {
  assert.equal(isCodeExplorableQuestion({ text: '当前代码里 reader 用了哪些字段？' }), true);
  assert.equal(isCodeExplorableQuestion({ text: 'which file defines the auth middleware?' }), true);
});

test('isCodeExplorableQuestion：偏好/取舍类必须问人', () => {
  assert.equal(isCodeExplorableQuestion({ text: '你更希望用 Redis 还是内存缓存？' }), false);
  assert.equal(isCodeExplorableQuestion({ text: '这个延迟预算可以接受吗？' }), false);
  // 偏好信号优先于事实信号
  assert.equal(
    isCodeExplorableQuestion({ text: '当前实现下，你希望保留哪种行为？' }),
    false,
  );
});

test('selectNextGrillQuestion：一次只返回一个，必答优先', () => {
  const questions = [q('a', '现有缓存策略？'), q('b', '希望的超时？'), q('c', '可选项', false)];
  const next = selectNextGrillQuestion(questions, {});
  assert.equal(next?.id, 'a');

  const next2 = selectNextGrillQuestion(questions, { a: 'LRU' });
  assert.equal(next2?.id, 'b');

  // 必答都答完 → 返回可选题
  const next3 = selectNextGrillQuestion(questions, { a: 'LRU', b: '5s' });
  assert.equal(next3?.id, 'c');

  // 全部答完 → undefined
  assert.equal(selectNextGrillQuestion(questions, { a: 'LRU', b: '5s', c: 'x' }), undefined);
});

test('buildGrillProgress：统计已答/剩余', () => {
  const questions = [q('a', 'x'), q('b', 'y'), q('c', 'z', false)];
  const p = buildGrillProgress(questions, { a: 'done' });
  assert.equal(p.total, 3);
  assert.equal(p.answered, 1);
  assert.deepEqual(p.remainingRequiredIds, ['b']);
  assert.deepEqual(p.remainingOptionalIds, ['c']);
});

test('nextGrillAction：必答可查代码 → explore-code', () => {
  const questions = [q('a', '当前代码用了哪个 ORM？')];
  const action = nextGrillAction({ questions, answers: {}, round: 0 });
  assert.equal(action.kind, 'explore-code');
});

test('nextGrillAction：必答偏好类 → ask', () => {
  const questions = [q('a', '你希望支持哪些数据库？')];
  const action = nextGrillAction({ questions, answers: {}, round: 0 });
  assert.equal(action.kind, 'ask');
});

test('nextGrillAction：必答全部答完 → done', () => {
  const questions = [q('a', 'x'), q('b', 'y', false)];
  const action = nextGrillAction({ questions, answers: { a: '1' }, round: 0 });
  assert.equal(action.kind, 'done');
});

test('nextGrillAction：超过最大轮次 → max-rounds-reached（防死循环）', () => {
  const questions = [q('a', '你希望用哪个框架？')];
  const action = nextGrillAction({
    questions,
    answers: {},
    round: DEFAULT_MAX_GRILL_ROUNDS,
  });
  assert.equal(action.kind, 'max-rounds-reached');
});
