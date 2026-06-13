import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { normalizeErrorType } from '../ErrorTypeUtils';

test('normalizeErrorType accepts new M17 types and falls back', () => {
  assert.equal(normalizeErrorType('confidence-too-low'), 'confidence-too-low');
  assert.equal(normalizeErrorType('sandbox-network-blocked'), 'sandbox-network-blocked');
  assert.equal(normalizeErrorType('not-a-real-type'), 'unknown');
});
