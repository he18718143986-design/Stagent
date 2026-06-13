import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { getPauseUiState } from '../WebviewPauseUiState';

test('paused + decision stage should use decision mode', () => {
  const ui = getPauseUiState('stage_decide_api', { stage_decide_api: 'paused' }, (id) => id === 'stage_decide_api');
  assert.equal(ui.showPauseBar, true);
  assert.equal(ui.mode, 'decision');
  assert.equal(ui.enableRetry, true);
  assert.equal(ui.enableApproveDecision, true);
  assert.equal(ui.enableApprove, false);
});

test('paused + normal stage should use normal mode', () => {
  const ui = getPauseUiState('stage_impl_api', { stage_impl_api: 'paused' }, () => false);
  assert.equal(ui.showPauseBar, true);
  assert.equal(ui.mode, 'normal');
  assert.equal(ui.enableRetry, true);
  assert.equal(ui.enableApprove, true);
  assert.equal(ui.enableApproveDecision, false);
});

test('running stage should hide pause bar and disable actions', () => {
  const ui = getPauseUiState('stage_decide_api', { stage_decide_api: 'running' }, () => true);
  assert.equal(ui.showPauseBar, false);
  assert.equal(ui.mode, null);
  assert.equal(ui.enableRetry, false);
  assert.equal(ui.enableApprove, false);
  assert.equal(ui.enableApproveDecision, false);
});
