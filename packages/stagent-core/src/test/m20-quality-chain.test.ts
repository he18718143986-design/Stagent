import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { isDecisionContentLintEnabled } from '../DecisionContentLintPolicy';
import {
  formatRule20ViolationsBlockReason,
  shouldBlockGenerateOnRule20Violations,
} from '../GeneratedWorkflowGate';
import type { VerifyIssue, VerifyResult } from '../Rule20Verify';
import {
  buildPlanSummary,
  buildPlanReviewChecklistLines,
  buildStageSourceSummary,
  computePlanStageDiff,
  formatPlanStageDiffLines,
  formatPlanSummaryLines,
  shouldShowPlanReviewChecklist,
} from '../WorkflowPlanSummary';
import type { WorkflowDefinition } from '../WorkflowDefinition';

function issue(type: string, stageId: string): VerifyIssue {
  return { type: type as VerifyIssue['type'], stageId, message: 'm' };
}

test('shouldBlockGenerateOnRule20Violations: violations + runtime on → block', () => {
  const vr: VerifyResult = {
    passed: false,
    violations: [issue('missing-decision-stage', 'stage_impl_x')],
    warnings: [],
  };
  assert.equal(shouldBlockGenerateOnRule20Violations(vr, true), true);
  assert.equal(shouldBlockGenerateOnRule20Violations(vr, false), false);
  assert.equal(shouldBlockGenerateOnRule20Violations(undefined, true), false);
});

test('formatRule20ViolationsBlockReason includes violation token', () => {
  const reason = formatRule20ViolationsBlockReason([
    issue('missing-decision-stage', 'stage_impl_x'),
  ]);
  assert.match(reason, /generated_workflow_rule20_violations/);
  assert.match(reason, /rule20:missing-decision-stage:stage_impl_x/);
});

test('isDecisionContentLintEnabled: default on, explicit false off', () => {
  assert.equal(isDecisionContentLintEnabled(undefined, true), true);
  assert.equal(isDecisionContentLintEnabled(undefined, false), false);
  assert.equal(isDecisionContentLintEnabled({ enableDecisionContentLint: false }, true), false);
});

test('buildPlanSummary counts stages and flags missing global arch', () => {
  const wf = {
    id: 'wf',
    version: '2.0',
    meta: { title: 't', taskType: 'software', userInput: '完整项目多模块', createdAt: '' },
    stages: Array.from({ length: 7 }, (_, i) => ({
      id: `stage_impl_m${i}`,
      title: `impl ${i}`,
      tool: 'llm-text',
      toolConfig: { type: 'llm-text', systemPrompt: 'x' },
      input: { sources: [], mergeStrategy: 'concat' },
      outputs: [{ key: 'text', format: 'text' }],
    })),
  } as unknown as WorkflowDefinition;
  const summary = buildPlanSummary(wf, { warnings: ['rule20-soft:software-missing-global-architecture-decision:workflow'] });
  assert.equal(summary.implStageCount, 7);
  assert.equal(summary.missingGlobalArchDecision, true);
  assert.ok(formatPlanSummaryLines(summary).some((l) => l.includes('计划摘要')));
});

test('buildStageSourceSummary flags missing decisionRecord on impl', () => {
  const wf = {
    id: 'wf',
    version: '2.0',
    meta: { title: 't', taskType: 'software', userInput: 'x', createdAt: '' },
    stages: [
      {
        id: 'stage_impl_x',
        title: 'impl',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: '严格按照已确认的决策清单实现' },
        input: { sources: [{ type: 'user-input' }], mergeStrategy: 'concat' },
        outputs: [{ key: 'text', format: 'text' }],
      },
    ],
  } as unknown as WorkflowDefinition;
  const edges = buildStageSourceSummary(wf);
  assert.ok(edges.some((e) => e.rule20D_ok === false));
});

test('computePlanStageDiff and formatPlanStageDiffLines', () => {
  const diff = computePlanStageDiff(['a', 'b'], ['b', 'c']);
  assert.deepEqual(diff.added, ['c']);
  assert.deepEqual(diff.removed, ['a']);
  assert.deepEqual(formatPlanStageDiffLines(diff, false), []);
  const lines = formatPlanStageDiffLines(diff, true);
  assert.ok(lines.some((l) => l.includes('新增')));
  assert.ok(lines.some((l) => l.includes('移除')));
});

test('shouldShowPlanReviewChecklist on first decision with warnings', () => {
  const wf = {
    id: 'wf',
    version: '2.0',
    meta: { title: 't', taskType: 'software', userInput: 'x', createdAt: '' },
    stages: [
      {
        id: 'stage_decide_a',
        title: 'd',
        tool: 'llm-text',
        isDecisionStage: true,
        toolConfig: { type: 'llm-text', systemPrompt: 'd' },
        input: { sources: [], mergeStrategy: 'concat' },
        outputs: [{ key: 'decisionRecord', format: 'markdown' }],
      },
      {
        id: 'stage_impl_a',
        title: 'i',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'i' },
        input: { sources: [], mergeStrategy: 'concat' },
        outputs: [{ key: 'text', format: 'text' }],
      },
    ],
  } as unknown as WorkflowDefinition;
  assert.equal(
    shouldShowPlanReviewChecklist(wf, 'stage_decide_a', ['stage_count_near_limit'], undefined),
    true,
  );
  assert.equal(shouldShowPlanReviewChecklist(wf, 'stage_impl_a', [], undefined), false);
  const checklist = buildPlanReviewChecklistLines(wf, buildPlanSummary(wf), ['warn']);
  assert.ok(checklist.some((l) => l.includes('计划补审')));
});
