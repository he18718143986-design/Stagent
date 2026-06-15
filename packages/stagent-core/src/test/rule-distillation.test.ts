import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { FailureAnalysisReport } from '../FailurePatternAnalyzer';
import {
  distillCandidateRules,
  candidateRuleId,
} from '../rule-distillation/distillCandidateRules';
import {
  promoteCandidateRules,
  markCandidateRuleApproved,
} from '../rule-distillation/promoteCandidateRules';
import { evaluateCandidateRulesShadow } from '../rule-distillation/evaluateCandidateRulesShadow';
import {
  CandidateRuleStore,
  resolveCandidateRuleStorePath,
} from '../rule-distillation/CandidateRuleStore';
import type { CandidateRule } from '../rule-distillation/CandidateRuleTypes';

function sampleReport(): FailureAnalysisReport {
  return {
    totalExperiences: 12,
    failedCount: 6,
    topFailureStages: [{ stageId: 'stage_impl_x', count: 4 }],
    patterns: [
      {
        patternId: 'tool-execution-failed::stage_impl_x',
        frequency: 4,
        stageIdPattern: 'stage_impl_x',
        errorType: 'tool-execution-failed',
        commonContext: 'errorType=tool-execution-failed',
        kind: 'stage-impl-failure',
        recommendation: '检查 impl 输出是否空洞；启用 OutputQualityScorer 观测',
      },
      {
        patternId: 'code-runner-timeout::stage_test_run_y',
        frequency: 2,
        stageIdPattern: 'stage_test_run_y',
        errorType: 'code-runner-timeout',
        commonContext: 'errorType=code-runner-timeout',
        kind: 'code-runner-timeout-cluster',
        recommendation: '缩短 code-runner 命令或提高 timeout；考虑拆分验证阶段',
      },
      {
        patternId: 'llm-invalid-output::stage_impl_z',
        frequency: 1,
        stageIdPattern: 'stage_impl_z',
        errorType: 'llm-invalid-output',
        commonContext: 'errorType=llm-invalid-output',
        kind: 'stage-impl-failure',
        recommendation: '检查 impl 输出是否空洞；启用 OutputQualityScorer 观测',
      },
    ],
  };
}

const FIXED_NOW = () => '2026-06-15T00:00:00.000Z';

test('distill: only generates rules for frequency >= minFrequency', () => {
  const rules = distillCandidateRules(sampleReport(), [], { now: FIXED_NOW });
  // 两个 freq>=2 的 pattern → 两条规则；freq=1 的不生成
  assert.equal(rules.length, 2);

  const ids = rules.map((r) => r.id).sort();
  assert.deepEqual(ids, [
    candidateRuleId('code-runner-timeout::stage_test_run_y'),
    candidateRuleId('tool-execution-failed::stage_impl_x'),
  ]);

  const top = rules[0];
  assert.equal(top.id, candidateRuleId('tool-execution-failed::stage_impl_x'));
  assert.equal(top.status, 'needs_review');
  assert.equal(top.hits, 4);
  assert.equal(top.serves, 0);
  assert.equal(top.acceptanceRate, 0);
  assert.equal(top.kind, 'stage-impl-failure');
  assert.equal(top.message, '检查 impl 输出是否空洞；启用 OutputQualityScorer 观测');
  assert.deepEqual(top.sourcePatternIds, ['tool-execution-failed::stage_impl_x']);
  assert.equal(top.createdAt, '2026-06-15T00:00:00.000Z');
  assert.equal(top.updatedAt, '2026-06-15T00:00:00.000Z');

  // freq=1 的 pattern 没有对应规则
  assert.ok(!rules.some((r) => r.patternId === 'llm-invalid-output::stage_impl_z'));
});

test('distill: id is sanitized and stable', () => {
  assert.equal(
    candidateRuleId('tool-execution-failed::stage_impl_x'),
    'cr_tool_execution_failed__stage_impl_x',
  );
});

test('distill: merge preserves status/acceptance/serves, updates hits + sourcePatternIds', () => {
  const id = candidateRuleId('tool-execution-failed::stage_impl_x');
  const existing: CandidateRule[] = [
    {
      id,
      kind: 'stage-impl-failure',
      patternId: 'tool-execution-failed::stage_impl_x',
      message: '原始人工编辑过的规则文本',
      sourcePatternIds: ['tool-execution-failed::stage_impl_x'],
      serves: 10,
      hits: 2,
      acceptanceRate: 0.9,
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  const merged = distillCandidateRules(sampleReport(), existing, { now: FIXED_NOW });
  const found = merged.find((r) => r.id === id);
  assert.ok(found);
  // 保留
  assert.equal(found.status, 'active');
  assert.equal(found.acceptanceRate, 0.9);
  assert.equal(found.serves, 10);
  assert.equal(found.createdAt, '2026-01-01T00:00:00.000Z');
  assert.equal(found.message, '原始人工编辑过的规则文本');
  // 更新
  assert.equal(found.hits, 4);
  assert.equal(found.updatedAt, '2026-06-15T00:00:00.000Z');
  // 同 patternId 不重复
  assert.deepEqual(found.sourcePatternIds, ['tool-execution-failed::stage_impl_x']);
});

test('promote: needs_review -> active when serves and acceptance suffice', () => {
  const rules: CandidateRule[] = [
    baseRule({ id: 'cr_a', serves: 5, acceptanceRate: 0.8, status: 'needs_review' }),
  ];
  const out = promoteCandidateRules(
    rules,
    { minServes: 3, minAcceptanceRate: 0.6 },
    FIXED_NOW,
  );
  assert.equal(out[0].status, 'active');
  assert.equal(out[0].updatedAt, '2026-06-15T00:00:00.000Z');
});

test('promote: -> blocked when acceptance below blockMax (noise)', () => {
  const rules: CandidateRule[] = [
    baseRule({ id: 'cr_b', serves: 5, acceptanceRate: 0.1, status: 'needs_review' }),
    baseRule({ id: 'cr_c', serves: 5, acceptanceRate: 0.2, status: 'active' }),
  ];
  const out = promoteCandidateRules(
    rules,
    { minServes: 3, minAcceptanceRate: 0.6, blockMaxAcceptanceRate: 0.3 },
    FIXED_NOW,
  );
  assert.equal(out[0].status, 'blocked');
  assert.equal(out[1].status, 'blocked');
});

test('promote: insufficient serves stays needs_review', () => {
  const rules: CandidateRule[] = [
    baseRule({ id: 'cr_d', serves: 1, acceptanceRate: 0.95, status: 'needs_review' }),
  ];
  const out = promoteCandidateRules(rules, { minServes: 3, minAcceptanceRate: 0.6 });
  assert.equal(out[0].status, 'needs_review');
  // 未变更项不更新 updatedAt
  assert.equal(out[0].updatedAt, rules[0].updatedAt);
});

test('markCandidateRuleApproved sets target rule to active', () => {
  const rules: CandidateRule[] = [
    baseRule({ id: 'cr_e', status: 'needs_review' }),
    baseRule({ id: 'cr_f', status: 'needs_review' }),
  ];
  const out = markCandidateRuleApproved(rules, 'cr_f', FIXED_NOW);
  assert.equal(out.find((r) => r.id === 'cr_e')?.status, 'needs_review');
  const f = out.find((r) => r.id === 'cr_f');
  assert.equal(f?.status, 'active');
  assert.equal(f?.updatedAt, '2026-06-15T00:00:00.000Z');
});

test('shadow: only active rules produce warnings, never throws', () => {
  const rules: CandidateRule[] = [
    baseRule({ id: 'cr_active', status: 'active', kind: 'stage-impl-failure', message: 'msg-a' }),
    baseRule({ id: 'cr_review', status: 'needs_review', message: 'msg-r' }),
    baseRule({ id: 'cr_blocked', status: 'blocked', message: 'msg-b' }),
  ];
  const warnings = evaluateCandidateRulesShadow(rules, { text: 'anything' });
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].ruleId, 'cr_active');
  assert.equal(warnings[0].kind, 'stage-impl-failure');
  assert.equal(warnings[0].message, 'msg-a');
});

test('shadow: returns array and never throws even for "should-block" cases', () => {
  // 即便规则携带恶意/非法 matcher、状态混乱，也只返回数组、绝不 throw / 阻断。
  const rules = [
    { ...baseRule({ id: 'cr_bad_regex', status: 'active' }), matcher: '([' },
    { ...baseRule({ id: 'cr_active2', status: 'active' }), matcher: '.*' },
    null as unknown as CandidateRule,
  ];
  let result: ReturnType<typeof evaluateCandidateRulesShadow> | undefined;
  assert.doesNotThrow(() => {
    result = evaluateCandidateRulesShadow(rules as CandidateRule[], { text: 'block this please' });
  });
  assert.ok(Array.isArray(result));
  // 非法 regex 被吞掉(不匹配)，'.*' 命中
  assert.deepEqual(result!.map((w) => w.ruleId), ['cr_active2']);

  // 入参非数组也不抛
  assert.doesNotThrow(() => {
    evaluateCandidateRulesShadow(undefined as unknown as CandidateRule[], {});
  });
});

test('store: writeAll -> readAll round-trips', () => {
  const storePath = tempStorePath();
  const store = new CandidateRuleStore(storePath);
  const rules: CandidateRule[] = [
    baseRule({ id: 'cr_1', hits: 3 }),
    baseRule({ id: 'cr_2', hits: 1, status: 'active' }),
  ];
  store.writeAll(rules);
  const read = store.readAll();
  assert.equal(read.length, 2);
  assert.deepEqual(read, rules);
});

test('store: skips corrupted lines on read', () => {
  const storePath = tempStorePath();
  const good = baseRule({ id: 'cr_ok' });
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(
    storePath,
    `${JSON.stringify(good)}\n{ not valid json \n\n`,
    'utf-8',
  );
  const read = new CandidateRuleStore(storePath).readAll();
  assert.equal(read.length, 1);
  assert.equal(read[0].id, 'cr_ok');
});

test('store: upsert merges by id', () => {
  const storePath = tempStorePath();
  const store = new CandidateRuleStore(storePath);
  store.writeAll([baseRule({ id: 'cr_x', hits: 1 }), baseRule({ id: 'cr_y', hits: 2 })]);
  const merged = store.upsert([
    baseRule({ id: 'cr_x', hits: 9, status: 'active' }),
    baseRule({ id: 'cr_z', hits: 3 }),
  ]);
  const byId = new Map(merged.map((r) => [r.id, r]));
  assert.equal(byId.size, 3);
  assert.equal(byId.get('cr_x')?.hits, 9);
  assert.equal(byId.get('cr_x')?.status, 'active');
  assert.equal(byId.get('cr_z')?.hits, 3);
  // 持久化也一致
  assert.equal(store.readAll().length, 3);
});

test('resolveCandidateRuleStorePath under workspace .stagent', () => {
  assert.equal(
    resolveCandidateRuleStorePath('/proj/task'),
    path.join('/proj/task', '.stagent', 'candidate-rules.jsonl'),
  );
});

function baseRule(overrides: Partial<CandidateRule>): CandidateRule {
  return {
    id: 'cr_default',
    kind: 'stage-impl-failure',
    patternId: 'p',
    message: 'm',
    sourcePatternIds: ['p'],
    serves: 0,
    hits: 1,
    acceptanceRate: 0,
    status: 'needs_review',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function tempStorePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-cr-'));
  return path.join(dir, 'candidate-rules.jsonl');
}
