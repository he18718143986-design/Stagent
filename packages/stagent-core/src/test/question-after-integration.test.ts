import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { BackendMessage, StageRuntime, WorkflowDefinition } from '../WorkflowDefinition';
import { applyQuestionAfterAnswers, shouldAutoAdvanceAfterAnswers } from '../QuestionAfterFlow';

function driveQuestionAfterAnswer(
  workflow: WorkflowDefinition,
  runtimes: StageRuntime[],
  currentStageIndex: number,
  stageId: string,
  answers: Record<string, string>,
): { advanced: boolean; nextStageIndex: number; messages: BackendMessage[] } {
  const idx = workflow.stages.findIndex((s) => s.id === stageId);
  if (idx < 0) {
    return { advanced: false, nextStageIndex: currentStageIndex, messages: [] };
  }
  const stage = workflow.stages[idx];
  const runtime = runtimes[idx];
  if (!shouldAutoAdvanceAfterAnswers(stage, runtime, currentStageIndex, idx)) {
    return { advanced: false, nextStageIndex: currentStageIndex, messages: [] };
  }
  applyQuestionAfterAnswers(runtime, answers, '2026-05-08T00:00:00.000Z');
  return {
    advanced: true,
    nextStageIndex: currentStageIndex + 1,
    messages: [{ type: 'stageStatusUpdate', stageId, status: 'done', isDecisionStage: stage.isDecisionStage }],
  };
}

test('questionAfter integration: answer triggers done message and index advance', () => {
  const workflow: WorkflowDefinition = {
    id: 'wf_question_after_it',
    version: '2.0',
    meta: { title: 'qa-it', taskType: 'software', userInput: 'demo', createdAt: new Date().toISOString() },
    stages: [
      {
        id: 'stage_impl_scan',
        title: 'impl scan',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'x' },
        input: { sources: [{ type: 'user-input', label: '需求' }], mergeStrategy: 'concat' },
        outputs: [{ key: 'code', format: 'text' }],
        pauseAfter: true,
        questionAfter: [{ id: 'q_case', text: '是否区分大小写？', hint: 'TODO only', required: true }],
      },
      {
        id: 'stage_test_scan',
        title: 'test scan',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'x' },
        input: { sources: [{ type: 'stage-output', stageId: 'stage_impl_scan', outputKey: 'code', label: 'code' }], mergeStrategy: 'concat' },
        outputs: [{ key: 'test', format: 'text' }],
        pauseAfter: false,
      },
    ],
  };
  const runtimes: StageRuntime[] = [
    { stageId: 'stage_impl_scan', status: 'paused', outputs: {}, retryCount: 0 },
    { stageId: 'stage_test_scan', status: 'pending', outputs: {}, retryCount: 0 },
  ];

  const result = driveQuestionAfterAnswer(workflow, runtimes, 0, 'stage_impl_scan', { q_case: '区分大小写' });
  assert.equal(result.advanced, true);
  assert.equal(result.nextStageIndex, 1);
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].type, 'stageStatusUpdate');
  assert.equal(result.messages[0].stageId, 'stage_impl_scan');
  assert.equal(result.messages[0].status, 'done');
  assert.equal(runtimes[0].questionAnswers?.q_case, '区分大小写');
  assert.equal(runtimes[0].status, 'done');
});

test('questionAfter integration: no advance when stage not paused', () => {
  const workflow: WorkflowDefinition = {
    id: 'wf_question_after_it_2',
    version: '2.0',
    meta: { title: 'qa-it-2', taskType: 'software', userInput: 'demo', createdAt: new Date().toISOString() },
    stages: [
      {
        id: 'stage_impl_scan',
        title: 'impl scan',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'x' },
        input: { sources: [{ type: 'user-input', label: '需求' }], mergeStrategy: 'concat' },
        outputs: [{ key: 'code', format: 'text' }],
        pauseAfter: true,
        questionAfter: [{ id: 'q_case', text: '是否区分大小写？', hint: 'TODO only', required: true }],
      },
    ],
  };
  const runtimes: StageRuntime[] = [{ stageId: 'stage_impl_scan', status: 'running', outputs: {}, retryCount: 0 }];

  const result = driveQuestionAfterAnswer(workflow, runtimes, 0, 'stage_impl_scan', { q_case: '区分大小写' });
  assert.equal(result.advanced, false);
  assert.equal(result.nextStageIndex, 0);
  assert.equal(result.messages.length, 0);
  assert.equal(runtimes[0].status, 'running');
});
