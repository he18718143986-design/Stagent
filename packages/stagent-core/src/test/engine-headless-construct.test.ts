import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { PlatformAdapter } from '../platform/PlatformAdapter';
import { createWorkflowEngineParts } from '../engine-wiring/createWorkflowEngineParts';

function makeMockPlatform(): PlatformAdapter {
  const state = new Map<string, unknown>();
  return {
    config: { get: () => undefined, getAll: () => ({}) },
    state: {
      get: <T>(key: string) => state.get(key) as T | undefined,
      set: (key: string, value: unknown) => {
        state.set(key, value);
      },
      keys: () => [...state.keys()],
    },
    paths: {
      workspaceRoot: () => undefined,
      globalStorageDir: () => '/tmp/stagent-test',
    },
    ui: { send: () => {}, onMessage: () => ({ dispose: () => {} }) },
    notify: {
      warn: async () => undefined,
      info: async () => undefined,
      error: async () => undefined,
    },
    dialog: { pickDirectory: async () => undefined },
    editor: { openFile: async () => {}, openDiff: async () => {} },
    shell: { openExternal: async () => {}, copyText: async () => {} },
    llm: { listModels: async () => [] },
  } as unknown as PlatformAdapter;
}

test('createWorkflowEngineParts constructs core + facades without host runtime', () => {
  const parts = createWorkflowEngineParts(makeMockPlatform());
  assert.ok(parts.state);
  assert.ok(parts.core);
  assert.ok(parts.facades.instances);
  assert.ok(parts.facades.generation);
  assert.ok(parts.facades.execution);
  assert.ok(parts.facades.hitl);
  assert.ok(parts.facades.artifacts);
  assert.equal(typeof parts.executeNextStageRef.fn, 'function');
  assert.equal(typeof parts.facades.execution.executeNextStage, 'function');
  assert.ok(parts.ui);
  assert.ok(parts.instanceManager);
  assert.ok(parts.instanceManager.lifecycle);
  assert.ok(parts.instanceManager.persistence);
  assert.ok(parts.internals);
  assert.ok(parts.diagnostics);
  assert.ok(parts.lifecycle);
});
