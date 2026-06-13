import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { Stage, StageRuntime } from '../WorkflowDefinition';
import {
  findAllReadyStageIndices,
  pickDagExecutionBatch,
  resolveDagMaxParallelism,
  stageEligibleForDagParallelism,
} from '../WorkflowDag';

function st(id: string, partial?: Partial<Stage>): Stage {
  return {
    id,
    title: id,
    tool: 'llm-text',
    toolConfig: { type: 'llm-text', systemPrompt: 'x' },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'out', format: 'text' }],
    pauseAfter: false,
    ...partial,
  };
}

function rt(stageId: string, status: StageRuntime['status']): StageRuntime {
  return { stageId, status, outputs: {}, retryCount: 0 };
}

test('findAllReadyStageIndices returns all dependency-ready pending stages', () => {
  const stages = [st('a'), st('b', { dependsOn: ['a'] }), st('c', { dependsOn: ['a'] })];
  const runtimes = [rt('a', 'done'), rt('b', 'pending'), rt('c', 'pending')];
  assert.deepEqual(findAllReadyStageIndices(stages, runtimes), [1, 2]);
});

test('stageEligibleForDagParallelism excludes decision pauseAfter questionBefore', () => {
  assert.equal(stageEligibleForDagParallelism(st('x')), true);
  assert.equal(stageEligibleForDagParallelism(st('x', { isDecisionStage: true })), false);
  assert.equal(stageEligibleForDagParallelism(st('x', { pauseAfter: true })), false);
  assert.equal(stageEligibleForDagParallelism(st('x', { questionBefore: [{ id: 'q', text: 't' }] })), false);
});

test('pickDagExecutionBatch prefers serial gate when decision stage is ready', () => {
  const stages = [
    st('a'),
    st('decide', { isDecisionStage: true, dependsOn: ['a'] }),
    st('impl', { dependsOn: ['a'] }),
  ];
  const runtimes = [rt('a', 'done'), rt('decide', 'pending'), rt('impl', 'pending')];
  assert.deepEqual(pickDagExecutionBatch(stages, runtimes, 4), [1]);
});

test('pickDagExecutionBatch caps parallel impl stages by maxParallel', () => {
  const stages = [st('a'), st('b', { dependsOn: ['a'] }), st('c', { dependsOn: ['a'] }), st('d', { dependsOn: ['a'] })];
  const runtimes = [rt('a', 'done'), rt('b', 'pending'), rt('c', 'pending'), rt('d', 'pending')];
  assert.deepEqual(pickDagExecutionBatch(stages, runtimes, 2), [1, 2]);
});

test('resolveDagMaxParallelism prefers workflow over vscode default', () => {
  assert.equal(resolveDagMaxParallelism(4, 1), 4);
  assert.equal(resolveDagMaxParallelism(undefined, 3), 3);
  assert.equal(resolveDagMaxParallelism(undefined, 0), 1);
});
