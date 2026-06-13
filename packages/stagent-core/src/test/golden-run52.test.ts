/**
 * Golden 离线回归：T4 Live Run #52（instance 3ca5c7d3）落盘产物固化进仓库。
 * Run #52 是 sanitize/contract 修复链合入后的真实 run：全切片 test_run 一次绿，
 * 到 smoke_run 才因 LLM 402 中断。固化三类断言（零 API 消耗）：
 * 1. 真实 plan 是 plan-completeness 正样本（Run #48 类 generate 失败不再发生）；
 * 2. decide_signals 真实产物缺 behaviorSpec（当时仅 warning）→ P2 decide 硬拒能堵住该洞；
 * 3. 真实 test_signals 代码对照 behaviorSpec lint：函数覆盖通过、条件 id 未引用可检出。
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { WorkflowDefinition } from '../WorkflowDefinition';
import { hasSemanticFillPlanIssues } from '../plan-skeleton/sanitizeSemanticFillPrompts';
import { lintMultiFilePromptMismatch } from '../plan-completeness/multiFileImplChecks';
import { lintTestWriteImportPathsInPlan } from '../plan-completeness/testWriteImportChecks';
import { evaluateApproveBehaviorSpecOrReject } from '../hitl/DecisionLintGate';
import { DECISION_ARTIFACTS_OUTPUT_KEY } from '../WorkflowOutputKeys';
import {
  hardBehaviorSpecIssues,
  lintTestAgainstBehaviorSpec,
} from '../commitment/BehaviorSpecLint';
import type { BehaviorSpecV1 } from '../commitment/behaviorSpecSchema';

interface Run52Golden {
  definition: WorkflowDefinition;
  decideSignals: { decisionArtifacts: unknown; warnings: string[] };
  testWriteSignalsCode: string;
}

// 编译产物在 dist/test，fixture JSON 保持在 src/test/fixtures（不参与 tsc 编译）
const FIXTURE = path.resolve(__dirname, '../../src/test/fixtures/run52-golden.json');
const golden = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as Run52Golden;

test('run52 golden：真实 plan 无语义填充类 completeness 问题', () => {
  assert.equal(hasSemanticFillPlanIssues(golden.definition), false);
  for (const stage of golden.definition.stages ?? []) {
    assert.equal(lintMultiFilePromptMismatch(stage), null, stage.id);
  }
  const importIssues = lintTestWriteImportPathsInPlan(golden.definition).filter(
    (i) => i.type === 'test-write-import-not-in-plan',
  );
  assert.deepEqual(importIssues, []);
});

test('run52 golden：decide_signals 当时确实缺 behaviorSpec（仅 warning）', () => {
  assert.ok(golden.decideSignals.warnings.some((w) => w.includes('behaviorSpec')));
  const artifacts = golden.decideSignals.decisionArtifacts as { behaviorSpec?: unknown };
  assert.equal(artifacts.behaviorSpec, undefined);
});

test('run52 golden：P2 decide 硬拒堵住缺 behaviorSpec 的真实产物', () => {
  const errors: string[] = [];
  const host = {
    postMessage: (_p: unknown, msg: { error?: string }) => {
      if (typeof msg?.error === 'string') {
        errors.push(msg.error);
      }
    },
    getInstance: () => undefined,
    logUserAction: () => {},
  } as never;
  const ok = evaluateApproveBehaviorSpecOrReject(
    host,
    {} as never,
    'stage_decide_signals',
    { [DECISION_ARTIFACTS_OUTPUT_KEY]: golden.decideSignals.decisionArtifacts },
    DECISION_ARTIFACTS_OUTPUT_KEY,
    'hard',
  );
  assert.equal(ok, false);
  assert.match(errors.join(' '), /behaviorSpec/);
});

const RUN52_SIGNALS_SPEC: BehaviorSpecV1 = {
  module: 'signals',
  functions: [
    {
      name: 'generate_long_signal',
      returns: 'bool',
      when_non_null: 'all',
      conditions: [
        { id: 'ma_convergence', desc: 'MA5..MA9 并拢（spread < 阈值，严格小于）' },
        { id: 'cci_cross_up', desc: 'CCI 上穿 +100' },
        { id: 'volume_active', desc: '成交量 > volume_ma3' },
      ],
    },
    {
      name: 'generate_short_signal',
      returns: 'bool',
      when_non_null: 'all',
      conditions: [
        { id: 'ma_divergence_down', desc: 'MA 空头排列' },
        { id: 'cci_cross_down', desc: 'CCI 下穿 -100' },
      ],
    },
  ],
  edge_rules: ['阈值比较默认严格小于；index_sh/index_sz 仅为内部数据，不是模块导出。'],
};

test('run52 golden：真实 test_signals 代码函数覆盖通过、条件 id 未引用可检出', () => {
  const issues = lintTestAgainstBehaviorSpec(golden.testWriteSignalsCode, RUN52_SIGNALS_SPEC);
  // 两个信号函数都在真实测试中被调用 → 无函数覆盖问题
  assert.equal(issues.filter((i) => i.code === 'behavior-spec-function-uncovered').length, 0);
  // 当时无 behaviorSpec，测试自然未引用任何条件 id → hard 检出（P2 gate 会给同 stage 重写反馈）
  const hard = hardBehaviorSpecIssues(issues);
  assert.ok(hard.some((i) => i.code === 'behavior-spec-condition-uncovered'));
});
