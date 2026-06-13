import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { Stage, StageRuntime, WorkflowDefinition, WorkflowInstance } from '../WorkflowDefinition';
import {
  applyQuestionBeforeAnswers,
  applyRetryBase,
  applyRetryForDecisionCurrent,
  applyRetryForNonDecision,
  collectDecisionRetryResets,
  markApproved,
  markDecisionApproved,
} from '../WorkflowStateTransitions';

function makeStage(partial: Partial<Stage> & Pick<Stage, 'id' | 'title'>): Stage {
  const { id, title, ...rest } = partial;
  return {
    id,
    title,
    tool: 'llm-text',
    toolConfig: { type: 'llm-text', systemPrompt: 'x' },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'out', format: 'text' }],
    pauseAfter: false,
    ...rest,
  };
}

test('markApproved sets done/completedAt', () => {
  const rt: StageRuntime = { stageId: 's1', status: 'paused', outputs: {}, retryCount: 0 };
  markApproved(rt, '2026-05-08T00:00:00.000Z');
  assert.equal(rt.status, 'done');
  assert.equal(rt.completedAt, '2026-05-08T00:00:00.000Z');
});

test('markDecisionApproved writes decision record', () => {
  const stage = makeStage({ id: 'stage_decide_x', title: 'x' });
  const rt: StageRuntime = { stageId: stage.id, status: 'paused', outputs: {}, retryCount: 0 };
  const record = markDecisionApproved(stage, rt, '', 'fallback', '2026-05-08T00:00:00.000Z');
  assert.match(record, /fallback/);
  assert.match(record, /### 决策溯源/);
  assert.match(record, /provenance: human/);
  assert.equal(rt.outputs.decisionRecord, record);
  assert.equal(rt.approvedDecisionRecord, record);
});

test('markDecisionApproved dual-writes charter provenance into decision record', () => {
  const stage = makeStage({ id: 'stage_decide_x', title: 'x' });
  const rt: StageRuntime = {
    stageId: stage.id,
    status: 'paused',
    outputs: {},
    retryCount: 0,
    decisionProvenance: 'charter_inferred',
    charterQuestionProvenance: { q_arch: 'charter_direct' },
  };
  const record = markDecisionApproved(
    stage,
    rt,
    '### 职责边界\n- scope',
    '',
    '2026-05-08T00:00:00.000Z',
  );
  assert.match(record, /### 职责边界/);
  assert.match(record, /provenance: charter_inferred/);
  assert.match(record, /q_arch: charter_direct/);
});

test('retry helpers keep current semantics', () => {
  const rt: StageRuntime = {
    stageId: 'stage_impl_x',
    status: 'done',
    outputs: { text: 'x', _exitCode: 1 },
    retryCount: 0,
  };
  applyRetryBase(rt, 'retry');
  applyRetryForNonDecision(rt);
  assert.equal(rt.retryCount, 1);
  assert.equal(rt.status, 'pending');
  assert.deepEqual(rt.outputs, {});
});

test('collectDecisionRetryResets resets dependent downstream stages', () => {
  const definition: WorkflowDefinition = {
    id: 'wf',
    version: '2.0',
    meta: { title: 't', taskType: 'software', userInput: 'u', createdAt: new Date().toISOString() },
    stages: [
      makeStage({ id: 'stage_decide_a', title: 'd', input: { sources: [], mergeStrategy: 'concat' } }),
      makeStage({
        id: 'stage_impl_a',
        title: 'i',
        input: { sources: [{ type: 'stage-output', stageId: 'stage_decide_a', outputKey: 'decisionRecord' }], mergeStrategy: 'concat' },
      }),
    ],
  };
  const instance: WorkflowInstance = {
    definition,
    currentStageIndex: 0,
    status: 'running',
    stageRuntimes: [
      { stageId: 'stage_decide_a', status: 'done', outputs: {}, retryCount: 0 },
      { stageId: 'stage_impl_a', status: 'done', outputs: { code: 'x' }, retryCount: 0, startedAt: 'x', completedAt: 'y' },
    ],
  };
  const out = collectDecisionRetryResets(definition, instance, 'stage_decide_a', 0);
  assert.deepEqual(out.resetStageIds, ['stage_impl_a']);
  assert.equal(instance.stageRuntimes[1].status, 'pending');
  assert.deepEqual(instance.stageRuntimes[1].outputs, {});
});

test('collectDecisionRetryResets (DAG) resets transitive consumers via dependsOn', () => {
  const definition: WorkflowDefinition = {
    id: 'wf',
    version: '2.0',
    meta: { title: 't', taskType: 'software', userInput: 'u', createdAt: new Date().toISOString() },
    globalConfig: { enableDagScheduler: true },
    stages: [
      makeStage({ id: 'stage_decide_a', title: 'd', input: { sources: [], mergeStrategy: 'concat' } }),
      makeStage({
        id: 'stage_impl_a',
        title: 'i',
        dependsOn: ['stage_decide_a'],
        input: { sources: [{ type: 'user-input', label: 'u' }], mergeStrategy: 'concat' },
      }),
    ],
  };
  const instance: WorkflowInstance = {
    definition,
    currentStageIndex: 0,
    status: 'running',
    stageRuntimes: [
      { stageId: 'stage_decide_a', status: 'done', outputs: {}, retryCount: 0 },
      { stageId: 'stage_impl_a', status: 'done', outputs: { out: 'x' }, retryCount: 0 },
    ],
  };
  const out = collectDecisionRetryResets(definition, instance, 'stage_decide_a', 0);
  assert.deepEqual(out.resetStageIds, ['stage_impl_a']);
  assert.equal(instance.stageRuntimes[1].status, 'pending');
});

test('applyQuestionBeforeAnswers and decision retry current', () => {
  const rt: StageRuntime = {
    stageId: 'stage_decide_a',
    status: 'waiting-questions',
    outputs: { decisionRecord: 'x' },
    retryCount: 0,
    approvedDecisionRecord: 'x',
  };
  applyQuestionBeforeAnswers(rt, { q1: 'a' });
  assert.equal(rt.status, 'pending');
  assert.equal(rt.questionBeforeAnswers?.q1, 'a');

  applyRetryForDecisionCurrent(rt);
  assert.equal(rt.status, 'retrying');
  assert.equal(rt.approvedDecisionRecord, undefined);
  assert.equal(rt.outputs.decisionRecord, undefined);
});
