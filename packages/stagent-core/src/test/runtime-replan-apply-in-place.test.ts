/**
 * T4 Run #23 根治回归：applyRuntimeReplan 必须原地突变 instance，
 * 外部持有的 stages / stageRuntimes / currentStageIndex 引用须立即可见插入结果；
 * fix-exhausted 升级链第 2 级须生成测试重写（testfix）stage。
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { Stage, WorkflowInstance } from '../WorkflowDefinition';
import { applyRuntimeReplan } from '../runtime-replan/applyRuntimeReplan';
import { planDeterministicReplan } from '../runtime-replan/planDeterministicReplan';
import {
  isRuntimeReplanTestFixStageId,
  RUNTIME_REPLAN_POSTTESTFIX_FIX_STAGE_ID_PREFIX,
  RUNTIME_REPLAN_TESTFIX_STAGE_ID_PREFIX,
} from '../runtime-replan/constants';
import {
  isRuntimeReplanFixStageId,
  readFixChainLedger,
  resetFixChainLedger,
  semanticFromRuntimeReplanFixStageId,
  semanticFromRuntimeReplanImplFixStageId,
} from '../runtime-replan/FixExhaustedRouter';
import { FIX_CHAIN_OUTPUT_KEY } from '../runtime-replan/constants';
import type { RuntimeReplanTrigger } from '../runtime-replan/types';

function makeStage(id: string): Stage {
  return {
    id,
    title: id,
    tool: 'llm-text',
    toolConfig: { type: 'llm-text', systemPrompt: 'x' },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'out', format: 'text' }],
    pauseAfter: false,
  };
}

function makeInstance(stageIds: string[], currentStageIndex: number): WorkflowInstance {
  const stages = stageIds.map(makeStage);
  return {
    status: 'running',
    definition: {
      id: 'wf',
      version: '2.0',
      meta: { title: 't', taskType: 'software', userInput: 'u', createdAt: new Date().toISOString() },
      stages,
    },
    stageRuntimes: stages.map((s) => ({
      stageId: s.id,
      status: 'pending',
      outputs: {},
      retryCount: 0,
    })),
    currentStageIndex,
  } satisfies WorkflowInstance;
}

const FIX_TRIGGER: RuntimeReplanTrigger = {
  kind: 'fix-exhausted',
  testRunStageId: 'stage_test_run_indicators',
  sliceSemantic: 'indicators',
  message: 'pytest failed',
};

test('applyRuntimeReplan 原地突变：外部 stages/runtimes 引用可见插入结果', () => {
  const instance = makeInstance(
    ['stage_test_write_indicators', 'stage_test_run_indicators', 'stage_fix_if_failed_indicators'],
    2,
  );
  // 模拟执行循环在循环外缓存的解构引用（Run #23 实际场景）
  const cachedStages = instance.definition.stages;
  const cachedRuntimes = instance.stageRuntimes;

  const action = {
    kind: 'insert-after' as const,
    anchorStageId: 'stage_fix_if_failed_indicators',
    stage: makeStage('stage_runtime_replan_fix_indicators'),
    trigger: FIX_TRIGGER,
    reason: 'fix exhausted',
  };
  const applied = applyRuntimeReplan(instance, action);
  assert.ok(applied.ok);

  // 同一对象（不替换引用）
  assert.equal(applied.instance, instance);
  // 缓存引用立即可见插入的 stage 与对齐的 runtime
  assert.equal(cachedStages.length, 4);
  assert.equal(cachedStages[3]!.id, 'stage_runtime_replan_fix_indicators');
  assert.equal(cachedRuntimes.length, 4);
  assert.equal(cachedRuntimes[3]!.stageId, 'stage_runtime_replan_fix_indicators');
  assert.equal(cachedRuntimes[3]!.status, 'pending');
  // 游标跳到插入的 replan stage
  assert.equal(instance.currentStageIndex, 3);
});

test('applyRuntimeReplan 重复插入 → already-inserted，不破坏现场', () => {
  const instance = makeInstance(
    ['stage_test_run_indicators', 'stage_fix_if_failed_indicators', 'stage_runtime_replan_fix_indicators'],
    1,
  );
  const applied = applyRuntimeReplan(instance, {
    kind: 'insert-after',
    anchorStageId: 'stage_fix_if_failed_indicators',
    stage: makeStage('stage_runtime_replan_fix_indicators'),
    trigger: FIX_TRIGGER,
    reason: 'dup',
  });
  assert.ok(!applied.ok);
  assert.equal(applied.reason, 'already-inserted');
  assert.equal(instance.definition.stages.length, 3);
  assert.equal(instance.currentStageIndex, 1);
});

test('fix-exhausted 升级链：impl replan → testfix → posttestfix impl', () => {
  const base = [
    'stage_test_write_indicators',
    'stage_impl_indicators',
    'stage_test_run_indicators',
    'stage_fix_if_failed_indicators',
  ];

  const first = planDeterministicReplan({
    trigger: FIX_TRIGGER,
    instance: makeInstance(base, 3),
    gateRepairWriteTarget: 'indicators/__init__.py',
  });
  assert.ok(first);
  assert.equal(first.stage.id, 'stage_runtime_replan_fix_indicators');

  const second = planDeterministicReplan({
    trigger: FIX_TRIGGER,
    instance: makeInstance([...base, 'stage_runtime_replan_fix_indicators'], 3),
    gateRepairWriteTarget: 'indicators/__init__.py',
  });
  assert.ok(second);
  assert.equal(second.stage.id, `${RUNTIME_REPLAN_TESTFIX_STAGE_ID_PREFIX}indicators`);
  assert.ok(isRuntimeReplanTestFixStageId(second.stage.id));
  const tc = second.stage.toolConfig;
  assert.ok(tc.type === 'llm-text');
  // 写目标 = 切片测试文件（test_write 缺省约定路径）
  assert.equal(tc.writeOutputToFile, 'tests/test_indicators.py');
  assert.match(tc.systemPrompt, /假红/);
  assert.match(tc.systemPrompt, /is np\.nan/);

  const third = planDeterministicReplan({
    trigger: FIX_TRIGGER,
    instance: makeInstance(
      [
        ...base,
        'stage_runtime_replan_fix_indicators',
        `${RUNTIME_REPLAN_TESTFIX_STAGE_ID_PREFIX}indicators`,
      ],
      3,
    ),
    gateRepairWriteTarget: 'indicators/__init__.py',
  });
  assert.ok(third);
  assert.equal(third.stage.id, `${RUNTIME_REPLAN_POSTTESTFIX_FIX_STAGE_ID_PREFIX}indicators`);
  const tc3 = third.stage.toolConfig;
  assert.ok(tc3.type === 'llm-text');
  assert.equal(tc3.writeOutputToFile, 'indicators/__init__.py');
  assert.match(tc3.systemPrompt, /testfix 已重写/);
});

test('resetFixChainLedger 在 replan 回绕前清零 fix 链计数', () => {
  const instance = makeInstance(['stage_test_run_indicators', 'stage_fix_if_failed_indicators'], 1);
  const testRt = instance.stageRuntimes.find((r) => r.stageId === 'stage_test_run_indicators')!;
  testRt.outputs[FIX_CHAIN_OUTPUT_KEY] = { attempts: 2 };
  resetFixChainLedger(instance, 'stage_test_run_indicators');
  assert.equal(readFixChainLedger(testRt.outputs).attempts, 0);
});

test('testfix replan for signals includes convergence boundary rules (Run #45)', () => {
  const base = [
    'stage_test_write_signals',
    'stage_impl_signals',
    'stage_test_run_signals',
    'stage_fix_if_failed_signals',
    'stage_runtime_replan_fix_signals',
  ];
  const signalsTrigger: RuntimeReplanTrigger = {
    kind: 'fix-exhausted',
    testRunStageId: 'stage_test_run_signals',
    sliceSemantic: 'signals',
    message: 'convergence boundary pytest failed',
  };
  const planned = planDeterministicReplan({
    trigger: signalsTrigger,
    instance: makeInstance(base, 3),
    gateRepairWriteTarget: 'signals/__init__.py',
  });
  assert.ok(planned);
  assert.equal(planned.stage.id, `${RUNTIME_REPLAN_TESTFIX_STAGE_ID_PREFIX}signals`);
  const tc = planned.stage.toolConfig;
  assert.ok(tc.type === 'llm-text');
  assert.match(tc.systemPrompt, /_set_ideal_short_df/);
  assert.match(tc.systemPrompt, /2\*MIN_TICK/);
});

test('testfix stage id 被回绕路由识别且 semantic 提取正确', () => {
  const testfixId = `${RUNTIME_REPLAN_TESTFIX_STAGE_ID_PREFIX}indicators`;
  assert.ok(isRuntimeReplanFixStageId(testfixId));
  assert.equal(semanticFromRuntimeReplanFixStageId(testfixId), 'indicators');
  assert.equal(
    semanticFromRuntimeReplanFixStageId('stage_runtime_replan_fix_signals'),
    'signals',
  );
  const postTestfixId = `${RUNTIME_REPLAN_POSTTESTFIX_FIX_STAGE_ID_PREFIX}signals`;
  assert.ok(isRuntimeReplanFixStageId(postTestfixId));
  assert.equal(semanticFromRuntimeReplanImplFixStageId(postTestfixId), 'signals');
});
