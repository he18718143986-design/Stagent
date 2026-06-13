import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { setupWebviewScriptRuntime } from './webview-script-test-harness';

test('generate workflow click shows busy panel and disables buttons', () => {
  const rt = setupWebviewScriptRuntime(true);
  const workspace = rt.document.getElementById('task-workspace-path');
  const userInput = rt.document.getElementById('user-input');
  const btnGen = rt.document.getElementById('btn-gen');
  const btnPolish = rt.document.getElementById('btn-polish');
  assert.ok(workspace && userInput && btnGen && btnPolish);

  rt.document.getElementById('task-workspace-path')!.value = '/tmp/ws';
  rt.document.getElementById('user-input')!.value = '做一个 todo MVP';
  rt.send({ type: 'taskWorkspacePathPicked', path: '/tmp/ws' });
  rt.document.getElementById('btn-gen')!.onclick?.();

  const panel = rt.document.getElementById('gen-status-panel');
  const title = rt.document.getElementById('gen-status-title');
  assert.ok(panel && title);
  // 点击后先进入生成前澄清阶段（忙碌面板已显示、按钮禁用）。
  assert.equal(panel.style.display, 'flex');
  assert.equal(title.textContent, '正在分析需求');
  assert.equal(btnGen.disabled, true);
  assert.equal(btnPolish.disabled, true);
  const clarifyMsg = rt.postMessages.find((m) => (m as { type?: string }).type === 'clarifyStart');
  assert.ok(clarifyMsg, '点击生成应先发起 clarifyStart');

  // 后端返回空澄清问题 → 直接进入生成。
  rt.send({ type: 'clarifyQuestions', questions: [] });
  assert.equal(title.textContent, '正在生成工作流');

  const genMsg = rt.postMessages.find((m) => (m as { type?: string }).type === 'generateWorkflow') as
    | { taskType?: string }
    | undefined;
  assert.ok(genMsg);
  assert.equal(genMsg!.taskType, 'auto');
});

test('generationProgress updates title and stream char suffix', () => {
  const rt = setupWebviewScriptRuntime(true);
  rt.document.getElementById('task-workspace-path')!.value = '/tmp/ws';
  rt.document.getElementById('btn-gen')!.onclick?.();

  rt.send({
    type: 'generationProgress',
    operation: 'workflow',
    phase: 'llm',
    message: '正在调用模型',
    detail: '等待首 token…',
  });

  assert.equal(rt.document.getElementById('gen-status-title')!.textContent, '正在调用模型');
  assert.equal(rt.document.getElementById('gen-status-detail')!.textContent, '等待首 token…');

  rt.send({ type: 'streamChunk', stageId: 'workflow-gen', chunk: 'abc' });
  assert.equal(rt.document.getElementById('gen-stream')!.textContent, 'abc');
  const detailAfterOne = rt.document.getElementById('gen-status-detail')!.textContent;
  assert.ok(detailAfterOne.includes('已接收约 3 字'));
  assert.equal((detailAfterOne.match(/已接收约/g) || []).length, 1);

  rt.send({ type: 'streamChunk', stageId: 'workflow-gen', chunk: 'defgh' });
  const detailAfterTwo = rt.document.getElementById('gen-status-detail')!.textContent;
  assert.ok(detailAfterTwo.includes('已接收约 8 字'));
  assert.equal((detailAfterTwo.match(/已接收约/g) || []).length, 1);
});

test('workflowFailed shows error panel and re-enables buttons', () => {
  const rt = setupWebviewScriptRuntime(true);
  rt.document.getElementById('task-workspace-path')!.value = '/tmp/ws';
  rt.document.getElementById('user-input')!.value = '做一个 todo MVP';
  rt.document.getElementById('btn-gen')!.onclick?.();

  rt.send({ type: 'workflowFailed', reason: 'LLM 超时' });

  const panel = rt.document.getElementById('gen-status-panel')!;
  assert.equal(panel.style.display, 'flex');
  assert.ok(panel.className.includes('error'));
  assert.equal(rt.document.getElementById('gen-status-title')!.textContent, '处理失败');
  assert.equal(rt.document.getElementById('gen-status-detail')!.textContent, 'LLM 超时');
  assert.equal(rt.document.getElementById('btn-gen')!.disabled, false);
});

test('workflowFailed shows 重新生成 button that resends generateWorkflow without re-editing', () => {
  const rt = setupWebviewScriptRuntime(true);
  rt.document.getElementById('task-workspace-path')!.value = '/tmp/ws';
  rt.document.getElementById('user-input')!.value = '做一个 todo MVP';
  rt.document.getElementById('btn-gen')!.onclick?.();

  rt.send({ type: 'workflowFailed', reason: '无法从模型输出中解析 JSON' });

  const btnRegen = rt.document.getElementById('btn-regenerate')!;
  assert.equal(btnRegen.style.display, '', '失败后应显示「重新生成」按钮');

  const genCountBefore = rt.postMessages.filter(
    (m) => (m as { type?: string }).type === 'generateWorkflow',
  ).length;
  btnRegen.onclick?.();
  const genMsgs = rt.postMessages.filter(
    (m) => (m as { type?: string }).type === 'generateWorkflow',
  );
  assert.equal(genMsgs.length, genCountBefore + 1, '点击「重新生成」应再发一次 generateWorkflow');
  assert.equal(
    (genMsgs[genMsgs.length - 1] as { userInput?: string }).userInput,
    '做一个 todo MVP',
    '重新生成应复用已提交的需求，无需重新编辑',
  );
});

test('workflowGenerated clears busy state', () => {
  const rt = setupWebviewScriptRuntime(true);
  rt.document.getElementById('task-workspace-path')!.value = '/tmp/ws';
  rt.document.getElementById('btn-gen')!.onclick?.();

  const workflow = {
    id: 'wf_gen',
    version: '2.0',
    meta: { title: 'gen', taskType: 'software', userInput: 'x', createdAt: new Date().toISOString() },
    stages: [{ id: 's1', title: 'S1' }],
  };
  rt.send({ type: 'workflowGenerated', workflow, warnings: [] });

  assert.equal(rt.document.getElementById('gen-status-panel')!.style.display, 'none');
  assert.equal(rt.document.getElementById('btn-gen')!.disabled, false);
});
