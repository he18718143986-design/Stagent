/**
 * P2（T4 Run #45/#50 根治续篇）：behaviorSpec 轻量 gate 三档语义 +
 * BehaviorSpecLint 覆盖检查 + decide 硬拒。仿 test-quality-gate.test.ts 夹具模式。
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { GateResult, QualityGateContext } from '../QualityGate';
import type { Stage, WorkflowInstance } from '../WorkflowDefinition';
import { BUILTIN_POST_STAGE_GATES } from '../quality-gates/postStageGates';
import { GATE_ID_BEHAVIOR_SPEC_TEST_WRITE } from '../QualityGateIds';
import {
  decideStageIdFromSemanticName,
  testWriteStageIdFromSemanticName,
} from '../workflow/StageIdPatterns';
import { DECISION_ARTIFACTS_OUTPUT_KEY } from '../WorkflowOutputKeys';
import {
  hardBehaviorSpecIssues,
  lintTestAgainstBehaviorSpec,
} from '../commitment/BehaviorSpecLint';
import { evaluateApproveBehaviorSpecOrReject } from '../hitl/DecisionLintGate';
import { synthesizeSliceDecisionArtifacts } from '../commitment/decisionRecordExports';
import type { BehaviorSpecV1 } from '../commitment/behaviorSpecSchema';

const SPEC: BehaviorSpecV1 = {
  module: 'signals',
  functions: [
    {
      name: 'generate_bear_signal',
      returns: 'Signal | None',
      when_non_null: 'all',
      conditions: [
        { id: 'ma_convergence', desc: 'MA5..MA9 spread < threshold' },
        { id: 'cci_cross_down', desc: 'CCI cross down band' },
      ],
    },
  ],
  edge_rules: ['_set_ideal_* fixture helper 必须先执行，再做边界列覆写。'],
};

const HEALTHY_TEST = `from signals import generate_bear_signal

def test_bear_all_conditions():
    # ma_convergence + cci_cross_down
    df = _set_ideal_bear_df()
    assert generate_bear_signal(df).kind == "bear"

def test_bear_boundary():
    # ma_convergence 边界：先理想态，再覆写边界列
    df = _set_ideal_bear_df()
    df["MA5"] = df["MA9"] + 2.0
    assert generate_bear_signal(df) is None  # cci_cross_down 仍满足
`;

const NO_CONDITION_IDS_TEST = `from signals import generate_bear_signal

def test_bear():
    df = _set_ideal_bear_df()
    assert generate_bear_signal(df) is not None
`;

const BAD_ORDER_TEST = `from signals import generate_bear_signal

def test_bear_boundary():
    # ma_convergence / cci_cross_down 边界
    df = make_df()
    df["MA5"] = df["MA9"] + 2.0
    df = _set_ideal_bear_df(df)
    assert generate_bear_signal(df) is None
`;

test('lint：健康测试（id 全覆盖 + 顺序正确）→ 无 issue', () => {
  assert.equal(lintTestAgainstBehaviorSpec(HEALTHY_TEST, SPEC).length, 0);
});

test('lint：条件 id 全部未引用 → hard issue', () => {
  const issues = lintTestAgainstBehaviorSpec(NO_CONDITION_IDS_TEST, SPEC);
  const hard = hardBehaviorSpecIssues(issues);
  assert.equal(hard.length, 1);
  assert.equal(hard[0].code, 'behavior-spec-condition-uncovered');
  assert.match(hard[0].message, /ma_convergence, cci_cross_down/);
});

test('lint：条件 id 部分缺失 → 仅 soft warn', () => {
  const body = `from signals import generate_bear_signal

def test_ma_convergence_only():
    df = _set_ideal_bear_df()
    assert generate_bear_signal(df).kind == "bear"
`;
  const issues = lintTestAgainstBehaviorSpec(body, SPEC);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].hard, false);
  assert.match(issues[0].message, /cci_cross_down/);
});

test('lint：单入口 export generate_signals 覆盖逻辑分组函数名（Run #54）', () => {
  const spec: BehaviorSpecV1 = {
    module: 'signals',
    functions: [
      {
        name: 'generate_bear_signal',
        returns: 'Signal | None',
        conditions: [{ id: 'ma_convergence', desc: 'spread' }],
      },
      {
        name: 'generate_bull_signal',
        returns: 'Signal | None',
        conditions: [{ id: 'ma_convergence', desc: 'spread' }],
      },
    ],
    edge_rules: [],
  };
  const body = `from signals import generate_signals

def test_bear_ma_convergence():
    assert generate_signals("bear", df) is not None

def test_bull_ma_convergence():
    assert generate_signals("bull", df) is not None
`;
  const issues = lintTestAgainstBehaviorSpec(body, spec, { contractExports: ['generate_signals'] });
  assert.equal(issues.filter((i) => i.code === 'behavior-spec-function-uncovered').length, 0);
});

test('lint：spec 函数未被调用 → hard issue', () => {
  const body = `# ma_convergence cci_cross_down
def test_nothing():
    assert 1 == 1
`;
  const issues = lintTestAgainstBehaviorSpec(body, SPEC);
  assert.ok(issues.some((i) => i.code === 'behavior-spec-function-uncovered' && i.hard));
});

test('lint：边界覆写先于 _set_ideal_* → hard issue（Run #45 假红形态）', () => {
  const issues = lintTestAgainstBehaviorSpec(BAD_ORDER_TEST, SPEC);
  const order = issues.filter((i) => i.code === 'behavior-spec-set-ideal-order');
  assert.equal(order.length, 1);
  assert.equal(order[0].hard, true);
});

test('lint：edge_rules 未声明 _set_ideal_ 纪律 → 不做顺序检查', () => {
  const spec = { ...SPEC, edge_rules: ['Threshold comparisons use strict <.'] };
  const issues = lintTestAgainstBehaviorSpec(BAD_ORDER_TEST, spec);
  assert.equal(issues.filter((i) => i.code === 'behavior-spec-set-ideal-order').length, 0);
});

// ---------- gate 三档 ----------

const gate = BUILTIN_POST_STAGE_GATES.find((g) => g.id === GATE_ID_BEHAVIOR_SPEC_TEST_WRITE)!;

function evalSync(ctx: QualityGateContext): GateResult | null {
  const raw = gate.evaluate!(ctx);
  if (raw instanceof Promise) {
    throw new Error('expected sync gate evaluate');
  }
  return raw;
}

function makeGateCtx(opts: {
  mode: 'off' | 'warn' | 'hard';
  testBody: string;
  withSpec?: boolean;
}): QualityGateContext {
  const semantic = 'signals';
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
  const decideRt = {
    stageId: decideStageIdFromSemanticName(semantic),
    status: 'done' as const,
    outputs:
      opts.withSpec === false
        ? {}
        : {
            [DECISION_ARTIFACTS_OUTPUT_KEY]: {
              version: 1,
              files: [],
              modules: [{ name: semantic, exports: ['generate_bear_signal'] }],
              behaviorSpec: SPEC,
            },
          },
    retryCount: 0,
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
      decideRt,
      { stageId: stage.id, status: 'running', outputs: {}, retryCount: 0 },
    ],
    currentStageIndex: 1,
  } satisfies WorkflowInstance;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'behavior-spec-gate-'));
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(dir, testPath), opts.testBody);
  return {
    phase: 'post-stage',
    stage,
    instance,
    taskWorkspaceAbs: dir,
    executionHost: {
      readBehaviorSpecLintMode: () => opts.mode,
      getWorkspaceRootAbsolute: () => dir,
    } as never,
  };
}

test('behavior-spec gate off → disabled', () => {
  const ctx = makeGateCtx({ mode: 'off', testBody: NO_CONDITION_IDS_TEST });
  assert.equal(gate.enabled?.(ctx), false);
});

test('behavior-spec gate：decide 无 behaviorSpec → 不评估（由 decide 硬拒兜底）', () => {
  const ctx = makeGateCtx({ mode: 'hard', testBody: NO_CONDITION_IDS_TEST, withSpec: false });
  assert.equal(evalSync(ctx), null);
});

test('behavior-spec gate hard → 条件 id 全缺阻断', () => {
  const ctx = makeGateCtx({ mode: 'hard', testBody: NO_CONDITION_IDS_TEST });
  const result = evalSync(ctx);
  assert.ok(result);
  assert.equal(result.severity, 'block');
  assert.match(result.messages.join(' '), /ma_convergence/);
});

test('behavior-spec gate warn → 同样问题降级为 warn', () => {
  const ctx = makeGateCtx({ mode: 'warn', testBody: NO_CONDITION_IDS_TEST });
  const result = evalSync(ctx);
  assert.ok(result);
  assert.equal(result.severity, 'warn');
});

test('behavior-spec gate hard → 部分 id 缺失仅 warn 不阻断', () => {
  const body = `from signals import generate_bear_signal

def test_ma_convergence():
    df = _set_ideal_bear_df()
    assert generate_bear_signal(df).kind == "bear"
`;
  const ctx = makeGateCtx({ mode: 'hard', testBody: body });
  const result = evalSync(ctx);
  assert.ok(result);
  assert.equal(result.severity, 'warn');
});

test('behavior-spec gate hard → 健康测试通过', () => {
  const ctx = makeGateCtx({ mode: 'hard', testBody: HEALTHY_TEST });
  assert.equal(evalSync(ctx), null);
});

test('非 test_write 阶段 → disabled', () => {
  const ctx = makeGateCtx({ mode: 'hard', testBody: NO_CONDITION_IDS_TEST });
  (ctx.stage as Stage).id = 'stage_impl_signals';
  assert.equal(gate.enabled?.(ctx), false);
});

// ---------- decide 硬拒 ----------

function makeHitlHost() {
  const errors: string[] = [];
  const host = {
    postMessage: (_p: unknown, msg: { type?: string; error?: string }) => {
      if (typeof msg?.error === 'string') {
        errors.push(msg.error);
      }
    },
    getInstance: () => undefined,
    logUserAction: () => {},
  } as never;
  return { host, errors };
}

test('decide 硬拒：hard + signals 缺 behaviorSpec → 拒绝批准', () => {
  const { host, errors } = makeHitlHost();
  const ok = evaluateApproveBehaviorSpecOrReject(
    host,
    {} as never,
    decideStageIdFromSemanticName('signals'),
    {},
    DECISION_ARTIFACTS_OUTPUT_KEY,
    'hard',
  );
  assert.equal(ok, false);
  assert.match(errors.join(' '), /behaviorSpec/);
});

test('decide 硬拒：hard + 健康 spec → 放行', () => {
  const { host } = makeHitlHost();
  const ok = evaluateApproveBehaviorSpecOrReject(
    host,
    {} as never,
    decideStageIdFromSemanticName('signals'),
    {
      [DECISION_ARTIFACTS_OUTPUT_KEY]: {
        version: 1,
        files: [],
        modules: [{ name: 'signals', exports: ['generate_bear_signal'] }],
        behaviorSpec: SPEC,
      },
    },
    DECISION_ARTIFACTS_OUTPUT_KEY,
    'hard',
  );
  assert.equal(ok, true);
});

test('decide 硬拒：warn 档 → 不拒绝', () => {
  const { host } = makeHitlHost();
  const ok = evaluateApproveBehaviorSpecOrReject(
    host,
    {} as never,
    decideStageIdFromSemanticName('signals'),
    {},
    DECISION_ARTIFACTS_OUTPUT_KEY,
    'warn',
  );
  assert.equal(ok, true);
});

test('decide 硬拒：非必填切片缺 spec → 放行', () => {
  const { host } = makeHitlHost();
  const ok = evaluateApproveBehaviorSpecOrReject(
    host,
    {} as never,
    decideStageIdFromSemanticName('indicators'),
    {},
    DECISION_ARTIFACTS_OUTPUT_KEY,
    'hard',
  );
  assert.equal(ok, true);
});

// ---------- synthesize 保留 behaviorSpec ----------

test('synthesizeSliceDecisionArtifacts 合成 exports 时保留 behaviorSpec', () => {
  const existing = {
    version: 1 as const,
    files: [],
    modules: [{ name: 'signals', exports: [] }],
    behaviorSpec: SPEC,
  };
  const record = ['### 模块导出', '- `generate_bear_signal(df)`：熊市信号'].join('\n');
  const out = synthesizeSliceDecisionArtifacts('signals', record, existing);
  assert.ok(out);
  assert.ok(out.modules?.some((m) => m.name === 'signals' && m.exports.includes('generate_bear_signal')));
  assert.equal(out.behaviorSpec, SPEC);
});
