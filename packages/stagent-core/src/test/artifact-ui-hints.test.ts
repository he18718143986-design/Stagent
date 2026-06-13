import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { Artifact } from '../ArtifactLifecycleManager';
import {
  collectStageArtifactHints,
  findStageArtifact,
  formatDownstreamResetPanelLines,
  formatGlobalConfigSummaryForConfirm,
  resolveStageArtifactAbsPath,
} from '../ArtifactUiHints';
import type { Stage } from '../WorkflowDefinition';

test('formatGlobalConfigSummaryForConfirm includes key fields', () => {
  const lines = formatGlobalConfigSummaryForConfirm({
    enableDagScheduler: true,
    dagMaxParallelism: 2,
    globalDecisionInjectMode: 'summary',
    enableDecisionContentLint: true,
  });
  assert.ok(lines.some((l) => l.includes('DAG 调度：开启')));
  assert.ok(lines.some((l) => l.includes('DAG 并行度：2')));
  assert.ok(lines.some((l) => l.includes('决策注入模式：summary')));
  assert.ok(lines.some((l) => l.includes('决策内容 HARD 校验：开启')));
});

test('collectStageArtifactHints merges registry and stage config', () => {
  const stage: Stage = {
    id: 'stage_impl',
    title: 'Impl',
    tool: 'llm-text',
    toolConfig: {
      type: 'llm-text',
      systemPrompt: 'x',
      writeOutputToFile: 'src/App.tsx',
      writePathBase: 'workspace',
    },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'main', format: 'text' }],
    pauseAfter: true,
  };
  const registry: Artifact[] = [
    {
      stageId: 'stage_impl',
      outputKey: 'main',
      filePath: '/tmp/ws/src/App.tsx',
      state: 'persisted',
      checksum: 'abc',
      createdAt: '2026-01-01T00:00:00.000Z',
      existedBefore: true,
      priorContent: 'old',
    },
  ];
  const hints = collectStageArtifactHints(registry, stage);
  assert.equal(hints.length, 1);
  assert.equal(hints[0].canDiff, true);
  assert.equal(hints[0].state, 'persisted');
});

test('formatDownstreamResetPanelLines lists stages and rolled back files', () => {
  const lines = formatDownstreamResetPanelLines({
    resetStageTitles: ['实现 A', '实现 B'],
    rolledBackFiles: ['/tmp/a.ts', '/tmp/b.ts'],
  });
  assert.ok(lines.some((l) => l.includes('实现 A')));
  assert.ok(lines.some((l) => l.includes('已回滚文件')));
  assert.ok(lines.some((l) => l.includes('/tmp/a.ts')));
});

test('resolveStageArtifactAbsPath prefers registry absolute path', () => {
  const stage: Stage = {
    id: 's1',
    title: 'S',
    tool: 'llm-text',
    toolConfig: { type: 'llm-text', systemPrompt: 'x', writeOutputToFile: 'pkg.json' },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'main', format: 'text' }],
    pauseAfter: true,
  };
  const registry: Artifact[] = [
    {
      stageId: 's1',
      outputKey: 'main',
      filePath: '/abs/pkg.json',
      state: 'persisted',
      checksum: 'x',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ];
  const abs = resolveStageArtifactAbsPath(stage, 'pkg.json', registry, (rel) => `/fallback/${rel}`);
  assert.equal(abs, '/abs/pkg.json');
  assert.ok(findStageArtifact(registry, 's1', 'pkg.json'));
});
