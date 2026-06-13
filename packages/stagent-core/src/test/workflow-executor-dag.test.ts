import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { executeNextStageLoop } from '../WorkflowExecutor';
import type { Stage, WorkflowInstance } from '../WorkflowDefinition';

function stage(id: string, dependsOn?: string[]): Stage {
  return {
    id,
    title: id,
    tool: 'llm-text',
    toolConfig: { type: 'llm-text', systemPrompt: `run ${id}` },
    input: { sources: [{ type: 'user-input', label: 'x' }], mergeStrategy: 'concat' },
    outputs: [{ key: 'out', format: 'text' }],
    pauseAfter: false,
    dependsOn,
  };
}

function makeInstance(stages: Stage[], dag = true, dagMaxParallelism?: number): WorkflowInstance {
  return {
    definition: {
      id: 'wf_dag_test',
      version: '2.0',
      meta: {
        title: 'dag',
        taskType: 'software',
        userInput: 'x',
        createdAt: new Date().toISOString(),
      },
      globalConfig: dag
        ? { enableDagScheduler: true, ...(dagMaxParallelism !== undefined ? { dagMaxParallelism } : {}) }
        : undefined,
      stages,
    },
    currentStageIndex: 0,
    stageRuntimes: stages.map((s) => ({
      stageId: s.id,
      status: 'pending',
      outputs: {},
      retryCount: 0,
    })),
    status: 'running',
  };
}

test('DAG mode runs ready stages by dependency order', async () => {
  const stages = [stage('stage_a'), stage('stage_b', ['stage_c']), stage('stage_c', ['stage_a'])];
  const instance = makeInstance(stages);
  const executed: string[] = [];
  let ik: string | undefined;

  await executeNextStageLoop({
    instance,
    panel: {},
    currentInstanceKey: undefined,
    setCurrentInstanceKey: (v) => {
      ik = v;
    },
    evaluateSkipCondition: () => false,
    postMessage: () => {},
    scheduleSave: () => {},
    warn: () => {},
    debugLog: () => {},
    primaryOutputKey: (s) => s.outputs[0].key,
    ensureTaskDir: () => {},
    resolveInput: async () => '',
    executeLlmText: async (stageId) => {
      executed.push(stageId);
      return `ok:${stageId}`;
    },
    applyPatchInstructions: async () => {},
    resolveTaskFilePath: (_i, p) => p,
    resolveOutputPath: (_i, p) => p,
    runCodeRunner: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    isCancellationError: () => false,
    enableDagScheduler: true,
  });

  assert.equal(Boolean(ik), true);
  assert.deepEqual(executed, ['stage_a', 'stage_c', 'stage_b']);
  assert.equal(instance.status, 'completed');
});

test('Linear mode keeps array order when DAG disabled', async () => {
  const stages = [stage('stage_a'), stage('stage_b', ['stage_c']), stage('stage_c', ['stage_a'])];
  const instance = makeInstance(stages);
  const executed: string[] = [];

  await executeNextStageLoop({
    instance,
    panel: {},
    currentInstanceKey: undefined,
    setCurrentInstanceKey: () => {},
    evaluateSkipCondition: () => false,
    postMessage: () => {},
    scheduleSave: () => {},
    warn: () => {},
    debugLog: () => {},
    primaryOutputKey: (s) => s.outputs[0].key,
    ensureTaskDir: () => {},
    resolveInput: async () => '',
    executeLlmText: async (stageId) => {
      executed.push(stageId);
      return `ok:${stageId}`;
    },
    applyPatchInstructions: async () => {},
    resolveTaskFilePath: (_i, p) => p,
    resolveOutputPath: (_i, p) => p,
    runCodeRunner: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    isCancellationError: () => false,
    enableDagScheduler: false,
  });

  assert.deepEqual(executed, ['stage_a', 'stage_b', 'stage_c']);
  assert.equal(instance.status, 'completed');
});

test('DAG diamond: D runs after B and C', async () => {
  const stages = [
    stage('stage_a'),
    stage('stage_b', ['stage_a']),
    stage('stage_c', ['stage_a']),
    stage('stage_d', ['stage_b', 'stage_c']),
  ];
  const instance = makeInstance(stages, true);
  const executed: string[] = [];

  await executeNextStageLoop({
    instance,
    panel: {},
    currentInstanceKey: undefined,
    setCurrentInstanceKey: () => {},
    evaluateSkipCondition: () => false,
    postMessage: () => {},
    scheduleSave: () => {},
    warn: () => {},
    debugLog: () => {},
    primaryOutputKey: (s) => s.outputs[0].key,
    ensureTaskDir: () => {},
    resolveInput: async () => '',
    executeLlmText: async (stageId) => {
      executed.push(stageId);
      return `ok:${stageId}`;
    },
    applyPatchInstructions: async () => {},
    resolveTaskFilePath: (_i, p) => p,
    resolveOutputPath: (_i, p) => p,
    runCodeRunner: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    isCancellationError: () => false,
    enableDagScheduler: true,
  });

  assert.equal(executed[0], 'stage_a');
  assert.ok(executed.includes('stage_b'));
  assert.ok(executed.includes('stage_c'));
  assert.equal(executed[executed.length - 1], 'stage_d');
  assert.ok(executed.indexOf('stage_b') < executed.indexOf('stage_d'));
  assert.ok(executed.indexOf('stage_c') < executed.indexOf('stage_d'));
  assert.equal(instance.status, 'completed');
});

test('DAG pauseAfter: stops at paused stage and preserves order', async () => {
  const stages = [
    { ...stage('stage_a'), pauseAfter: true },
    stage('stage_b', ['stage_a']),
  ];
  const instance = makeInstance(stages, true);
  const executed: string[] = [];

  await executeNextStageLoop({
    instance,
    panel: {},
    currentInstanceKey: undefined,
    setCurrentInstanceKey: () => {},
    evaluateSkipCondition: () => false,
    postMessage: () => {},
    scheduleSave: () => {},
    warn: () => {},
    debugLog: () => {},
    primaryOutputKey: (s) => s.outputs[0].key,
    ensureTaskDir: () => {},
    resolveInput: async () => '',
    executeLlmText: async (stageId) => {
      executed.push(stageId);
      return `ok:${stageId}`;
    },
    applyPatchInstructions: async () => {},
    resolveTaskFilePath: (_i, p) => p,
    resolveOutputPath: (_i, p) => p,
    runCodeRunner: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    isCancellationError: () => false,
    enableDagScheduler: true,
  });

  assert.deepEqual(executed, ['stage_a']);
  assert.equal(instance.status, 'running');
  assert.equal(instance.stageRuntimes[0].status, 'paused');
  assert.equal(instance.currentStageIndex, 0);
});

test('DAG parallel: B and C overlap when dagMaxParallelism >= 2', async () => {
  const stages = [
    stage('stage_a'),
    stage('stage_b', ['stage_a']),
    stage('stage_c', ['stage_a']),
    stage('stage_d', ['stage_b', 'stage_c']),
  ];
  const instance = makeInstance(stages, true, 4);
  const executed: string[] = [];
  const events: Array<{ stageId: string; kind: 'start' | 'end'; t: number }> = [];
  let clock = 0;

  await executeNextStageLoop({
    instance,
    panel: {},
    currentInstanceKey: undefined,
    setCurrentInstanceKey: () => {},
    evaluateSkipCondition: () => false,
    postMessage: () => {},
    scheduleSave: () => {},
    warn: () => {},
    debugLog: () => {},
    primaryOutputKey: (s) => s.outputs[0].key,
    ensureTaskDir: () => {},
    resolveInput: async () => '',
    executeLlmText: async (stageId) => {
      executed.push(stageId);
      events.push({ stageId, kind: 'start', t: ++clock });
      await new Promise((r) => setTimeout(r, 30));
      events.push({ stageId, kind: 'end', t: ++clock });
      return `ok:${stageId}`;
    },
    applyPatchInstructions: async () => {},
    resolveTaskFilePath: (_i, p) => p,
    resolveOutputPath: (_i, p) => p,
    runCodeRunner: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    isCancellationError: () => false,
    enableDagScheduler: true,
    dagMaxParallelism: 4,
  });

  assert.equal(executed[0], 'stage_a');
  assert.equal(executed[executed.length - 1], 'stage_d');
  const bStart = events.find((e) => e.stageId === 'stage_b' && e.kind === 'start')!.t;
  const cStart = events.find((e) => e.stageId === 'stage_c' && e.kind === 'start')!.t;
  const bEnd = events.find((e) => e.stageId === 'stage_b' && e.kind === 'end')!.t;
  const cEnd = events.find((e) => e.stageId === 'stage_c' && e.kind === 'end')!.t;
  assert.ok(bStart < cEnd && cStart < bEnd, 'stage_b and stage_c should overlap');
  assert.equal(instance.status, 'completed');
});

test('DAG dagMaxParallelism=1 keeps sequential wave order', async () => {
  const stages = [
    stage('stage_a'),
    stage('stage_b', ['stage_a']),
    stage('stage_c', ['stage_a']),
  ];
  const instance = makeInstance(stages, true, 1);
  const executed: string[] = [];

  await executeNextStageLoop({
    instance,
    panel: {},
    currentInstanceKey: undefined,
    setCurrentInstanceKey: () => {},
    evaluateSkipCondition: () => false,
    postMessage: () => {},
    scheduleSave: () => {},
    warn: () => {},
    debugLog: () => {},
    primaryOutputKey: (s) => s.outputs[0].key,
    ensureTaskDir: () => {},
    resolveInput: async () => '',
    executeLlmText: async (stageId) => {
      executed.push(stageId);
      return `ok:${stageId}`;
    },
    applyPatchInstructions: async () => {},
    resolveTaskFilePath: (_i, p) => p,
    resolveOutputPath: (_i, p) => p,
    runCodeRunner: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    isCancellationError: () => false,
    enableDagScheduler: true,
    dagMaxParallelism: 1,
  });

  assert.deepEqual(executed, ['stage_a', 'stage_b', 'stage_c']);
});

