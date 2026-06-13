import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { executeNonLlmTool } from '../WorkflowExecutor';
import type { Stage, StageRuntime, WorkflowInstance } from '../WorkflowDefinition';

function makeRuntime(stageId: string): StageRuntime {
  return {
    stageId,
    status: 'pending',
    retryCount: 0,
    outputs: {},
  };
}

test('stage_zoom_out file-read falls back instead of failing when file is missing', async () => {
  const stage: Stage = {
    id: 'stage_zoom_out',
    title: '读取模块地图',
    tool: 'file-read',
    toolConfig: { type: 'file-read', filePath: 'package.json' },
    input: { sources: [{ type: 'user-input', label: '需求' }], mergeStrategy: 'concat' },
    outputs: [{ key: 'moduleMap', format: 'markdown' }],
    pauseAfter: false,
  };
  const runtime = makeRuntime(stage.id);
  const instance = {
    definition: {
      id: 'wf',
      version: '2.0',
      meta: { title: 't', taskType: 'software', userInput: 'u', createdAt: new Date().toISOString() },
      stages: [stage],
    },
    currentStageIndex: 0,
    stageRuntimes: [runtime],
    status: 'running',
  } satisfies WorkflowInstance;

  const ok = await executeNonLlmTool({
    stage,
    runtime,
    outKey: 'moduleMap',
    instance,
    instanceKey: 'ik',
    resolveTaskFilePath: () => '/definitely/missing/path/package.json',
    resolveOutputPath: () => '/definitely/missing/path/package.json',
    runCodeRunner: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    stageIndex: 0,
  });

  assert.equal(ok, true);
  assert.equal(runtime.outputs._zoomOutFallback, true);
  assert.match(String(runtime.outputs.moduleMap ?? ''), /moduleMap \(fallback\)/);
  assert.match(String(runtime.outputs.moduleMap ?? ''), /file-not-found/);
});
