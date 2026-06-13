/**
 * P1（T4 Run #22 根治）：post test_write gate block → 同 stage 重试信号语义。
 *
 * 验证 scoreLlmTextConfidenceAndGates 在 hard 门禁拦截时：
 *  - 前 MAX 次抛 TestWriteGateBlockedError（供 runner 带反馈重写）；
 *  - 重试额度耗尽后才 failWorkflowStageFromGate → StageAlreadyHandledError 终态；
 *  - warn 模式不阻断。
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { BackendMessage, Stage, WorkflowInstance } from '../WorkflowDefinition';
import {
  registerBuiltinQualityGates,
} from '../BuiltinQualityGates';
import { resetDefaultQualityGateRegistry } from '../QualityGate';
import { scoreLlmTextConfidenceAndGates } from '../stage-runners/LlmTextScoreStep';
import { StageAlreadyHandledError } from '../stage-runners/StageControlSignals';
import {
  buildTestWriteGateRetrySystemAppend,
  MAX_TEST_WRITE_GATE_RETRIES,
  readTestWriteGateRetryState,
  TEST_WRITE_GATE_RETRY_OUTPUT_KEY,
  TestWriteGateBlockedError,
} from '../stage-runners/llm-persist/testWriteGateRetry';
import { testWriteStageIdFromSemanticName } from '../workflow/StageIdPatterns';
import type { StageStepContext } from '../stage-runners/StageStepContext';

const WEAK_TEST = `import indicators

def test_imports():
    assert indicators is not None
`;

function makeCtx(opts: { mode: 'warn' | 'hard'; testBody: string }): {
  ctx: StageStepContext;
  posted: BackendMessage[];
  instance: WorkflowInstance;
} {
  const semantic = 'indicators';
  const testPath = `tests/test_${semantic}.py`;
  const stage: Stage = {
    id: testWriteStageIdFromSemanticName(semantic)!,
    title: 'tw',
    tool: 'llm-text',
    toolConfig: {
      type: 'llm-text',
      systemPrompt: 'write test',
      writeOutputToFile: testPath,
      writePathBase: 'workspace',
    },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'code', format: 'text' }],
    pauseAfter: false,
  };
  const instance = {
    status: 'running' as const,
    definition: {
      id: 'wf',
      version: '2.0',
      meta: { title: 't', taskType: 'software', userInput: 'u', createdAt: new Date().toISOString() },
      stages: [stage],
    },
    stageRuntimes: [
      { stageId: stage.id, status: 'running', outputs: { code: opts.testBody }, retryCount: 0 },
    ],
    currentStageIndex: 0,
  } satisfies WorkflowInstance;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-gate-retry-'));
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(dir, testPath), opts.testBody);

  const posted: BackendMessage[] = [];
  const host = {
    getWorkspaceRootAbsolute: () => dir,
    readTestQualityLintMode: () => opts.mode,
    readPythonModuleContractLintMode: () => 'off' as const,
    readPythonPypiSymbolLintMode: () => 'off' as const,
  };
  const params = {
    panel: {},
    instance,
    postMessage: (_p: unknown, msg: BackendMessage) => posted.push(msg),
    debugLog: () => {},
    primaryOutputKey: (s: Stage) => s.outputs[0]?.key ?? 'code',
    confidencePauseThreshold: 0,
    scheduleSave: () => {},
    getWorkspaceRoot: () => dir,
    memoryExperienceEnabled: false,
    qualityGateExecutionHost: host,
  } as never;
  const ctx: StageStepContext = {
    params,
    stageIndex: 0,
    instance,
    stage,
    runtime: instance.stageRuntimes[0],
    panel: {},
  };
  return { ctx, posted, instance };
}

function withBuiltinGates(fn: () => Promise<void>): Promise<void> {
  resetDefaultQualityGateRegistry();
  registerBuiltinQualityGates();
  return fn().finally(() => resetDefaultQualityGateRegistry());
}

test('hard 门禁拦截 → 前 MAX 次抛 TestWriteGateBlockedError 并计数', () =>
  withBuiltinGates(async () => {
    const { ctx, instance } = makeCtx({ mode: 'hard', testBody: WEAK_TEST });
    for (let i = 1; i <= MAX_TEST_WRITE_GATE_RETRIES; i++) {
      await assert.rejects(
        scoreLlmTextConfidenceAndGates(ctx, 1, 'ikey', {}),
        (e: unknown) => e instanceof TestWriteGateBlockedError,
      );
      const state = readTestWriteGateRetryState(ctx.runtime.outputs);
      assert.equal(state.attempts, i);
      assert.ok(state.lastMessages.join(' ').includes('is not None'));
      assert.equal(instance.status, 'running');
    }
  }));

test('重试额度耗尽 → StageAlreadyHandledError 终态 + workflowFailed', () =>
  withBuiltinGates(async () => {
    const { ctx, posted, instance } = makeCtx({ mode: 'hard', testBody: WEAK_TEST });
    ctx.runtime.outputs[TEST_WRITE_GATE_RETRY_OUTPUT_KEY] = {
      attempts: MAX_TEST_WRITE_GATE_RETRIES,
      lastMessages: ['x'],
    };
    await assert.rejects(
      scoreLlmTextConfidenceAndGates(ctx, 1, 'ikey', {}),
      (e: unknown) =>
        e instanceof StageAlreadyHandledError && e.reason === 'post-test-write-quality-gate-failed',
    );
    assert.equal(instance.status, 'failed');
    assert.ok(posted.some((m) => m.type === 'workflowFailed'));
  }));

test('warn 模式 → 不阻断不重试', () =>
  withBuiltinGates(async () => {
    const { ctx, instance } = makeCtx({ mode: 'warn', testBody: WEAK_TEST });
    await scoreLlmTextConfidenceAndGates(ctx, 1, 'ikey', {});
    assert.equal(instance.status, 'running');
    assert.equal(readTestWriteGateRetryState(ctx.runtime.outputs).attempts, 0);
  }));

test('健康测试 hard 模式 → 直接通过', () =>
  withBuiltinGates(async () => {
    const healthy = `from indicators import compute_ma

def test_compute_ma():
    assert compute_ma([1.0, 2.0, 3.0]) == 2.0
`;
    const { ctx, instance } = makeCtx({ mode: 'hard', testBody: healthy });
    await scoreLlmTextConfidenceAndGates(ctx, 1, 'ikey', {});
    assert.equal(instance.status, 'running');
  }));

test('gate retry prompt 包含 gate 报告与硬规则', () => {
  const sys = buildTestWriteGateRetrySystemAppend(['contract:test-tests-implementation:tests/test_x.py 仅断言对象存在']);
  assert.match(sys, /质量门禁拒绝/);
  assert.match(sys, /test-tests-implementation/);
  assert.match(sys, /sys\.modules/);
  assert.match(sys, /is not None/);
});
