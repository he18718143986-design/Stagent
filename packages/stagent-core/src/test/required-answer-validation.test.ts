import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { Question, StageRuntime, Stage } from '../WorkflowDefinition';
import { validateRequiredAnswers } from '../QuestionAfterFlow';
import { markDecisionApproved } from '../WorkflowStateTransitions';

// ─── I-8: validateRequiredAnswers 纯函数 ─────────────────────────

test('I-8 T1: 全部必答已填 → ok=true', () => {
  const questions: Question[] = [
    { id: 'q1', text: '问题 1', required: true },
    { id: 'q2', text: '问题 2', required: true },
  ];
  const result = validateRequiredAnswers(questions, { q1: '答案 1', q2: '答案 2' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.missingIds, []);
});

test('I-8 T2: 必答留空字符串 → missingIds 含该 id', () => {
  const questions: Question[] = [{ id: 'q1', text: '问题 1', required: true }];
  const result = validateRequiredAnswers(questions, { q1: '' });
  assert.equal(result.ok, false);
  assert.deepEqual(result.missingIds, ['q1']);
});

test('I-8 T3: 必答 answers 对象里没该 key → missingIds', () => {
  const questions: Question[] = [{ id: 'q1', text: '问题 1', required: true }];
  const result = validateRequiredAnswers(questions, {});
  assert.equal(result.ok, false);
  assert.deepEqual(result.missingIds, ['q1']);
});

test('I-8 T4: 非必答（required=false）留空 → 不计入', () => {
  const questions: Question[] = [{ id: 'q1', text: '可选问题', required: false }];
  const result = validateRequiredAnswers(questions, { q1: '' });
  assert.equal(result.ok, true);
});

test('I-8 T5: required=undefined 视为必答（默认 true 语义）', () => {
  const questions: Question[] = [{ id: 'q1', text: '问题 1' }];
  const result = validateRequiredAnswers(questions, { q1: '' });
  assert.equal(result.ok, false);
  assert.deepEqual(result.missingIds, ['q1']);
});

test('I-8 T6: 必答 + 非必答混合 → 只返回必答缺失', () => {
  const questions: Question[] = [
    { id: 'q1', text: '必', required: true },
    { id: 'q2', text: '选', required: false },
    { id: 'q3', text: '默认必', /* required undefined */ },
  ];
  const result = validateRequiredAnswers(questions, { q1: '', q2: '', q3: '已答' });
  assert.equal(result.ok, false);
  assert.deepEqual(result.missingIds, ['q1']);
});

test('I-8 T7: 必答只填空白字符（空格 / Tab）→ missingIds', () => {
  const questions: Question[] = [
    { id: 'q1', text: '问', required: true },
    { id: 'q2', text: '问', required: true },
  ];
  const result = validateRequiredAnswers(questions, { q1: '   ', q2: '\t\t' });
  assert.equal(result.ok, false);
  assert.deepEqual(result.missingIds, ['q1', 'q2']);
});

test('I-8 T8: questions undefined / 空数组 → ok=true', () => {
  assert.equal(validateRequiredAnswers(undefined, {}).ok, true);
  assert.equal(validateRequiredAnswers([], {}).ok, true);
});

test('I-8 T9: answers undefined → 必答全 missing', () => {
  const questions: Question[] = [{ id: 'q1', text: '问', required: true }];
  const result = validateRequiredAnswers(questions, undefined);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missingIds, ['q1']);
});

// ─── I-7: markDecisionApproved 写入存在性（M14.1 post-condition 锚点）───────

test('I-7 T1: markDecisionApproved 后 runtime.outputs.decisionRecord 必存在', () => {
  const stage: Stage = {
    id: 'stage_decide_x',
    title: 'decide x',
    tool: 'llm-text',
    toolConfig: { type: 'llm-text', systemPrompt: '...' },
    input: { sources: [{ type: 'user-input', label: '需求' }], mergeStrategy: 'concat' },
    outputs: [{ key: 'decisionRecord', format: 'markdown' }],
    isDecisionStage: true,
    pauseAfter: true,
  };
  const rt: StageRuntime = {
    stageId: 'stage_decide_x',
    status: 'paused',
    outputs: {},
    retryCount: 0,
  };
  markDecisionApproved(stage, rt, '## 决策清单：X\n### 职责边界\n- A', '原始输出', '2026-05-12T00:00:00Z');
  const decisionRecord = rt.outputs.decisionRecord as string | undefined;
  assert.equal(typeof decisionRecord, 'string');
  assert.ok(decisionRecord && decisionRecord.length > 0);
  assert.equal(rt.approvedDecisionRecord, decisionRecord);
  assert.equal(rt.status, 'done');
});

test('I-7 T2: 用户提交空字符串时回落到 primaryOutputValue（不会出现 outputs.decisionRecord 为空字符串）', () => {
  const stage: Stage = {
    id: 'stage_decide_x',
    title: 'decide x',
    tool: 'llm-text',
    toolConfig: { type: 'llm-text', systemPrompt: '...' },
    input: { sources: [{ type: 'user-input', label: '需求' }], mergeStrategy: 'concat' },
    outputs: [{ key: 'decisionRecord', format: 'markdown' }],
    isDecisionStage: true,
    pauseAfter: true,
  };
  const rt: StageRuntime = {
    stageId: 'stage_decide_x',
    status: 'paused',
    outputs: {},
    retryCount: 0,
  };
  markDecisionApproved(stage, rt, '   ', 'AI 原始决策清单正文', '2026-05-12T00:00:00Z');
  const record = String(rt.outputs.decisionRecord);
  assert.match(record, /AI 原始决策清单正文/);
  assert.match(record, /### 决策溯源/);
  assert.match(record, /provenance: human/);
});
