import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSkipCondition, anyTestRunFailed } from '../WorkflowSkipCondition';
import {
  isDeliveryStageId,
  readBlockDeliveryOnTestFailure,
} from '../execution/DeliveryBlockOnTestFailure';
import { CODE_RUNNER_EXIT_OUTPUT_KEY } from '../WorkflowOutputKeys';
import type { StageRuntime } from '../WorkflowDefinition';

function testRunRuntime(stageId: string, exit: number): StageRuntime {
  return {
    stageId,
    status: 'done',
    outputs: { [CODE_RUNNER_EXIT_OUTPUT_KEY]: exit },
    startedAt: '',
    retryCount: 0,
  };
}

test('anyTestRunFailed detects non-zero exit', () => {
  assert.equal(
    anyTestRunFailed([
      testRunRuntime('stage_test_run_slice', 127),
      testRunRuntime('stage_test_run_other', 0),
    ]),
    true,
  );
  assert.equal(
    anyTestRunFailed([testRunRuntime('stage_test_run_slice', 0)]),
    false,
  );
});

test('evaluateSkipCondition anyTestRunFailed skips delivery when red', () => {
  const runtimes = [testRunRuntime('stage_test_run_a', 1)];
  assert.equal(
    evaluateSkipCondition({ type: 'anyTestRunFailed', stageId: '_any_' }, runtimes),
    true,
  );
});

test('evaluateSkipCondition anyTestRunFailed does not skip when all green', () => {
  const runtimes = [testRunRuntime('stage_test_run_a', 0)];
  assert.equal(
    evaluateSkipCondition({ type: 'anyTestRunFailed', stageId: '_any_' }, runtimes),
    false,
  );
});

test('readBlockDeliveryOnTestFailure defaults by taskType', () => {
  assert.equal(readBlockDeliveryOnTestFailure(undefined, 'software'), true);
  assert.equal(readBlockDeliveryOnTestFailure(undefined, 'prototype'), false);
  assert.equal(readBlockDeliveryOnTestFailure(undefined, 'document'), false);
});

test('isDeliveryStageId matches wrapup and stage_delivery', () => {
  assert.equal(isDeliveryStageId('stage_delivery_wrapup'), true);
  assert.equal(isDeliveryStageId('stage_delivery'), true);
  assert.equal(isDeliveryStageId('stage_test_run_x'), false);
});
