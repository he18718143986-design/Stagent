import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { isHollowImplOutput } from '../ImplOutputGuard';

test('detects hollow confirmation output in Chinese', () => {
  const text = '好的，已确认职责边界和关键设计决策清单。后续将严格按照清单执行。';
  assert.equal(isHollowImplOutput(text), true);
});

test('detects hollow confirmation output in English', () => {
  const text = 'Confirmed. I will follow the plan and proceed.';
  assert.equal(isHollowImplOutput(text), true);
});

test('does not mark fenced code output as hollow', () => {
  const text = '```ts\nexport function x(){ return 1; }\n```';
  assert.equal(isHollowImplOutput(text), false);
});
