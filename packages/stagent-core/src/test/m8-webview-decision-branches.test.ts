import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  canProceedRetry,
  getDecisionApproveAction,
  shouldAskRetryConfirm,
} from '../DecisionReviewUi';

test('decision approve button: incomplete checklist enters soft-prompt branch', () => {
  const action = getDecisionApproveAction(6, 4);
  assert.equal(action, 'show-soft-prompt');
});

test('decision approve button: all checks done enters approve-now branch', () => {
  const action = getDecisionApproveAction(6, 6);
  assert.equal(action, 'approve-now');
});

test('decision retry button: with prior approved decision requires confirm', () => {
  assert.equal(shouldAskRetryConfirm(1), true);
  assert.equal(canProceedRetry(1, false), false);
  assert.equal(canProceedRetry(1, true), true);
});

test('decision retry button: no approved decision proceeds directly', () => {
  assert.equal(shouldAskRetryConfirm(0), false);
  assert.equal(canProceedRetry(0, false), true);
});
