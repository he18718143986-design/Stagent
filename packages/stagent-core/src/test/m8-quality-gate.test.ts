import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { getUncheckedCount, shouldShowQualitySoftPrompt } from '../DecisionReviewUi';

test('shows soft prompt when not all checks are checked', () => {
  assert.equal(shouldShowQualitySoftPrompt(6, 5), true);
  assert.equal(getUncheckedCount(6, 5), 1);
});

test('no soft prompt when all checks are checked', () => {
  assert.equal(shouldShowQualitySoftPrompt(6, 6), false);
  assert.equal(getUncheckedCount(6, 6), 0);
});
