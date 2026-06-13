import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { shouldShowDecisionConflictBanner } from '../DecisionReviewUi';

test('show conflict banner when approved decision count >= 2', () => {
  assert.equal(shouldShowDecisionConflictBanner(2), true);
  assert.equal(shouldShowDecisionConflictBanner(3), true);
});

test('hide conflict banner when approved decision count < 2', () => {
  assert.equal(shouldShowDecisionConflictBanner(0), false);
  assert.equal(shouldShowDecisionConflictBanner(1), false);
});
