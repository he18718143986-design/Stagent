import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  expandUserHomePath,
  getReadableProjectRoots,
  pickZoomOutFilePath,
  resolveExistingDirectoryPath,
  resolveInitialTaskDir,
  pinTaskWorkspacePathAbsolute,
  resolveWorkspaceRootAbsolute,
  safeJoinUnderWorkspaceRoot,
  workspaceRootFromTaskDir,
} from '../WorkflowPathResolver';
import type { WorkflowDefinition } from '../WorkflowDefinition';

test('expandUserHomePath expands ~ and ~/x, leaves others', () => {
  assert.equal(expandUserHomePath('~'), os.homedir());
  assert.equal(expandUserHomePath('~/proj'), path.join(os.homedir(), 'proj'));
  assert.equal(expandUserHomePath('/abs/path'), '/abs/path');
  assert.equal(expandUserHomePath('  relative  '), 'relative');
});

test('resolveExistingDirectoryPath rejects empty and missing', () => {
  const empty = resolveExistingDirectoryPath('   ');
  assert.equal(empty.ok, false);
  const missing = resolveExistingDirectoryPath('/no/such/dir/xyz-123');
  assert.equal(missing.ok, false);
});

test('resolveExistingDirectoryPath accepts an existing directory', () => {
  const res = resolveExistingDirectoryPath(os.tmpdir());
  assert.equal(res.ok, true);
  assert.equal((res as { ok: true; abs: string }).abs, path.resolve(os.tmpdir()));
});

test('resolveInitialTaskDir uses taskWorkspacePath when valid', () => {
  const wf = {
    meta: { taskWorkspacePath: os.tmpdir() },
  } as unknown as WorkflowDefinition;
  const res = resolveInitialTaskDir('inst1', wf, undefined, '/global/storage');
  assert.equal(res.ok, true);
  assert.equal(
    (res as { ok: true; dir: string }).dir,
    path.join(path.resolve(os.tmpdir()), '.stagent', 'instances', 'inst1'),
  );
});

test('resolveInitialTaskDir fails without workspace and without taskWorkspacePath', () => {
  const wf = { meta: {} } as unknown as WorkflowDefinition;
  const res = resolveInitialTaskDir('inst1', wf, undefined, '/global/storage');
  assert.equal(res.ok, false);
});

test('resolveInitialTaskDir falls back to workspace root', () => {
  const wf = { meta: {} } as unknown as WorkflowDefinition;
  const res = resolveInitialTaskDir('inst1', wf, '/ws/root', '/global/storage');
  assert.equal(res.ok, true);
  assert.ok((res as { ok: true; dir: string }).dir.includes('inst1'));
});

test('resolveWorkspaceRootAbsolute resolves ~ and returns undefined when empty', () => {
  assert.equal(resolveWorkspaceRootAbsolute(undefined), undefined);
  assert.equal(resolveWorkspaceRootAbsolute('   '), undefined);
  assert.equal(resolveWorkspaceRootAbsolute('/a/b'), path.resolve('/a/b'));
});

test('workspaceRootFromTaskDir derives workspace from instance taskDir', () => {
  const ws = '/Users/me/proj';
  const taskDir = path.join(ws, '.stagent', 'instances', 'uuid-1');
  assert.equal(workspaceRootFromTaskDir(taskDir), ws);
  assert.equal(workspaceRootFromTaskDir('/tmp/not-stagent'), undefined);
});

test('pinTaskWorkspacePathAbsolute anchors relative path to taskDir workspace', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'pin-ws-'));
  const child = path.join(ws, 'child');
  fs.mkdirSync(child, { recursive: true });
  const taskDir = path.join(ws, '.stagent', 'instances', 'id-1');
  fs.mkdirSync(taskDir, { recursive: true });
  assert.equal(pinTaskWorkspacePathAbsolute('child', taskDir), path.resolve(child));
  assert.equal(pinTaskWorkspacePathAbsolute('../missing', taskDir), path.resolve(ws, '../missing'));
});

test('safeJoinUnderWorkspaceRoot blocks .. escape and joins valid', () => {
  assert.equal(safeJoinUnderWorkspaceRoot('/root', 'sub/x.txt'), path.resolve('/root', 'sub/x.txt'));
  assert.throws(() => safeJoinUnderWorkspaceRoot('/root', '../escape.txt'), /逃出工作区根目录/);
});

test('getReadableProjectRoots includes workspace root and cwd, deduped', () => {
  const roots = getReadableProjectRoots('/ws');
  assert.ok(roots.includes('/ws'));
  assert.ok(roots.includes(process.cwd()));
  const noWs = getReadableProjectRoots(undefined);
  assert.ok(noWs.includes(process.cwd()));
});

test('pickZoomOutFilePath returns first existing candidate, else fallback', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zoomout-'));
  fs.writeFileSync(path.join(tmpRoot, 'tsconfig.json'), '{}');
  assert.equal(pickZoomOutFilePath([tmpRoot]), 'tsconfig.json');
  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zoomout-empty-'));
  assert.equal(pickZoomOutFilePath([emptyRoot]), 'package.json');
  assert.equal(pickZoomOutFilePath([emptyRoot], 'custom.txt'), 'custom.txt');
});
