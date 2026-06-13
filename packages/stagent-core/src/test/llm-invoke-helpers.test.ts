import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  DEFAULT_LLM_TIMEOUT_SECONDS,
  DEFAULT_LLM_MAX_OUTPUT_TOKENS,
  buildLlmInvokePrompt,
  buildLlmRefusalRetryPrompt,
  createIdleTimeout,
  formatLlmUserFacingError,
  resolveLlmMaxOutputTokens,
  resolveLlmTimeoutSeconds,
  type IdleTimers,
} from '../LlmInvokeHelpers';

/** 单次触发的假时钟：set 记录 handler，fireAll 触发并移除当前挂起计时器。 */
function makeFakeTimers(): {
  timers: IdleTimers;
  fireAll: () => void;
  pendingCount: () => number;
} {
  let nextId = 1;
  const pending = new Map<number, () => void>();
  const timers: IdleTimers = {
    set(handler: () => void): number {
      const id = nextId++;
      pending.set(id, handler);
      return id;
    },
    clear(handle: unknown): void {
      pending.delete(handle as number);
    },
  };
  return {
    timers,
    fireAll(): void {
      for (const [id, handler] of [...pending.entries()]) {
        pending.delete(id);
        handler();
      }
    },
    pendingCount: () => pending.size,
  };
}

test('resolveLlmTimeoutSeconds clamps to 30..600', () => {
  assert.equal(resolveLlmTimeoutSeconds(undefined), DEFAULT_LLM_TIMEOUT_SECONDS);
  assert.equal(resolveLlmTimeoutSeconds(10), 30);
  assert.equal(resolveLlmTimeoutSeconds(999), 600);
  assert.equal(resolveLlmTimeoutSeconds(240), 240);
});

test('resolveLlmMaxOutputTokens clamps to 1024..65536', () => {
  assert.equal(resolveLlmMaxOutputTokens(undefined), DEFAULT_LLM_MAX_OUTPUT_TOKENS);
  assert.equal(resolveLlmMaxOutputTokens(500), 1024);
  assert.equal(resolveLlmMaxOutputTokens(99_999), 65_536);
  assert.equal(resolveLlmMaxOutputTokens(8192), 8192);
});

test('formatLlmUserFacingError maps aborted to timeout hint', () => {
  const msg = formatLlmUserFacingError(new Error('This operation was aborted'), 180_000);
  assert.ok(msg.includes('180 秒'));
  assert.ok(msg.includes('stagent.llmTimeoutSeconds'));
});

test('formatLlmUserFacingError passes through other errors', () => {
  assert.equal(formatLlmUserFacingError(new Error('LLM API 请求失败 [401]'), 60_000), 'LLM API 请求失败 [401]');
});

test('buildLlmInvokePrompt combines system + user sections', () => {
  assert.equal(buildLlmInvokePrompt('SYS', 'USER'), '系统指令：\nSYS\n\n用户输入：\nUSER');
});

test('buildLlmRefusalRetryPrompt appends continuation directive', () => {
  const out = buildLlmRefusalRetryPrompt('BASE');
  assert.ok(out.startsWith('BASE\n\n补充要求：'));
  assert.ok(out.includes('禁止只返回拒绝句'));
});

test('createIdleTimeout fires onIdle when there is no activity', () => {
  const clock = makeFakeTimers();
  let fired = 0;
  createIdleTimeout(1000, () => (fired += 1), clock.timers);
  assert.equal(clock.pendingCount(), 1);
  clock.fireAll();
  assert.equal(fired, 1);
});

test('createIdleTimeout reset re-arms and only the latest timer survives', () => {
  const clock = makeFakeTimers();
  let fired = 0;
  const idle = createIdleTimeout(1000, () => (fired += 1), clock.timers);
  idle.reset();
  idle.reset();
  assert.equal(clock.pendingCount(), 1);
  clock.fireAll();
  assert.equal(fired, 1);
});

test('createIdleTimeout clear stops the timer from firing', () => {
  const clock = makeFakeTimers();
  let fired = 0;
  const idle = createIdleTimeout(1000, () => (fired += 1), clock.timers);
  idle.clear();
  assert.equal(clock.pendingCount(), 0);
  clock.fireAll();
  assert.equal(fired, 0);
});

test('createIdleTimeout does not re-arm after it already fired', () => {
  const clock = makeFakeTimers();
  let fired = 0;
  const idle = createIdleTimeout(1000, () => (fired += 1), clock.timers);
  clock.fireAll();
  idle.reset();
  clock.fireAll();
  assert.equal(fired, 1);
});
