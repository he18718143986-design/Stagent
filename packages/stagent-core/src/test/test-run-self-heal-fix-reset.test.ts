import test from 'node:test';
import assert from 'node:assert/strict';
import { anyTestRunFailed } from '../execution/DeliveryBlockOnTestFailure';
import { evaluateSkipCondition } from '../WorkflowSkipCondition';
import { resetFixStagePending } from '../runtime-replan/testRunSelfHeal';
import type { WorkflowDefinition, WorkflowInstance } from '../WorkflowDefinition';

function minimalInstance(): WorkflowInstance {
  const definition: WorkflowDefinition = {
    id: 'wf-test',
    version: '2.0',
    meta: {
      title: 't',
      taskType: 'software',
      userInput: 'x',
      createdAt: new Date().toISOString(),
    },
    stages: [
      {
        id: 'stage_test_run_slice',
        title: 'run',
        tool: 'code-runner',
        toolConfig: { type: 'code-runner', command: 'pytest', captureOutput: true },
        input: { sources: [], mergeStrategy: 'concat' },
        outputs: [],
        pauseAfter: false,
      },
      {
        id: 'stage_fix_if_failed_slice',
        title: 'fix',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'fix' },
        input: { sources: [], mergeStrategy: 'concat' },
        outputs: [],
        pauseAfter: false,
      },
    ],
    globalConfig: {},
  };
  return {
    definition,
    currentStageIndex: 0,
    status: 'running',
    stageRuntimes: [
      { stageId: 'stage_test_run_slice', status: 'done', outputs: { _exitCode: 127 }, retryCount: 0 },
      { stageId: 'stage_fix_if_failed_slice', status: 'done', outputs: {}, retryCount: 0, completedAt: '2026-01-01T00:00:00Z' },
    ],
  };
}

test('resetFixStagePending sets fix stage back to pending', () => {
  const instance = minimalInstance();
  resetFixStagePending(instance, 'stage_test_run_slice');
  const fixRt = instance.stageRuntimes.find((r) => r.stageId === 'stage_fix_if_failed_slice');
  assert.equal(fixRt?.status, 'pending');
  assert.equal(fixRt?.completedAt, undefined);
});

test('二次 test_run 失败：fix 重入 + delivery skip（不 linear skip 到 delivery）', () => {
  const instance = minimalInstance();
  resetFixStagePending(instance, 'stage_test_run_slice');
  const fixRt = instance.stageRuntimes.find((r) => r.stageId === 'stage_fix_if_failed_slice');
  assert.equal(fixRt?.status, 'pending', 'fix 须重入而非保持 done');
  assert.equal(anyTestRunFailed(instance.stageRuntimes), true);
  assert.equal(
    evaluateSkipCondition({ type: 'anyTestRunFailed', stageId: '_any_' }, instance.stageRuntimes),
    true,
    'test 仍红时 delivery skipIf 为 true',
  );
});
