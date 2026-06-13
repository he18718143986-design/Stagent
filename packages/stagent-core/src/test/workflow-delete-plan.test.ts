import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'path';
import { buildDeletionTargets } from '../WorkflowDeletePlan';
import { REQUIREMENT_DOC_FILE, WORKFLOW_PLAN_DOC_FILE } from '../WorkflowProcessDocs';
import type { WorkflowInstance } from '../WorkflowDefinition';

const WS = path.resolve('/tmp/stagent-task-A');

function makeInstance(): WorkflowInstance {
  return {
    definition: {
      id: 'wf',
      version: '2.0',
      meta: { title: 't', taskType: 'prototype', userInput: 'x', createdAt: '', taskWorkspacePath: WS },
      stages: [],
    },
    currentStageIndex: 0,
    stageRuntimes: [],
    status: 'completed',
    taskDir: path.join(WS, '.stagent', 'instances', 'id1'),
    artifactRegistry: [
      { stageId: 's1', outputKey: 'o', filePath: path.join(WS, 'a.py'), state: 'persisted', checksum: 'c', createdAt: '', existedBefore: false },
      { stageId: 's2', outputKey: 'o', filePath: path.join(WS, 'keep.py'), state: 'persisted', checksum: 'c', createdAt: '', existedBefore: true },
      { stageId: 's3', outputKey: 'o', filePath: path.join(WS, '.stagent', 'instances', 'id1', 'inst.txt'), state: 'persisted', checksum: 'c', createdAt: '', existedBefore: false },
    ],
  } as unknown as WorkflowInstance;
}

test('record 档不返回任何待删文件/目录', () => {
  const t = buildDeletionTargets(makeInstance(), 'record');
  assert.deepEqual(t, { files: [], dirs: [], rejected: [] });
});

test('artifacts 档只删 existedBefore=false 的产物 + 两份过程文档，保留已存在文件', () => {
  const t = buildDeletionTargets(makeInstance(), 'artifacts');
  assert.ok(t.files.includes(path.join(WS, 'a.py')));
  assert.ok(t.files.includes(path.join(WS, '.stagent', 'instances', 'id1', 'inst.txt')));
  assert.ok(!t.files.includes(path.join(WS, 'keep.py')));
  assert.ok(t.files.includes(path.join(WS, REQUIREMENT_DOC_FILE)));
  assert.ok(t.files.includes(path.join(WS, WORKFLOW_PLAN_DOC_FILE)));
  assert.equal(t.dirs.length, 0);
});

test('artifacts 档拒绝任务根之外的绝对路径', () => {
  const inst = makeInstance();
  inst.artifactRegistry = [
    { stageId: 's', outputKey: 'o', filePath: '/etc/passwd', state: 'persisted', checksum: 'c', createdAt: '', existedBefore: false },
  ] as WorkflowInstance['artifactRegistry'];
  const t = buildDeletionTargets(inst, 'artifacts');
  assert.ok(!t.files.includes('/etc/passwd'));
  assert.ok(t.rejected.some((r) => r.path === '/etc/passwd' && r.reason === 'outside-task-roots'));
});

test('folder 档返回整个工作目录', () => {
  const t = buildDeletionTargets(makeInstance(), 'folder');
  assert.deepEqual(t.dirs, [WS]);
  assert.equal(t.files.length, 0);
});

test('folder 档护栏：拒绝家目录 / 文件系统根 / 过浅路径', () => {
  const home = buildDeletionTargets(
    { ...makeInstance(), definition: { ...makeInstance().definition, meta: { ...makeInstance().definition.meta, taskWorkspacePath: '/Users/me' } } } as WorkflowInstance,
    'folder',
    { homeDir: '/Users/me' },
  );
  assert.equal(home.dirs.length, 0);
  assert.ok(home.rejected.some((r) => r.reason === 'is-home-dir'));

  const root = buildDeletionTargets(
    { ...makeInstance(), definition: { ...makeInstance().definition, meta: { ...makeInstance().definition.meta, taskWorkspacePath: '/' } } } as WorkflowInstance,
    'folder',
  );
  assert.ok(root.rejected.some((r) => r.reason === 'is-filesystem-root'));

  const shallow = buildDeletionTargets(
    { ...makeInstance(), definition: { ...makeInstance().definition, meta: { ...makeInstance().definition.meta, taskWorkspacePath: '/onlyone' } } } as WorkflowInstance,
    'folder',
    { minFolderDepth: 2 },
  );
  assert.ok(shallow.rejected.some((r) => r.reason === 'path-too-shallow'));
});

test('folder 档无 taskWorkspacePath 时拒绝', () => {
  const inst = makeInstance();
  delete (inst.definition.meta as { taskWorkspacePath?: string }).taskWorkspacePath;
  const t = buildDeletionTargets(inst, 'folder');
  assert.equal(t.dirs.length, 0);
  assert.ok(t.rejected.some((r) => r.reason === 'no-task-workspace-path'));
});
