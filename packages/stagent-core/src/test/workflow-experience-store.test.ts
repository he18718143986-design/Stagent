import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  WorkflowExperienceStore,
  buildWorkflowExperience,
  hashUserInput,
  resolveExperienceStorePath,
  type WorkflowExperience,
} from '../WorkflowExperienceStore';
import type { WorkflowDefinition, WorkflowInstance } from '../WorkflowDefinition';
import { CONFIDENCE_OUTPUT_KEY } from '../ConfidenceScorer';

function tempStorePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-exp-'));
  return path.join(dir, 'experiences.jsonl');
}

function sampleInstance(): WorkflowInstance {
  const wf: WorkflowDefinition = {
    id: 'wf_demo',
    version: '2.0',
    meta: {
      title: 'demo',
      taskType: 'software',
      userInput: 'build a todo scanner',
      createdAt: '2026-05-28T00:00:00.000Z',
      taskWorkspacePath: '/tmp/ws',
    },
    stages: [
      {
        id: 'stage_decide_x',
        title: 'decide',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'x'.repeat(30) },
        input: { sources: [], mergeStrategy: 'concat' },
        outputs: [{ key: 'decisionRecord', format: 'markdown' }],
        pauseAfter: true,
        isDecisionStage: true,
      },
      {
        id: 'stage_impl_x',
        title: 'impl',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'x'.repeat(30) },
        input: { sources: [], mergeStrategy: 'concat' },
        outputs: [{ key: 'code', format: 'markdown' }],
        pauseAfter: false,
      },
    ],
  };
  return {
    traceId: 'trace_1',
    definition: wf,
    currentStageIndex: 1,
    stageRuntimes: [
      {
        stageId: 'stage_decide_x',
        status: 'done',
        outputs: { decisionRecord: 'ok' },
        retryCount: 1,
        approvedDecisionRecord: 'ok',
        startedAt: '2026-05-28T00:00:00.000Z',
        completedAt: '2026-05-28T00:01:00.000Z',
      },
      {
        stageId: 'stage_impl_x',
        status: 'done',
        outputs: {
          code: '```ts\nx\n```',
          [CONFIDENCE_OUTPUT_KEY]: { score: 0.88, level: 'high', reasons: [] },
        },
        retryCount: 0,
        startedAt: '2026-05-28T00:01:00.000Z',
        completedAt: '2026-05-28T00:02:30.000Z',
      },
    ],
    status: 'completed',
    startedAt: '2026-05-28T00:00:00.000Z',
    completedAt: '2026-05-28T00:02:30.000Z',
  };
}

test('hashUserInput is stable and does not echo plaintext', () => {
  const a = hashUserInput('hello');
  const b = hashUserInput('hello');
  const c = hashUserInput('hello!');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(a.length, 64);
});

test('resolveExperienceStorePath under workspace .stagent', () => {
  assert.equal(
    resolveExperienceStorePath('/proj/task'),
    path.join('/proj/task', '.stagent', 'experiences.jsonl'),
  );
});

test('append + readAll round-trip', async () => {
  const storePath = tempStorePath();
  const store = new WorkflowExperienceStore(storePath);
  const exp = buildWorkflowExperience(sampleInstance(), {
    completionStatus: 'completed',
    instanceKey: 'inst-1',
    id: 'exp-1',
    timestamp: '2026-05-28T00:03:00.000Z',
  });
  await store.append(exp);
  const all = store.readAll();
  assert.equal(all.length, 1);
  assert.equal(all[0].id, 'exp-1');
  assert.equal(all[0].userInputHash, hashUserInput('build a todo scanner'));
  assert.equal(all[0].stageOutcomes?.length, 2);
  assert.equal(all[0].stageOutcomes?.[1].confidenceScore, 0.88);
  assert.ok((all[0].humanInterventions ?? 0) >= 2);
});

test('query filters by taskType and completionStatus', async () => {
  const storePath = tempStorePath();
  const store = new WorkflowExperienceStore(storePath);
  const base: WorkflowExperience = {
    id: '1',
    timestamp: 't1',
    taskType: 'software',
    completionStatus: 'completed',
  };
  await store.append({ ...base, id: 'a' });
  await store.append({ ...base, id: 'b', taskType: 'debug', completionStatus: 'failed' });
  const software = await store.query({ taskType: 'software', completionStatus: 'completed' });
  assert.equal(software.length, 1);
  assert.equal(software[0].id, 'a');
});

test('FIFO evicts oldest when maxEntries exceeded', async () => {
  const storePath = tempStorePath();
  const store = new WorkflowExperienceStore(storePath, 2);
  await store.append({ id: 'old', timestamp: '1', completionStatus: 'completed' });
  await store.append({ id: 'mid', timestamp: '2', completionStatus: 'completed' });
  await store.append({ id: 'new', timestamp: '3', completionStatus: 'completed' });
  const all = store.readAll();
  assert.deepEqual(
    all.map((e) => e.id),
    ['mid', 'new'],
  );
});

test('getFailurePatterns aggregates failed runs', async () => {
  const storePath = tempStorePath();
  const store = new WorkflowExperienceStore(storePath);
  await store.append({
    id: 'f1',
    timestamp: 't',
    taskType: 'software',
    completionStatus: 'failed',
    failureStageId: 'stage_impl_x',
    failureErrorType: 'tool-execution-failed',
  });
  await store.append({
    id: 'f2',
    timestamp: 't2',
    taskType: 'software',
    completionStatus: 'failed',
    failureStageId: 'stage_impl_x',
    failureErrorType: 'tool-execution-failed',
  });
  const patterns = await store.getFailurePatterns('software', 'stage_impl_');
  assert.equal(patterns.length, 1);
  assert.equal(patterns[0].frequency, 2);
  assert.equal(patterns[0].errorType, 'tool-execution-failed');
});
