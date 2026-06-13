import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { resetOutputsForNonDecisionRetry } from '../RetryOutputPolicy';

test('non-decision retry clears all outputs (semantic lock)', () => {
  const previous = {
    text: 'draft',
    decisionRecord: 'x',
    _exitCode: 1,
    _stdout: 'err',
    _patchFallback_code: true,
    _implExecNote: 'note',
  };
  const next = resetOutputsForNonDecisionRetry(previous);
  assert.deepEqual(next, {});
});
