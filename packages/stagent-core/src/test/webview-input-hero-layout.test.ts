import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildWorkflowWebviewHtml } from '../WebviewPanel';
import { setupWebviewScriptRuntime } from './webview-script-test-harness';

test('input-chat-layout does not override hidden view display', () => {
  const html = buildWorkflowWebviewHtml({ cspSource: 'vscode-test' } as never);
  const bareRules = html.match(/^\s*\.input-chat-layout\s*\{[^}]+\}/gm) ?? [];
  assert.ok(bareRules.length >= 1);
  for (const rule of bareRules) {
    assert.equal(rule.includes('display:'), false, rule);
  }
  assert.match(html, /\.view\.active\.input-chat-layout\s*\{[^}]*display:\s*flex/);
});

test('input actions hidden until requirement and workspace path are both filled', () => {
  const rt = setupWebviewScriptRuntime(true);
  const actions = rt.document.getElementById('input-actions')!;
  assert.equal(actions.style.display, 'none');

  rt.document.getElementById('user-input')!.value = '做一个 MVP';
  assert.equal(actions.style.display, 'none');

  rt.send({ type: 'taskWorkspacePathPicked', path: '/tmp/ws' });
  assert.equal(actions.style.display, 'flex');
});

test('polish commits user text to history bubble and hides composer dock', () => {
  const rt = setupWebviewScriptRuntime(true);
  rt.document.getElementById('user-input')!.value = '口语草稿';
  rt.send({ type: 'taskWorkspacePathPicked', path: '/tmp/ws' });

  rt.document.getElementById('btn-polish')!.onclick?.();
  const polishMsg = rt.postMessages.find((m) => (m as { type?: string }).type === 'polishUserTask') as
    | { taskType?: string }
    | undefined;
  assert.ok(polishMsg);
  assert.equal(polishMsg!.taskType, 'auto');
  assert.equal(rt.document.getElementById('chat-history')!.style.display, 'flex');
  assert.equal(rt.document.getElementById('composer-dock')!.style.display, 'none');
  assert.equal(rt.document.getElementById('user-message-bubble')!.textContent, '口语草稿');
  assert.equal(rt.document.getElementById('polish-assistant')!.style.display, 'flex');
  assert.equal(rt.document.getElementById('input-chat-shell')!.className.includes('has-history'), true);

  rt.send({ type: 'userTaskPolished', text: '规范用户任务', polishedAt: new Date().toISOString() });
  const edit = rt.document.getElementById('polish-result-edit')!;
  assert.equal(edit.value, '规范用户任务');

  edit.value = '规范用户任务（人工微调）';
  rt.document.getElementById('btn-polish-apply')!.onclick?.();
  assert.equal(rt.document.getElementById('user-input')!.value, '规范用户任务（人工微调）');
  assert.equal(rt.document.getElementById('composer-dock')!.style.display, 'block');
  assert.equal(rt.document.getElementById('chat-history')!.style.display, 'flex');
  assert.equal(rt.document.getElementById('polish-assistant')!.style.display, 'none');
});

test('polish modify restores composer dock with original draft', () => {
  const rt = setupWebviewScriptRuntime(true);
  rt.document.getElementById('user-input')!.value = '口语草稿';
  rt.send({ type: 'taskWorkspacePathPicked', path: '/tmp/ws' });
  rt.document.getElementById('btn-polish')!.onclick?.();
  rt.document.getElementById('btn-polish-collapse')!.onclick?.();
  assert.equal(rt.document.getElementById('composer-dock')!.style.display, 'block');
  assert.equal(rt.document.getElementById('user-input')!.value, '口语草稿');
  assert.equal(rt.document.getElementById('chat-history')!.style.display, 'none');
});

test('generate workflow commits user bubble and hides composer dock', () => {
  const rt = setupWebviewScriptRuntime(true);
  rt.document.getElementById('user-input')!.value = '生成任务';
  rt.send({ type: 'taskWorkspacePathPicked', path: '/tmp/ws' });
  rt.document.getElementById('btn-gen')!.onclick?.();
  // 生成前先发起澄清；后端返回空问题后进入生成。
  rt.send({ type: 'clarifyQuestions', questions: [] });
  const genMsg = rt.postMessages.find((m) => (m as { type?: string }).type === 'generateWorkflow') as
    | { taskType?: string }
    | undefined;
  assert.ok(genMsg);
  assert.equal(genMsg!.taskType, 'auto');
  assert.equal(rt.document.getElementById('chat-history')!.style.display, 'flex');
  assert.equal(rt.document.getElementById('composer-dock')!.style.display, 'none');
  assert.equal(rt.document.getElementById('user-message-bubble')!.textContent, '生成任务');
  assert.equal(rt.document.getElementById('gen-status-panel')!.style.display, 'flex');
});

test('workflowGenerated navigates to confirm view', () => {
  const rt = setupWebviewScriptRuntime(true);
  rt.document.getElementById('user-input')!.value = '任务';
  rt.send({ type: 'taskWorkspacePathPicked', path: '/tmp/ws' });

  const workflow = {
    id: 'wf_hero',
    version: '2.0',
    meta: { title: 'hero', taskType: 'prototype', userInput: '任务', createdAt: new Date().toISOString() },
    stages: [{ id: 's1', title: 'S1' }],
  };
  rt.send({ type: 'workflowGenerated', workflow, warnings: [] });

  assert.equal(rt.document.getElementById('view-confirm')!.className.includes('active'), true);
  assert.equal(rt.document.getElementById('view-input')!.className.includes('active'), false);
});
