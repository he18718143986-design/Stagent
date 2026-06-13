/**
 * 可体验交付集成测试：applySoftwareDiskPipeline 按 delivery.demoDelivery 注入 demo 链 +
 * postStageGates demo-artifact 三档语义。仿 workflow-disk-bootstrap / test-quality-gate 夹具模式。
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { GateResult, QualityGateContext } from '../QualityGate';
import type { Stage, WorkflowDefinition } from '../WorkflowDefinition';
import { applySoftwareDiskPipeline } from '../disk-bootstrap/applySoftwarePipeline';
import {
  DEMO_GENERATE_STAGE_ID,
  DEMO_RUN_STAGE_ID,
} from '../disk-bootstrap/demoStage';
import { DELIVERY_WRAPUP_STAGE_ID } from '../disk-bootstrap/deliveryWrapupStage';
import { SMOKE_RUN_STAGE_ID } from '../disk-bootstrap/smokeStage';
import { BUILTIN_POST_STAGE_GATES } from '../quality-gates/postStageGates';
import { GATE_ID_DEMO_ARTIFACT_RUN } from '../QualityGateIds';
import { CODE_RUNNER_EXIT_OUTPUT_KEY } from '../WorkflowOutputKeys';
import { bindStagentConfigPort } from '../settings/bindStagentConfig';

// ---------- 配置夹具 ----------

function bindDeliveryConfig(opts: {
  demoDelivery?: boolean;
  demoArtifactLint?: 'off' | 'warn' | 'hard';
}): void {
  bindStagentConfigPort({
    get: <T>(key: string, defaultValue?: T): T | undefined => {
      if (key === 'delivery.demoDelivery') {
        return (opts.demoDelivery === true) as T;
      }
      if (key === 'delivery.demoArtifactLint' && opts.demoArtifactLint) {
        return opts.demoArtifactLint as T;
      }
      return defaultValue;
    },
  });
}

function stageIndex(stages: Stage[], id: string): number {
  return stages.findIndex((s) => s.id === id);
}

function minimalPythonDeliverableWf(): WorkflowDefinition {
  return {
    id: 'wf_demo_pipeline',
    version: '2.0',
    meta: {
      title: 'demo pipeline',
      taskType: 'software',
      userInput: 'u',
      createdAt: new Date().toISOString(),
    },
    globalConfig: { language: 'python' },
    stages: [
      {
        id: 'stage_impl_main',
        title: 'impl main',
        tool: 'llm-text',
        toolConfig: {
          type: 'llm-text',
          systemPrompt: 'impl',
          writeOutputToFile: 'main.py',
          writePathBase: 'workspace',
        },
        input: { sources: [], mergeStrategy: 'concat' },
        outputs: [{ key: 'code', format: 'text' }],
        pauseAfter: false,
      },
      {
        id: 'stage_test_run_main',
        title: 'pytest',
        tool: 'code-runner',
        toolConfig: {
          type: 'code-runner',
          command: 'python -m pytest tests/ -v',
          captureOutput: true,
        },
        input: { sources: [], mergeStrategy: 'concat' },
        outputs: [{ key: 'testResults', format: 'json' }],
        pauseAfter: false,
      },
    ],
  };
}

function testWriteOnlyWf(): WorkflowDefinition {
  return {
    id: 'wf_test_only',
    version: '2.0',
    meta: {
      title: 'test only',
      taskType: 'software',
      userInput: 'u',
      createdAt: new Date().toISOString(),
    },
    stages: [
      {
        id: 'stage_test_write_indicators',
        title: 'tw',
        tool: 'llm-text',
        toolConfig: {
          type: 'llm-text',
          systemPrompt: 'tw',
          writeOutputToFile: 'tests/test_indicators.py',
          writePathBase: 'workspace',
        },
        input: { sources: [], mergeStrategy: 'concat' },
        outputs: [{ key: 'code', format: 'text' }],
        pauseAfter: false,
      },
    ],
  };
}

// ---------- applySoftwareDiskPipeline × delivery.demoDelivery ----------

test('pipeline：delivery.demoDelivery 默认关 → 不注入 demo 阶段', () => {
  bindDeliveryConfig({ demoDelivery: false });
  const next = applySoftwareDiskPipeline(minimalPythonDeliverableWf());
  assert.equal(next.stages.some((s) => s.id === DEMO_GENERATE_STAGE_ID), false);
  assert.equal(next.stages.some((s) => s.id === DEMO_RUN_STAGE_ID), false);
});

test('pipeline：delivery.demoDelivery=true + 有可交付实现 → 注入 generate→run，且在 delivery 前', () => {
  bindDeliveryConfig({ demoDelivery: true });
  const next = applySoftwareDiskPipeline(minimalPythonDeliverableWf());
  const ids = next.stages.map((s) => s.id);

  assert.ok(ids.includes(DEMO_GENERATE_STAGE_ID));
  assert.ok(ids.includes(DEMO_RUN_STAGE_ID));
  assert.ok(ids.includes(DELIVERY_WRAPUP_STAGE_ID));

  const genIdx = stageIndex(next.stages, DEMO_GENERATE_STAGE_ID);
  const runIdx = stageIndex(next.stages, DEMO_RUN_STAGE_ID);
  const deliveryIdx = stageIndex(next.stages, DELIVERY_WRAPUP_STAGE_ID);
  assert.ok(genIdx >= 0 && runIdx > genIdx && deliveryIdx > runIdx);

  const gen = next.stages[genIdx]!;
  const run = next.stages[runIdx]!;
  assert.deepEqual(run.dependsOn, [DEMO_GENERATE_STAGE_ID]);
  assert.match(
    (run.toolConfig as { command?: string }).command ?? '',
    /demo\/run_demo\.py/,
  );
});

test('pipeline：delivery.demoDelivery=true + 仅 test_write → 不注入 demo', () => {
  bindDeliveryConfig({ demoDelivery: true });
  const next = applySoftwareDiskPipeline(testWriteOnlyWf());
  assert.equal(next.stages.some((s) => s.id === DEMO_GENERATE_STAGE_ID), false);
  assert.equal(next.stages.some((s) => s.id === DEMO_RUN_STAGE_ID), false);
});

test('pipeline：delivery.demoDelivery=true + main.py 入口 → smoke 在场且 demo 锚定 smoke', () => {
  bindDeliveryConfig({ demoDelivery: true });
  const next = applySoftwareDiskPipeline(minimalPythonDeliverableWf());
  const ids = next.stages.map((s) => s.id);

  assert.ok(ids.includes(SMOKE_RUN_STAGE_ID), 'main.py 应触发 smoke 注入');
  const gen = next.stages.find((s) => s.id === DEMO_GENERATE_STAGE_ID)!;
  assert.deepEqual(gen.dependsOn, [SMOKE_RUN_STAGE_ID]);

  const smokeIdx = stageIndex(next.stages, SMOKE_RUN_STAGE_ID);
  const genIdx = stageIndex(next.stages, DEMO_GENERATE_STAGE_ID);
  const deliveryIdx = stageIndex(next.stages, DELIVERY_WRAPUP_STAGE_ID);
  assert.ok(smokeIdx < genIdx && genIdx < deliveryIdx);
});

// ---------- postStageGates × demo-artifact ----------

const demoArtifactGate = BUILTIN_POST_STAGE_GATES.find((g) => g.id === GATE_ID_DEMO_ARTIFACT_RUN)!;

function evalDemoGateSync(ctx: QualityGateContext): GateResult | null {
  const raw = demoArtifactGate.evaluate!(ctx);
  if (raw instanceof Promise) {
    throw new Error('expected sync gate evaluate');
  }
  return raw;
}

function makeDemoGateCtx(opts: {
  mode: 'off' | 'warn' | 'hard';
  exitCode?: number;
  withArtifacts?: boolean;
}): QualityGateContext {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-artifact-gate-'));
  if (opts.withArtifacts) {
    fs.mkdirSync(path.join(dir, 'demo'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'demo/summary.json'),
      JSON.stringify({ ran: true, signals: 3 }),
    );
    fs.writeFileSync(path.join(dir, 'QUICKSTART.md'), '# 运行\n`python demo/run_demo.py`');
  }
  const stage: Stage = {
    id: DEMO_RUN_STAGE_ID,
    title: 'demo run',
    tool: 'code-runner',
    toolConfig: { type: 'code-runner', command: 'python demo/run_demo.py', captureOutput: true },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'demoOutput', format: 'text' }],
    pauseAfter: false,
  };
  return {
    phase: 'post-stage',
    stage,
    stageRuntime: {
      stageId: DEMO_RUN_STAGE_ID,
      status: 'done',
      outputs:
        opts.exitCode != null
          ? { [CODE_RUNNER_EXIT_OUTPUT_KEY]: opts.exitCode }
          : {},
      retryCount: 0,
    },
    taskWorkspaceAbs: dir,
    executionHost: {
      readDemoArtifactLintMode: () => opts.mode,
      getWorkspaceRootAbsolute: () => dir,
    } as never,
  };
}

test('demo-artifact gate off → disabled', () => {
  const ctx = makeDemoGateCtx({ mode: 'off', exitCode: 1 });
  assert.equal(demoArtifactGate.enabled?.(ctx), false);
});

test('demo-artifact gate hard → exit 非 0 阻断', () => {
  const ctx = makeDemoGateCtx({ mode: 'hard', exitCode: 1 });
  const result = evalDemoGateSync(ctx);
  assert.ok(result);
  assert.equal(result.severity, 'block');
  assert.match(result.messages.join(' '), /demo-run-failed/);
});

test('demo-artifact gate warn → 缺产物降级为 warn', () => {
  const ctx = makeDemoGateCtx({ mode: 'warn', exitCode: 0, withArtifacts: false });
  const result = evalDemoGateSync(ctx);
  assert.ok(result);
  assert.equal(result.severity, 'warn');
  assert.match(result.messages.join(' '), /demo-summary-missing/);
});

test('demo-artifact gate hard + 产物齐全 → 通过', () => {
  const ctx = makeDemoGateCtx({ mode: 'hard', exitCode: 0, withArtifacts: true });
  assert.equal(evalDemoGateSync(ctx), null);
});
