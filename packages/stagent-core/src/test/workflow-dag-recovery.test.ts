import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { WorkflowInstance } from '../WorkflowDefinition';
import {
  describeDagRecoveryCursor,
  findAllReadyStageIndices,
  syncDagCurrentStageIndex,
} from '../WorkflowDag';
import { resetInterruptedExecutionStages } from '../WorkflowRecoveryViewModel';

function dagInstance(partial?: Partial<WorkflowInstance>): WorkflowInstance {
  return {
    definition: {
      id: 'wf_dag',
      version: '2.0',
      meta: { title: 'dag', taskType: 'software', userInput: 'u', createdAt: '' },
      globalConfig: { enableDagScheduler: true },
      stages: [
        {
          id: 's_root',
          title: 'root',
          tool: 'llm-text',
          toolConfig: { type: 'llm-text', systemPrompt: 'x' },
          input: { sources: [], mergeStrategy: 'concat' },
          outputs: [{ key: 'o', format: 'text' }],
          pauseAfter: false,
        },
        {
          id: 's_a',
          title: 'a',
          tool: 'llm-text',
          toolConfig: { type: 'llm-text', systemPrompt: 'x' },
          input: { sources: [], mergeStrategy: 'concat' },
          outputs: [{ key: 'o', format: 'text' }],
          pauseAfter: false,
          dependsOn: ['s_root'],
        },
        {
          id: 's_b',
          title: 'b',
          tool: 'llm-text',
          toolConfig: { type: 'llm-text', systemPrompt: 'x' },
          input: { sources: [], mergeStrategy: 'concat' },
          outputs: [{ key: 'o', format: 'text' }],
          pauseAfter: false,
          dependsOn: ['s_root'],
        },
      ],
    },
    currentStageIndex: 0,
    status: 'running',
    stageRuntimes: [
      { stageId: 's_root', status: 'done', outputs: {}, retryCount: 0 },
      { stageId: 's_a', status: 'running', outputs: {}, retryCount: 0 },
      { stageId: 's_b', status: 'running', outputs: {}, retryCount: 0 },
    ],
    ...partial,
  };
}

test('resetInterruptedExecutionStages DAG 重置全部 running 并 sync 游标', () => {
  const inst = dagInstance();
  const reset = resetInterruptedExecutionStages(inst);
  assert.deepEqual(reset, [1, 2]);
  assert.equal(inst.stageRuntimes[1].status, 'pending');
  assert.equal(inst.stageRuntimes[2].status, 'pending');
  syncDagCurrentStageIndex(inst);
  const ready = findAllReadyStageIndices(inst.definition.stages, inst.stageRuntimes);
  assert.ok(ready.includes(1));
  assert.ok(ready.includes(2));
  assert.equal(inst.currentStageIndex, 1);
});

test('syncDagCurrentStageIndex 优先对齐 paused 阶段', () => {
  const inst = dagInstance({
    stageRuntimes: [
      { stageId: 's_root', status: 'done', outputs: {}, retryCount: 0 },
      { stageId: 's_a', status: 'paused', outputs: {}, retryCount: 0 },
      { stageId: 's_b', status: 'pending', outputs: {}, retryCount: 0 },
    ],
  });
  syncDagCurrentStageIndex(inst);
  assert.equal(inst.currentStageIndex, 1);
  const cursor = describeDagRecoveryCursor(inst);
  assert.equal(cursor.mode, 'dag');
  assert.equal(cursor.currentStageId, 's_a');
  assert.deepEqual(cursor.pausedIndices, [1]);
});

test('describeDagRecoveryCursor 线性模式不计算 readyIndices', () => {
  const inst = dagInstance({
    definition: {
      ...dagInstance().definition,
      globalConfig: { enableDagScheduler: false },
    },
  });
  const cursor = describeDagRecoveryCursor(inst);
  assert.equal(cursor.mode, 'linear');
  assert.deepEqual(cursor.readyIndices, []);
});
