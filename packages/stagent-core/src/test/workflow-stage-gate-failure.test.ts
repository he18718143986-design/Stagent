import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { BackendMessage, Stage, WorkflowInstance } from '../WorkflowDefinition';
import { failWorkflowStageFromGate } from '../WorkflowStageGateFailure';

test('failWorkflowStageFromGate emits workflowFailed and stage status error', () => {
  const posted: BackendMessage[] = [];
  const stage: Stage = {
    id: 'stage_test_run_signals',
    title: 'run',
    tool: 'code-runner',
    toolConfig: { type: 'code-runner', command: 'true', captureOutput: true },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [],
    pauseAfter: false,
  };
  const instance = {
    status: 'running' as const,
    definition: {
      id: 'wf',
      version: '2.0',
      meta: { title: 't', taskType: 'software', userInput: 'u', createdAt: new Date().toISOString() },
      stages: [stage],
    },
    stageRuntimes: [{ stageId: stage.id, status: 'running', outputs: {}, retryCount: 0 }],
    currentStageIndex: 0,
  } satisfies WorkflowInstance;
  let saved = false;
  const outcome = failWorkflowStageFromGate(
    {
      panel: {},
      postMessage: (_p: unknown, msg: BackendMessage) => posted.push(msg),
      instance,
      scheduleSave: () => {
        saved = true;
      },
    } as never,
    stage,
    0,
    'test_run still failing after fix chain exhausted (blockDeliveryOnTestFailure)',
  );
  assert.equal(outcome, 'failed');
  assert.equal(instance.status, 'failed');
  assert.equal(saved, true);
  assert.ok(posted.some((m) => m.type === 'workflowFailed'));
  assert.ok(
    posted.some(
      (m) => m.type === 'workflowFailed' && m.reason.includes('blockDeliveryOnTestFailure'),
    ),
  );
  assert.ok(
    posted.some(
      (m) => m.type === 'stageStatusUpdate' && m.stageId === stage.id && m.status === 'error',
    ),
  );
});
