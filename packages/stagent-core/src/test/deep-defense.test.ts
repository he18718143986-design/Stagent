import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { Stage } from '../WorkflowDefinition';
import { isPlainApproveAllowedForStage } from '../QuestionAfterFlow';
import { ensureDecisionPromptStrict } from '../WorkflowPrompts';

// 用两个**内部常量中独特出现**的短语作为存在性 / 计数锚点，避免依赖未导出的常量
const SUFFIX_MARKER = '【输出硬约束（必须满足）】';
const SPEC75_MARKER = '决策质量自检（在输出决策清单之前必须完成以下三项检查）';

// ─── I-20: isPlainApproveAllowedForStage（M14.2 深度防御）─────────────

test('I-20 T1: 决策阶段（isDecisionStage=true）→ 普通 approve 不允许', () => {
  const stage: Pick<Stage, 'isDecisionStage'> = { isDecisionStage: true };
  assert.equal(isPlainApproveAllowedForStage(stage), false);
});

test('I-20 T2: 非决策阶段（isDecisionStage=false）→ 普通 approve 允许', () => {
  const stage: Pick<Stage, 'isDecisionStage'> = { isDecisionStage: false };
  assert.equal(isPlainApproveAllowedForStage(stage), true);
});

test('I-20 T3: isDecisionStage=undefined（默认值）→ 普通 approve 允许', () => {
  const stage: Pick<Stage, 'isDecisionStage'> = {};
  assert.equal(isPlainApproveAllowedForStage(stage), true);
});

// ─── I-21: normalizeWorkflow 入场前提是 ensureDecisionPromptStrict 幂等 ───
// （normalizeWorkflow 在 startExecution 会被调用，可能针对已收紧过的 prompt 再跑一次）

test('I-21 T1: ensureDecisionPromptStrict 对裸 prompt 注入 §7.5 + DecisionRecord 后缀', () => {
  const result = ensureDecisionPromptStrict('你是资深工程师，请审慎决策。');
  assert.ok(result.includes(SUFFIX_MARKER), 'should contain DECISION_RECORD_STRICT_SUFFIX 标志');
  assert.ok(result.includes(SPEC75_MARKER), 'should contain SPEC §7.5 标志');
});

test('I-21 T2: ensureDecisionPromptStrict 是幂等的（连续两次调用结果相同）', () => {
  const base = '你是资深工程师，请审慎决策。';
  const once = ensureDecisionPromptStrict(base);
  const twice = ensureDecisionPromptStrict(once);
  assert.equal(once, twice, 'ensureDecisionPromptStrict 必须幂等：normalizeWorkflow 重复跑不应堆叠 §7.5/SUFFIX');
});

test('I-21 T3: ensureDecisionPromptStrict 多次调用不会出现重复后缀', () => {
  const base = '你是资深工程师，请审慎决策。';
  let prompt = base;
  for (let i = 0; i < 5; i++) {
    prompt = ensureDecisionPromptStrict(prompt);
  }
  const suffixCount = prompt.split(SUFFIX_MARKER).length - 1;
  const specCount = prompt.split(SPEC75_MARKER).length - 1;
  assert.equal(suffixCount, 1, `SUFFIX 应只出现 1 次，实际 ${suffixCount} 次`);
  assert.equal(specCount, 1, `SPEC §7.5 标志应只出现 1 次，实际 ${specCount} 次`);
});

test('I-21 T4: 旧版 prompt（已含 DecisionRecord 引导文案）通过后不重复添加引导', () => {
  const base = '### 职责边界\n（旧引导）';
  const result = ensureDecisionPromptStrict(base);
  // 不应出现 "请先完成"DecisionRecord"…" 这种新引导
  assert.equal(result.includes('请先完成'), false);
});
