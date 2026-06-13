import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { BackendMessage, WorkflowInstance } from '../WorkflowDefinition';
import {
  buildExecutionRecoveryMessages,
  findFirstFailedStage,
  findInterruptedRunningStageIndex,
  resetInterruptedExecutionStages,
} from '../WorkflowRecoveryViewModel';

function buildInstance(): WorkflowInstance {
  return {
    definition: {
      id: 'wf_recover',
      version: '2.0',
      meta: { title: 'recover', taskType: 'software', userInput: 'u', createdAt: new Date().toISOString() },
      stages: [
        {
          id: 'stage_decide_a',
          title: 'decide',
          tool: 'llm-text',
          toolConfig: { type: 'llm-text', systemPrompt: 'x' },
          input: { sources: [], mergeStrategy: 'concat' },
          outputs: [{ key: 'decisionRecord', format: 'markdown' }],
          pauseAfter: true,
          isDecisionStage: true,
          questionAfter: [{ id: 'q1', text: 'ok?', required: true }],
        },
      ],
    },
    currentStageIndex: 0,
    status: 'paused',
    stageRuntimes: [
      {
        stageId: 'stage_decide_a',
        status: 'paused',
        outputs: { decisionRecord: 'record' },
        retryCount: 0,
      },
    ],
  };
}

test('buildExecutionRecoveryMessages emits instanceResumed and replay messages', () => {
  const instance = buildInstance();
  instance.status = 'running';
  const msgs = buildExecutionRecoveryMessages(instance, 'key-1');
  assert.equal(msgs[0].type, 'instanceResumed');
  const resumed = msgs[0] as Extract<BackendMessage, { type: 'instanceResumed' }>;
  assert.equal(resumed.instanceKey, 'key-1');
  assert.equal(resumed.resync, true);
  assert.deepEqual(resumed.stageStatuses, { stage_decide_a: 'paused' });
  assert.equal(msgs.some((m: BackendMessage) => m.type === 'stageStatusUpdate'), false);
  assert.equal(msgs.some((m: BackendMessage) => m.type === 'stageOutputUpdate'), true);
  assert.equal(msgs.some((m: BackendMessage) => m.type === 'stageQuestions'), true);
  assert.ok(!msgs.some((m: BackendMessage) => m.type === 'workflowGenerated'));
});

test('findInterruptedRunningStageIndex finds running or retrying stage', () => {
  const instance = buildInstance();
  instance.stageRuntimes.push({ stageId: 'stage_b', status: 'retrying', outputs: {}, retryCount: 0 });
  assert.equal(findInterruptedRunningStageIndex(instance), 1);
});

test('resetInterruptedExecutionStages 线性模式只重置并指向首个中断阶段', () => {
  const instance = buildInstance();
  instance.stageRuntimes.push({ stageId: 'stage_b', status: 'running', outputs: {}, retryCount: 0 });
  const reset = resetInterruptedExecutionStages(instance);
  assert.deepEqual(reset, [1]);
  assert.equal(instance.stageRuntimes[1].status, 'pending');
  assert.equal(instance.currentStageIndex, 1);
});

test('buildExecutionRecoveryMessages 首条 instanceResumed 并重放 lastError', () => {
  const instance = buildInstance();
  instance.status = 'failed';
  instance.stageRuntimes[0].status = 'error';
  instance.stageRuntimes[0].lastError = {
    error: 'boom',
    errorType: 'tool-execution-failed',
  };
  const msgs = buildExecutionRecoveryMessages(instance, 'key-1');
  assert.equal(msgs[0].type, 'instanceResumed');
  if (msgs[0].type === 'instanceResumed') {
    assert.equal(msgs[0].instanceKey, 'key-1');
    assert.equal(msgs[0].instanceStatus, 'failed');
    assert.equal(msgs[0].failedStageId, 'stage_decide_a');
  }
  const err = msgs.find((m) => m.type === 'stageError');
  assert.ok(err && err.type === 'stageError');
  if (err && err.type === 'stageError') {
    assert.equal(err.error, 'boom');
    assert.ok(typeof err.userTitle === 'string' && err.userTitle.length > 0);
  }
  assert.ok(!msgs.some((m) => m.type === 'workflowGenerated'));
});

test('findFirstFailedStage 返回首个 error 阶段', () => {
  const instance = buildInstance();
  instance.stageRuntimes[0].status = 'error';
  assert.equal(findFirstFailedStage(instance), 'stage_decide_a');
});
