import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { BackendMessage, StageRuntime, WorkflowDefinition } from '../WorkflowDefinition';
import { shouldEnterWaitingQuestions, buildAnswerQuestionsBeforeMessage } from '../QuestionBeforeFlow';

function driveQuestionBeforeGate(
  workflow: WorkflowDefinition,
  runtime: StageRuntime,
): { blocked: boolean; messages: BackendMessage[] } {
  const stage = workflow.stages.find((s) => s.id === runtime.stageId);
  if (!stage) {
    return { blocked: false, messages: [] };
  }
  if (!shouldEnterWaitingQuestions(stage.questionBefore, runtime.questionBeforeAnswers)) {
    return { blocked: false, messages: [] };
  }
  runtime.status = 'waiting-questions';
  return {
    blocked: true,
    messages: [
      { type: 'stageStatusUpdate', stageId: stage.id, status: 'waiting-questions', isDecisionStage: stage.isDecisionStage },
      { type: 'stageQuestionsBefore', stageId: stage.id, questions: stage.questionBefore ?? [] },
    ],
  };
}

test('fixed-workflow integration: unanswered questionBefore blocks with expected messages', () => {
  const workflow: WorkflowDefinition = {
    id: 'wf_question_before_it',
    version: '2.0',
    meta: {
      title: 'questionBefore IT',
      taskType: 'software',
      userInput: 'demo',
      createdAt: new Date().toISOString(),
    },
    stages: [
      {
        id: 'stage_impl_sidebar',
        title: 'Implement Sidebar',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'output code' },
        input: { sources: [{ type: 'user-input', label: '需求' }], mergeStrategy: 'concat' },
        outputs: [{ key: 'code', format: 'text' }],
        pauseAfter: false,
        questionBefore: [{ id: 'q_timeout', text: '超时时间是多少？', hint: '30s', required: true }],
      },
    ],
  };
  const runtime: StageRuntime = {
    stageId: 'stage_impl_sidebar',
    status: 'pending',
    outputs: {},
    retryCount: 0,
  };

  const first = driveQuestionBeforeGate(workflow, runtime);
  assert.equal(first.blocked, true);
  assert.equal(runtime.status, 'waiting-questions');
  assert.equal(first.messages.length, 2);
  assert.equal(first.messages[0].type, 'stageStatusUpdate');
  assert.equal(first.messages[1].type, 'stageQuestionsBefore');
});

test('fixed-workflow integration: answerQuestionsBefore unblocks and can continue', () => {
  const workflow: WorkflowDefinition = {
    id: 'wf_question_before_it_2',
    version: '2.0',
    meta: {
      title: 'questionBefore IT 2',
      taskType: 'software',
      userInput: 'demo',
      createdAt: new Date().toISOString(),
    },
    stages: [
      {
        id: 'stage_impl_sidebar',
        title: 'Implement Sidebar',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'output code' },
        input: { sources: [{ type: 'user-input', label: '需求' }], mergeStrategy: 'concat' },
        outputs: [{ key: 'code', format: 'text' }],
        pauseAfter: false,
        questionBefore: [{ id: 'q_timeout', text: '超时时间是多少？', hint: '30s', required: true }],
      },
    ],
  };
  const runtime: StageRuntime = {
    stageId: 'stage_impl_sidebar',
    status: 'waiting-questions',
    outputs: {},
    retryCount: 0,
    questionBeforeAnswers: {},
  };

  const msg = buildAnswerQuestionsBeforeMessage('stage_impl_sidebar', { q_timeout: '45s' });
  runtime.questionBeforeAnswers = { ...runtime.questionBeforeAnswers, ...msg.answers };
  runtime.status = 'pending';

  const second = driveQuestionBeforeGate(workflow, runtime);
  assert.equal(second.blocked, false);
  assert.equal(second.messages.length, 0);
});
