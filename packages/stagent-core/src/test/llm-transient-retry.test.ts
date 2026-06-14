/**
 * T4 Run #68 根治回归：单个 LLM 调用遭遇瞬态网络错误（连接被掐断 `terminated` 等）
 * 时应自动重试，而非让 ~30 次调用的整轮 T4 因一次掉线而 workflowFailed。
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  createCoreLlmInvoker,
  isTransientLlmError,
  MAX_TRANSIENT_LLM_RETRIES,
} from '../core/CoreLlmInvoker';
import type { LlmModel, PlatformAdapter, ConfigPort } from '../platform/PlatformAdapter';

/* ---------------- 纯函数：瞬态判定 ---------------- */

test('isTransientLlmError detects connection-drop errors', () => {
  for (const msg of [
    'terminated',
    'TypeError: terminated',
    'read ECONNRESET',
    'socket hang up',
    'fetch failed',
    'premature close',
    'other side closed',
    'UND_ERR_SOCKET',
  ]) {
    assert.equal(isTransientLlmError(new Error(msg), false), true, msg);
  }
});

test('isTransientLlmError excludes idle-timeout aborts and unrelated errors', () => {
  // idle 超时主动 abort：不视为瞬态（genuine 卡死，重试只会加倍等待）
  assert.equal(isTransientLlmError(new Error('terminated'), true), false);
  // 业务错误：不重试
  assert.equal(isTransientLlmError(new Error('已选择「直接 API」模型但未配置'), false), false);
  assert.equal(isTransientLlmError(new Error('invalid json'), false), false);
});

/* ---------------- 集成：invoker 重试 ---------------- */

function cfgWith(values: Record<string, unknown>): ConfigPort {
  return {
    get<T>(key: string, defaultValue?: T): T | undefined {
      return key in values ? (values[key] as T) : defaultValue;
    },
  } as ConfigPort;
}

/** 前 failTimes 次 sendRequest 在流中抛出 errMsg，之后正常吐 reply。 */
function flakyModel(family: string, reply: string, failTimes: number, errMsg: string): LlmModel {
  let calls = 0;
  return {
    id: `flaky:${family}`,
    family,
    name: family,
    structuredOutput: true,
    // eslint-disable-next-line @typescript-eslint/require-await
    async *sendRequest(): AsyncGenerator<string> {
      calls += 1;
      if (calls <= failTimes) {
        throw new Error(errMsg);
      }
      yield reply;
    },
  } as unknown as LlmModel;
}

function makeInvoker(model: LlmModel, configValues: Record<string, unknown>) {
  const platform = {
    config: cfgWith(configValues),
    llm: {
      async listModels(filter?: { family?: string }): Promise<LlmModel[]> {
        const family = filter?.family?.trim();
        return family && family !== model.family ? [] : [model];
      },
    },
  } as unknown as PlatformAdapter;
  return createCoreLlmInvoker({
    platform,
    getPreferredModelFamily: () => 'direct:main-model',
    sendBackendMessage: () => {},
    debug: { llmTraceLog: () => {}, logUserAction: () => {} },
  });
}

const CFG = { llmApiKey: 'k', llmTimeoutSeconds: 600 };

test('invoker retries a transient stream drop and then succeeds', async () => {
  const model = flakyModel('direct:main-model', 'recovered', 1, 'terminated');
  const invoke = makeInvoker(model, CFG);
  assert.equal(await invoke('sys', 'user', 'stage_fix_if_failed_indicators'), 'recovered');
});

test('invoker gives up after MAX transient retries and surfaces a user-facing error', async () => {
  // 失败次数超过上限 → 最终抛出（不无限重试）
  const model = flakyModel('direct:main-model', 'never', MAX_TRANSIENT_LLM_RETRIES + 1, 'terminated');
  const invoke = makeInvoker(model, CFG);
  await assert.rejects(() => invoke('sys', 'user', 'stage_fix_if_failed_indicators'));
});

test('invoker does NOT retry a non-transient error', async () => {
  let calls = 0;
  const model = {
    id: 'x',
    family: 'direct:main-model',
    name: 'x',
    structuredOutput: true,
    // eslint-disable-next-line @typescript-eslint/require-await
    async *sendRequest(): AsyncGenerator<string> {
      calls += 1;
      throw new Error('invalid request: bad params');
    },
  } as unknown as LlmModel;
  const invoke = makeInvoker(model, CFG);
  await assert.rejects(() => invoke('sys', 'user', 'stage_impl_indicators'));
  assert.equal(calls, 1); // 非瞬态：仅 1 次，无重试
});
