import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { WorkflowInstance } from '../WorkflowDefinition';
import { resolveInstanceLoadSync } from '../WorkflowInstancePersistenceSync';
import {
  instanceDiskStateFileExists,
  persistInstanceFile,
  readInstanceFile,
  resolveInstanceTaskDir,
} from '../WorkflowPersistence';

function makeInstance(overrides?: Partial<WorkflowInstance>): WorkflowInstance {
  return {
    definition: {
      id: 'wf',
      version: '2.0',
      meta: {
        title: 't',
        taskType: 'prototype',
        userInput: 'u',
        createdAt: new Date().toISOString(),
        taskWorkspacePath: overrides?.definition?.meta?.taskWorkspacePath,
      },
      stages: [],
    },
    currentStageIndex: 0,
    stageRuntimes: [],
    status: 'paused',
    taskDir: overrides?.taskDir,
    ...overrides,
  };
}

test('resolveInstanceLoadSync purges global when disk state file missing', () => {
  const gs = makeInstance();
  const out = resolveInstanceLoadSync({
    globalStateInstance: gs,
    diskInstance: undefined,
    diskStateFileExists: false,
  });
  assert.equal(out.kind, 'purge_global');
});

test('resolveInstanceLoadSync loads disk-only and promotes to globalState', () => {
  const file = makeInstance();
  const out = resolveInstanceLoadSync({
    globalStateInstance: undefined,
    diskInstance: file,
    diskStateFileExists: true,
  });
  assert.equal(out.kind, 'loaded');
  if (out.kind === 'loaded') {
    assert.equal(out.promoteToGlobalState, true);
    assert.equal(out.instance, file);
  }
});

test('resolveInstanceLoadSync prefers globalState when disk state exists', () => {
  const gs = makeInstance({ status: 'running' });
  const file = makeInstance({ status: 'paused' });
  const out = resolveInstanceLoadSync({
    globalStateInstance: gs,
    diskInstance: file,
    diskStateFileExists: true,
  });
  assert.equal(out.kind, 'loaded');
  if (out.kind === 'loaded') {
    assert.equal(out.promoteToGlobalState, false);
    assert.equal(out.instance.status, 'running');
  }
});

test('instanceDiskStateFileExists false after user deletes task workspace tree', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-persist-'));
  const ws = path.join(root, 'proj');
  const gsPath = path.join(root, 'gs');
  fs.mkdirSync(ws, { recursive: true });
  const instanceKey = 'ab99b1e4-test';
  const inst = makeInstance({
    definition: {
      id: 'wf',
      version: '2.0',
      meta: {
        title: 't',
        taskType: 'prototype',
        userInput: 'u',
        createdAt: new Date().toISOString(),
        taskWorkspacePath: ws,
      },
      stages: [],
    },
  });
  persistInstanceFile(instanceKey, inst, ws, gsPath);
  assert.equal(
    instanceDiskStateFileExists(
      instanceKey,
      { taskWorkspacePath: ws },
      undefined,
      gsPath,
    ),
    true,
  );
  fs.rmSync(ws, { recursive: true, force: true });
  assert.equal(
    instanceDiskStateFileExists(
      instanceKey,
      { taskWorkspacePath: ws },
      undefined,
      gsPath,
    ),
    false,
  );
  assert.equal(readInstanceFile(instanceKey, ws, gsPath), undefined);
});

test('resolveInstanceTaskDir uses meta.taskWorkspacePath when taskDir unset', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-dir-'));
  const ws = path.join(root, 'task-web');
  const instanceKey = 'id-1';
  const dir = resolveInstanceTaskDir(
    instanceKey,
    { taskWorkspacePath: ws },
    undefined,
    path.join(root, 'gs'),
  );
  assert.equal(dir, path.join(path.resolve(ws), '.stagent', 'instances', instanceKey));
});
