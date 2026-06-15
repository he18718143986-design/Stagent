/**
 * P0（T4 Run #22 根治）：post test_write 测试质量门禁 off/warn/hard 三档语义。
 * 仿 module-contract-gate.test.ts 的夹具模式。
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { GateResult, QualityGateContext } from '../QualityGate';
import type { Stage, WorkflowInstance } from '../WorkflowDefinition';
import { BUILTIN_POST_STAGE_GATES } from '../quality-gates/postStageGates';
import { GATE_ID_TEST_QUALITY_TEST_WRITE } from '../QualityGateIds';
import { testWriteStageIdFromSemanticName } from '../workflow/StageIdPatterns';

const gate = BUILTIN_POST_STAGE_GATES.find((g) => g.id === GATE_ID_TEST_QUALITY_TEST_WRITE)!;

function evalSync(ctx: QualityGateContext): GateResult | null {
  const raw = gate.evaluate!(ctx);
  if (raw instanceof Promise) {
    throw new Error('expected sync gate evaluate');
  }
  return raw;
}

function makeGateCtx(opts: {
  mode: 'off' | 'warn' | 'hard';
  semantic: string;
  testBody: string;
}): QualityGateContext {
  const testPath = `tests/test_${opts.semantic}.py`;
  const stage: Stage = {
    id: testWriteStageIdFromSemanticName(opts.semantic)!,
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
    stageRuntimes: [{ stageId: stage.id, status: 'running', outputs: {}, retryCount: 0 }],
    currentStageIndex: 0,
  } satisfies WorkflowInstance;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-quality-gate-'));
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(dir, testPath), opts.testBody);
  return {
    phase: 'post-stage',
    stage,
    instance,
    taskWorkspaceAbs: dir,
    executionHost: {
      readTestQualityLintMode: () => opts.mode,
      getWorkspaceRootAbsolute: () => dir,
    } as never,
  };
}

const WEAK_TEST = `import indicators

def test_imports():
    assert indicators is not None
`;

const SYS_MODULES_TEST = `import sys
import types

sys.modules['indicators'] = types.ModuleType('indicators')

def test_compute():
    from indicators import compute_ma
    assert compute_ma([1.0, 2.0, 3.0]) == 2.0
`;

const HEALTHY_TEST = `from indicators import compute_ma

def test_compute_ma_window():
    out = compute_ma([1.0, 2.0, 3.0], window=3)
    assert out == 2.0
`;

test('test-quality gate off → disabled', () => {
  const ctx = makeGateCtx({ mode: 'off', semantic: 'indicators', testBody: WEAK_TEST });
  assert.equal(gate.enabled?.(ctx), false);
});

test('test-quality gate hard → 弱断言 only 阻断', () => {
  const ctx = makeGateCtx({ mode: 'hard', semantic: 'indicators', testBody: WEAK_TEST });
  const result = evalSync(ctx);
  assert.ok(result);
  assert.equal(result.severity, 'block');
  assert.match(result.messages.join(' '), /is not None/);
});

test('test-quality gate hard → sys.modules 劫持阻断', () => {
  const ctx = makeGateCtx({ mode: 'hard', semantic: 'indicators', testBody: SYS_MODULES_TEST });
  const result = evalSync(ctx);
  assert.ok(result);
  assert.equal(result.severity, 'block');
  assert.match(result.messages.join(' '), /sys\.modules/);
});

test('test-quality gate warn → 弱断言降级为 warn', () => {
  const ctx = makeGateCtx({ mode: 'warn', semantic: 'indicators', testBody: WEAK_TEST });
  const result = evalSync(ctx);
  assert.ok(result);
  assert.equal(result.severity, 'warn');
});

test('test-quality gate hard → 健康行为级测试通过', () => {
  const ctx = makeGateCtx({ mode: 'hard', semantic: 'indicators', testBody: HEALTHY_TEST });
  assert.equal(evalSync(ctx), null);
});

test('test-quality gate hard → 私有细节断言仅 warn 不阻断', () => {
  const body = `from indicators import Engine

def test_engine():
    e = Engine()
    assert e._cache == {}
    assert e.run([1.0]) == 1.0
`;
  const ctx = makeGateCtx({ mode: 'hard', semantic: 'indicators', testBody: body });
  const result = evalSync(ctx);
  assert.ok(result);
  assert.equal(result.severity, 'warn');
});

test('非 test_write 阶段 → disabled', () => {
  const ctx = makeGateCtx({ mode: 'hard', semantic: 'indicators', testBody: WEAK_TEST });
  (ctx.stage as Stage).id = 'stage_impl_indicators';
  assert.equal(gate.enabled?.(ctx), false);
});

const NODE_WEAK_TEST = `import { it, expect } from 'vitest'
import * as store from '../store'
it('imports store', () => { expect(store).toBeDefined() })
`;

function makeNodeGateCtx(opts: {
  mode: 'off' | 'warn' | 'hard';
  semantic: string;
  testBody: string;
}): QualityGateContext {
  const testPath = `src/__tests__/${opts.semantic}.test.ts`;
  const testWriteStage: Stage = {
    id: testWriteStageIdFromSemanticName(opts.semantic)!,
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
  const testRunStage: Stage = {
    id: `stage_test_run_${opts.semantic}`,
    title: 'tr',
    tool: 'code-runner',
    toolConfig: {
      type: 'code-runner',
      command: 'npx vitest run',
      captureOutput: true,
    },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'text', format: 'text' }],
    pauseAfter: false,
  };
  const instance = {
    status: 'running' as const,
    definition: {
      id: 'wf-node',
      version: '2.0',
      meta: { title: 't', taskType: 'software', userInput: 'u', createdAt: new Date().toISOString() },
      stages: [testWriteStage, testRunStage],
    },
    stageRuntimes: [{ stageId: testWriteStage.id, status: 'running', outputs: {}, retryCount: 0 }],
    currentStageIndex: 0,
  } satisfies WorkflowInstance;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-quality-gate-node-'));
  fs.mkdirSync(path.join(dir, 'src', '__tests__'), { recursive: true });
  fs.writeFileSync(path.join(dir, testPath), opts.testBody);
  return {
    phase: 'post-stage',
    stage: testWriteStage,
    instance,
    taskWorkspaceAbs: dir,
    executionHost: {
      readTestQualityLintMode: () => opts.mode,
      getWorkspaceRootAbsolute: () => dir,
    } as never,
  };
}

test('PR-3 node 工作流 → postStageGates 选 node adapter，existence-only hard 阻断', () => {
  const ctx = makeNodeGateCtx({ mode: 'hard', semantic: 'store', testBody: NODE_WEAK_TEST });
  const result = evalSync(ctx);
  assert.ok(result);
  assert.equal(result.severity, 'block');
  assert.match(result.messages.join(' '), /toBeDefined|存在性|existence/i);
});

test('PR-3 python 工作流 → postStageGates 仍走 python adapter（弱断言 is not None）', () => {
  const ctx = makeGateCtx({ mode: 'hard', semantic: 'indicators', testBody: WEAK_TEST });
  const result = evalSync(ctx);
  assert.ok(result);
  assert.equal(result.severity, 'block');
  assert.match(result.messages.join(' '), /is not None/);
});
