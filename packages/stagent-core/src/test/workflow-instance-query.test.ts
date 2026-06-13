import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildTaskListItem, isRecoverableInstance } from '../WorkflowInstanceQuery';
import type { WorkflowInstance } from '../WorkflowDefinition';

function inst(status: WorkflowInstance['status']): WorkflowInstance {
  return {
    definition: {
      id: 'wf',
      version: '2.0',
      meta: { title: 't', taskType: 'auto', userInput: 'x', createdAt: '' },
      stages: [{ id: 's1', title: 's', tool: 'llm-text', toolConfig: { type: 'llm-text', systemPrompt: 'x' }, input: { sources: [], mergeStrategy: 'concat' }, outputs: [], pauseAfter: false }],
    },
    currentStageIndex: 0,
    stageRuntimes: [{ stageId: 's1', status: 'pending', outputs: {}, retryCount: 0 }],
    status,
  };
}

test('isRecoverableInstance: failed 可恢复，completed 不可', () => {
  assert.equal(isRecoverableInstance(inst('failed')), true);
  assert.equal(isRecoverableInstance(inst('completed')), false);
  assert.equal(isRecoverableInstance(inst('idle')), true);
  assert.equal(isRecoverableInstance(inst('running')), true);
});

test('buildTaskListItem 填充 recoverable 与 error 状态', () => {
  const failed = buildTaskListItem('k1', inst('failed'));
  assert.equal(failed.status, 'error');
  assert.equal(failed.recoverable, true);
  const done = buildTaskListItem('k2', inst('completed'));
  assert.equal(done.status, 'completed');
  assert.equal(done.recoverable, false);
});
