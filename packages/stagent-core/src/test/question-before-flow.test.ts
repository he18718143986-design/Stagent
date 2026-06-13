import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  buildAnswerQuestionsBeforeMessage,
  getMissingRequiredQuestionIds,
  shouldEnterWaitingQuestions,
} from '../QuestionBeforeFlow';

test('M7 flow: unanswered required question enters waiting-questions', () => {
  const questions = [
    { id: 'q1', text: 'API timeout?', hint: '30s', required: true },
    { id: 'q2', text: 'Optional note', hint: 'none', required: false },
  ];
  const answers = { q2: 'x' };
  assert.equal(shouldEnterWaitingQuestions(questions, answers), true);
  assert.deepEqual(getMissingRequiredQuestionIds(questions, answers), ['q1']);
});

test('M7 flow: after answer submitted, stage can continue', () => {
  const questions = [{ id: 'q1', text: 'API timeout?', hint: '30s', required: true }];
  const answers = { q1: '45s' };
  assert.equal(shouldEnterWaitingQuestions(questions, answers), false);
  assert.deepEqual(getMissingRequiredQuestionIds(questions, answers), []);
});

test('M7 UI chain: build answerQuestionsBefore message shape', () => {
  const msg = buildAnswerQuestionsBeforeMessage('stage_impl_api', { q1: '45s' });
  assert.equal(msg.type, 'answerQuestionsBefore');
  assert.equal(msg.stageId, 'stage_impl_api');
  assert.equal(msg.answers.q1, '45s');
});
