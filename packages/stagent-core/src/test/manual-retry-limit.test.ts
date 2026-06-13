import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  DEFAULT_MAX_MANUAL_STAGE_RETRIES,
  evaluateManualRetryLimit,
  normalizeMaxManualStageRetries,
} from '../ManualRetryLimit';

test('normalizeMaxManualStageRetries defaults and clamps', () => {
  assert.equal(normalizeMaxManualStageRetries(undefined), DEFAULT_MAX_MANUAL_STAGE_RETRIES);
  assert.equal(normalizeMaxManualStageRetries(NaN), DEFAULT_MAX_MANUAL_STAGE_RETRIES);
  assert.equal(normalizeMaxManualStageRetries(0), 1);
  assert.equal(normalizeMaxManualStageRetries(2.9), 2);
  assert.equal(normalizeMaxManualStageRetries(5), 5);
});

test('evaluateManualRetryLimit allows retryCount below max', () => {
  assert.deepEqual(evaluateManualRetryLimit(0, 3), { allowed: true });
  assert.deepEqual(evaluateManualRetryLimit(2, 3), { allowed: true });
});

test('evaluateManualRetryLimit blocks when retryCount reached max', () => {
  const r = evaluateManualRetryLimit(3, 3);
  assert.equal(r.allowed, false);
  if (!r.allowed) {
    assert.match(r.message, /上限/);
    assert.match(r.message, /3/);
  }
});

test('evaluateManualRetryLimit max=1 allows one manual retry only', () => {
  assert.deepEqual(evaluateManualRetryLimit(0, 1), { allowed: true });
  assert.equal(evaluateManualRetryLimit(1, 1).allowed, false);
});
