import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveWorkspaceFirstReadablePath } from '../WorkflowExecutor';

test('file-read path: workspace file takes priority over taskDir', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-read-path-'));
  const wsRoot = path.join(tmp, 'workspace');
  const taskRoot = path.join(tmp, 'task');
  fs.mkdirSync(path.join(wsRoot, 'src'), { recursive: true });
  fs.mkdirSync(path.join(taskRoot, 'src'), { recursive: true });

  const rel = 'src/WorkflowDefinition.ts';
  const wsFile = path.join(wsRoot, rel);
  const taskFile = path.join(taskRoot, rel);
  fs.writeFileSync(wsFile, 'workspace-version', 'utf-8');
  fs.writeFileSync(taskFile, 'taskdir-version', 'utf-8');

  const resolved = resolveWorkspaceFirstReadablePath('ik', rel, wsRoot, (_ik, rp) => path.join(taskRoot, rp));
  assert.equal(resolved, wsFile);
});

test('file-read path: fallback to taskDir when workspace missing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-read-path-'));
  const wsRoot = path.join(tmp, 'workspace');
  const taskRoot = path.join(tmp, 'task');
  fs.mkdirSync(taskRoot, { recursive: true });

  const rel = 'src/WorkflowDefinition.ts';
  const expected = path.join(taskRoot, rel);
  const resolved = resolveWorkspaceFirstReadablePath('ik', rel, wsRoot, (_ik, rp) => path.join(taskRoot, rp));
  assert.equal(resolved, expected);
});
