import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { executeImplWithHollowGuard } from '../ImplOutputExecution';

test('impl guard retries once then succeeds', async () => {
  const outputs = ['好的，已确认职责边界。', '```ts\nexport const ok = true;\n```'];
  const calls: Array<{ sys: string; user: string }> = [];
  const result = await executeImplWithHollowGuard('sys', 'user', async (sys, user) => {
    calls.push({ sys, user });
    return outputs[calls.length - 1];
  });
  assert.equal(calls.length, 2);
  assert.match(calls[1].sys, /自动质量兜底/);
  assert.equal(result.note.includes('已通过自动重试纠正'), true);
  assert.match(result.text, /export const ok/);
});

test('impl guard fails when second output still hollow', async () => {
  const outputs = ['我将按照决策清单执行。', 'Confirmed. I will follow the plan.'];
  let call = 0;
  await assert.rejects(
    () =>
      executeImplWithHollowGuard('sys', 'user', async () => {
        const out = outputs[call] ?? outputs[outputs.length - 1];
        call += 1;
        return out;
      }),
    /impl-hollow-output/,
  );
  assert.equal(call, 2);
});
