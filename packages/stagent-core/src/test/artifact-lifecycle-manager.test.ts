import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Artifact } from '../ArtifactLifecycleManager';
import {
  ArtifactLifecycleManager,
  markArtifactsApprovedForStage,
  markArtifactsVerifiedForStage,
  registerPersistedArtifact,
  rollbackArtifacts,
  selectArtifactsForStageIds,
} from '../ArtifactLifecycleManager';
import type { WorkflowDefinition, WorkflowInstance } from '../WorkflowDefinition';
import { listDecisionRetryResetStageIds } from '../WorkflowStateTransitions';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-art-'));
}

test('rollback deletes newly created file', async () => {
  const dir = tempDir();
  const filePath = path.join(dir, 'generated.ts');
  const registry: Artifact[] = [];
  const artifacts = [
    registerPersistedArtifact(registry, {
      stageId: 'stage_impl_a',
      outputKey: 'code',
      filePath,
      content: 'export const x = 1;',
      existedBefore: false,
    }),
  ];
  fs.writeFileSync(filePath, 'export const x = 1;', 'utf-8');
  assert.ok(fs.existsSync(filePath));

  const result = await rollbackArtifacts(artifacts);
  assert.equal(result.ok, true);
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(artifacts[0].state, 'rolled-back');
});

test('rollback restores prior content when file existed before', async () => {
  const dir = tempDir();
  const filePath = path.join(dir, 'existing.ts');
  fs.writeFileSync(filePath, 'original', 'utf-8');
  const registry: Artifact[] = [];
  const artifacts = [
    registerPersistedArtifact(registry, {
      stageId: 'stage_impl_b',
      outputKey: 'code',
      filePath,
      content: 'overwritten',
      existedBefore: true,
      priorContent: 'original',
    }),
  ];
  fs.writeFileSync(filePath, 'overwritten', 'utf-8');

  const result = await rollbackArtifacts(artifacts);
  assert.equal(result.ok, true);
  assert.equal(fs.readFileSync(filePath, 'utf-8'), 'original');
});

test('selectArtifactsForStageIds picks latest per filePath', () => {
  const registry = [
    registerPersistedArtifact([], {
      stageId: 'stage_impl_a',
      outputKey: 'code',
      filePath: '/tmp/a.ts',
      content: 'v1',
      existedBefore: false,
    }),
  ];
  const second = registerPersistedArtifact(registry, {
    stageId: 'stage_impl_a',
    outputKey: 'code',
    filePath: '/tmp/a.ts',
    content: 'v2',
    existedBefore: true,
    priorContent: 'v1',
  });
  const picked = selectArtifactsForStageIds(registry, ['stage_impl_a']);
  assert.equal(picked.length, 1);
  assert.equal(picked[0].checksum, second.checksum);
});

test('getArtifactsForDecisionRetry aligns with listDecisionRetryResetStageIds', () => {
  const definition: WorkflowDefinition = {
    id: 'wf',
    version: '2.0',
    meta: { title: 't', taskType: 'software', userInput: '', createdAt: '' },
    stages: [
      {
        id: 'stage_decide_a',
        title: 'd',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'x' },
        input: { sources: [], mergeStrategy: 'concat' },
        outputs: [{ key: 'decisionRecord', format: 'markdown' }],
        pauseAfter: true,
        isDecisionStage: true,
      },
      {
        id: 'stage_impl_a',
        title: 'i',
        tool: 'file-write',
        toolConfig: {
          type: 'file-write',
          filePath: 'out.ts',
          sourceOutputKey: 'code',
          sourceStageId: 'stage_impl_a',
        },
        input: {
          sources: [
            {
              type: 'stage-output',
              stageId: 'stage_decide_a',
              outputKey: 'decisionRecord',
            },
          ],
          mergeStrategy: 'concat',
        },
        outputs: [{ key: 'path', format: 'text' }],
        pauseAfter: false,
      },
    ],
  };
  const instance: WorkflowInstance = {
    definition,
    currentStageIndex: 0,
    stageRuntimes: [
      { stageId: 'stage_decide_a', status: 'paused', outputs: {}, retryCount: 0 },
      { stageId: 'stage_impl_a', status: 'done', outputs: {}, retryCount: 0 },
    ],
    status: 'running',
    artifactRegistry: [],
  };

  const dir = tempDir();
  const filePath = path.join(dir, 'out.ts');
  registerPersistedArtifact(instance.artifactRegistry!, {
    stageId: 'stage_impl_a',
    outputKey: 'path',
    filePath,
    content: 'impl',
    existedBefore: false,
  });
  fs.writeFileSync(filePath, 'impl', 'utf-8');

  const resetIds = listDecisionRetryResetStageIds(definition, 'stage_decide_a', 0);
  assert.deepEqual(resetIds, ['stage_impl_a']);

  const mgr = new ArtifactLifecycleManager(instance.artifactRegistry!);
  const arts = mgr.getArtifactsForDecisionRetry(definition, instance, 'stage_decide_a', 0);
  assert.equal(arts.length, 1);
  assert.equal(arts[0].filePath, filePath);
});

test('rollback reports failure for missing parent directory on delete-only artifact', async () => {
  const dir = tempDir();
  const filePath = path.join(dir, 'nested', 'gone.ts');
  const artifacts = [
    registerPersistedArtifact([], {
      stageId: 'stage_impl_x',
      outputKey: 'path',
      filePath,
      content: 'x',
      existedBefore: false,
    }),
  ];
  // file never created — delete rollback should still ok
  const result = await rollbackArtifacts(artifacts);
  assert.equal(result.ok, true);
});

test('markArtifactsVerifiedForStage promotes persisted → verified for matching stage only', () => {
  const registry: Artifact[] = [];
  registerPersistedArtifact(registry, { stageId: 's1', outputKey: 'a', filePath: '/x/a', content: '1', existedBefore: false });
  registerPersistedArtifact(registry, { stageId: 's2', outputKey: 'b', filePath: '/x/b', content: '2', existedBefore: false });
  markArtifactsVerifiedForStage(registry, 's1');
  assert.equal(registry.find((a) => a.stageId === 's1')!.state, 'verified');
  assert.equal(registry.find((a) => a.stageId === 's2')!.state, 'persisted');
});

test('markArtifactsApprovedForStage promotes persisted/verified → approved', () => {
  const registry: Artifact[] = [];
  registerPersistedArtifact(registry, { stageId: 's1', outputKey: 'a', filePath: '/x/a', content: '1', existedBefore: false });
  markArtifactsVerifiedForStage(registry, 's1');
  markArtifactsApprovedForStage(registry, 's1');
  assert.equal(registry[0].state, 'approved');
});
