import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { Stage, StageRuntime } from '../WorkflowDefinition';
import {
  applyQuestionAfterAnswers,
  blocksDirectApproveForQuestionAfter,
  buildAnswerQuestionsMessage,
  shouldAutoAdvanceAfterAnswers,
} from '../QuestionAfterFlow';

function buildStage(): Stage {
  return {
    id: 'stage_impl_x',
    title: 'impl x',
    tool: 'llm-text',
    toolConfig: { type: 'llm-text', systemPrompt: 'x' },
    input: { sources: [{ type: 'user-input', label: '需求' }], mergeStrategy: 'concat' },
    outputs: [{ key: 'code', format: 'text' }],
    pauseAfter: true,
    questionAfter: [{ id: 'q1', text: '确认边界？', hint: 'yes', required: true }],
  };
}

test('questionAfter answers should auto-advance when current stage is paused', () => {
  const stage = buildStage();
  const runtime: StageRuntime = {
    stageId: stage.id,
    status: 'paused',
    outputs: {},
    retryCount: 0,
  };
  assert.equal(shouldAutoAdvanceAfterAnswers(stage, runtime, 1, 1), true);
  applyQuestionAfterAnswers(runtime, { q1: 'ok' }, '2026-05-08T00:00:00.000Z');
  assert.equal(runtime.status, 'done');
  assert.equal(runtime.questionAnswers?.q1, 'ok');
  assert.equal(runtime.completedAt, '2026-05-08T00:00:00.000Z');
});

test('blocksDirectApproveForQuestionAfter is true iff stage carries questionAfter', () => {
  assert.equal(blocksDirectApproveForQuestionAfter({ questionAfter: undefined }), false);
  assert.equal(blocksDirectApproveForQuestionAfter({ questionAfter: [] }), false);
  assert.equal(blocksDirectApproveForQuestionAfter(buildStage()), true);
});

test('buildAnswerQuestionsMessage matches FrontendMessage shape', () => {
  const msg = buildAnswerQuestionsMessage('stage_impl_x', { q1: 'a' });
  assert.equal(msg.type, 'answerQuestions');
  assert.equal(msg.stageId, 'stage_impl_x');
  assert.equal(msg.answers.q1, 'a');
});

test('questionAfter answers should not auto-advance when not paused/current', () => {
  const stage = buildStage();
  const runtime: StageRuntime = {
    stageId: stage.id,
    status: 'running',
    outputs: {},
    retryCount: 0,
  };
  assert.equal(shouldAutoAdvanceAfterAnswers(stage, runtime, 0, 0), false);
  assert.equal(shouldAutoAdvanceAfterAnswers(stage, { ...runtime, status: 'paused' }, 0, 1), false);
});
