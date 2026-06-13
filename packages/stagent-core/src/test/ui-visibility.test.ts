import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { shouldHideOutput } from '../WebviewUiState';

test('paused + decision stage should hide output', () => {
  const hidden = shouldHideOutput('stage_decide_api', { stage_decide_api: 'paused' }, (id) => id === 'stage_decide_api');
  assert.equal(hidden, true);
});

test('paused + non-decision stage should keep output visible', () => {
  const hidden = shouldHideOutput('stage_impl_api', { stage_impl_api: 'paused' }, () => false);
  assert.equal(hidden, false);
});

test('running stage should keep output visible', () => {
  const hidden = shouldHideOutput('stage_decide_api', { stage_decide_api: 'running' }, () => true);
  assert.equal(hidden, false);
});
