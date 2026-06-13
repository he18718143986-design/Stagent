import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { Stage, StageRuntime } from '../WorkflowDefinition';
import type { ExecuteNextStageLoopParams } from '../WorkflowExecutorTypes';
import { handleQuestionBeforeGate } from '../WorkflowStageQuestionGate';

function makeStage(id: string, questions: Stage['questionBefore']): Stage {
  return {
    id,
    title: id,
    tool: 'llm-text',
    toolConfig: { type: 'llm-text', systemPrompt: 'x' },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'out', format: 'text' }],
    pauseAfter: false,
    questionBefore: questions,
  };
}

test('handleQuestionBeforeGate halts batch mode when required answers missing', async () => {
  const stage = makeStage('stage_q', [{ id: 'q1', text: 'Q?', required: true }]);
  const runtime: StageRuntime = { stageId: stage.id, status: 'pending', outputs: {}, retryCount: 0 };
  const messages: unknown[] = [];
  const params = {
    isAdaptiveGrillForStage: () => false,
    debugLog: () => {},
  } as unknown as ExecuteNextStageLoopParams;

  const outcome = await handleQuestionBeforeGate(
    params,
    stage,
    runtime,
    {},
    (_panel, msg) => {
      messages.push(msg);
    },
    () => {},
  );

  assert.equal(outcome, 'halt');
  assert.equal(runtime.status, 'waiting-questions');
  assert.ok(messages.some((m) => (m as { type?: string }).type === 'stageQuestionsBefore'));
});

test('handleQuestionBeforeGate passes through when all required answers present', async () => {
  const stage = makeStage('stage_q', [{ id: 'q1', text: 'Q?', required: true }]);
  const runtime: StageRuntime = {
    stageId: stage.id,
    status: 'pending',
    outputs: {},
    retryCount: 0,
    questionBeforeAnswers: { q1: 'answered' },
  };
  const params = {
    isAdaptiveGrillForStage: () => false,
    debugLog: () => {},
  } as unknown as ExecuteNextStageLoopParams;

  const outcome = await handleQuestionBeforeGate(params, stage, runtime, {}, () => {}, () => {});

  assert.equal(outcome, null);
  assert.equal(runtime.status, 'pending');
});
