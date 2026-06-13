import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { Stage, StageRuntime, WorkflowDefinition, WorkflowInstance } from '../WorkflowDefinition';
import { findNextReadyStageIndex, syncDagCurrentStageIndex } from '../WorkflowDag';

function st(partial: Partial<Stage> & Pick<Stage, 'id' | 'title'>): Stage {
  const { id, title, ...rest } = partial;
  return {
    id,
    title,
    tool: 'llm-text',
    toolConfig: { type: 'llm-text', systemPrompt: 'x' },
    input: partial.input ?? { sources: [{ type: 'user-input', label: 'u' }], mergeStrategy: 'concat' },
    outputs: [{ key: 'out', format: 'text' }],
    pauseAfter: false,
    ...rest,
  };
}

function makeInst(stages: Stage[], runtimes: StageRuntime[], idx: number, dag: boolean): WorkflowInstance {
  return {
    definition: {
      id: 'wf',
      version: '2.0',
      meta: { title: 't', taskType: 'software', userInput: 'u', createdAt: new Date().toISOString() },
      stages,
      globalConfig: dag ? { enableDagScheduler: true } : {},
    },
    currentStageIndex: idx,
    stageRuntimes: runtimes,
    status: 'running',
  };
}

test('syncDagCurrentStageIndex: linear mode is no-op', () => {
  const stages = [st({ id: 'a', title: 'a' }), st({ id: 'b', title: 'b' })];
  const inst = makeInst(
    stages,
    [
      { stageId: 'a', status: 'done', outputs: {}, retryCount: 0 },
      { stageId: 'b', status: 'paused', outputs: {}, retryCount: 0 },
    ],
    0,
    false,
  );
  syncDagCurrentStageIndex(inst);
  assert.equal(inst.currentStageIndex, 0);
});

test('syncDagCurrentStageIndex: picks first paused when index stale', () => {
  const stages = [st({ id: 'a', title: 'a' }), st({ id: 'b', title: 'b', pauseAfter: true })];
  const inst = makeInst(
    stages,
    [
      { stageId: 'a', status: 'done', outputs: {}, retryCount: 0 },
      { stageId: 'b', status: 'paused', outputs: {}, retryCount: 0 },
    ],
    0,
    true,
  );
  syncDagCurrentStageIndex(inst);
  assert.equal(inst.currentStageIndex, 1);
});

test('syncDagCurrentStageIndex: picks next ready when no pause', () => {
  const stages = [
    st({ id: 'a', title: 'a' }),
    st({ id: 'b', title: 'b', dependsOn: ['a'] }),
    st({ id: 'c', title: 'c', dependsOn: ['a'] }),
  ];
  const inst = makeInst(
    stages,
    [
      { stageId: 'a', status: 'done', outputs: {}, retryCount: 0 },
      { stageId: 'b', status: 'pending', outputs: {}, retryCount: 0 },
      { stageId: 'c', status: 'pending', outputs: {}, retryCount: 0 },
    ],
    2,
    true,
  );
  syncDagCurrentStageIndex(inst);
  assert.equal(inst.currentStageIndex, 1);
});

test('findNextReadyStageIndex treats retrying like pending when deps satisfied (M12.5 D)', () => {
  const stages = [
    st({ id: 'stage_a', title: 'a' }),
    st({ id: 'stage_b', title: 'b', dependsOn: ['stage_a'] }),
    st({ id: 'stage_c', title: 'c', dependsOn: ['stage_a'] }),
  ];
  const runtimes: StageRuntime[] = [
    { stageId: 'stage_a', status: 'done', outputs: {}, retryCount: 0 },
    { stageId: 'stage_b', status: 'retrying', outputs: {}, retryCount: 1 },
    { stageId: 'stage_c', status: 'pending', outputs: {}, retryCount: 0 },
  ];
  assert.equal(findNextReadyStageIndex(stages, runtimes), 1);
});
