import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildWorkflowWebviewHtml } from '../WebviewPanel';
import { setupWebviewScriptRuntime } from './webview-script-test-harness';

test('confirm page includes artifact list and stage cards containers', () => {
  const html = buildWorkflowWebviewHtml({ cspSource: 'vscode-test' } as never);
  assert.match(html, /id="plan-artifacts"/);
  assert.match(html, /id="plan-stage-cards"/);
  assert.match(html, /id="confirm-stats"/);
});

test('workflowGenerated renders artifact panel and stage cards', () => {
  const rt = setupWebviewScriptRuntime(true);
  const workflow = {
    id: 'wf_confirm',
    version: '2.0',
    meta: { title: 't', taskType: 'prototype', userInput: 'u', createdAt: new Date().toISOString() },
    stages: [
      {
        id: 'stage_decide_x',
        title: '[Phase 1] 架构决策',
        tool: 'llm-text',
        isDecisionStage: true,
        pauseAfter: true,
        aiTip: '核对模块边界',
        toolConfig: { type: 'llm-text', systemPrompt: 'x' },
        input: { sources: [], mergeStrategy: 'concat' },
        outputs: [{ key: 'decisionRecord', format: 'markdown' }],
      },
      {
        id: 'stage_impl_reader',
        title: '实现 reader',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'x', writeOutputToFile: 'reader.py' },
        input: { sources: [], mergeStrategy: 'concat' },
        outputs: [{ key: 'text', format: 'text' }],
        pauseAfter: false,
      },
      {
        id: 'stage_test_run_x',
        title: '验证',
        tool: 'code-runner',
        toolConfig: { type: 'code-runner', command: 'true', captureOutput: true },
        input: { sources: [], mergeStrategy: 'concat' },
        outputs: [{ key: 'log', format: 'text' }],
        pauseAfter: false,
      },
    ],
  };
  rt.send({ type: 'workflowGenerated', workflow, warnings: [] });

  const artifacts = rt.document.getElementById('plan-artifacts')!;
  assert.equal(artifacts.style.display, 'block');
  assert.ok(artifacts.innerHTML.includes('reader.py'));

  const cards = rt.document.getElementById('plan-stage-cards')!;
  assert.ok((cards.innerHTML.match(/plan-stage-card/g) || []).length >= 3);

  const stats = rt.document.getElementById('confirm-stats')!;
  assert.ok(stats.innerHTML.includes('prototype'));

  const detail = rt.document.getElementById('detail')!;
  assert.ok(detail.textContent?.includes('审核提示：核对模块边界'));
});

test('confirm page includes block banner and back button', () => {
  const html = buildWorkflowWebviewHtml({ cspSource: 'vscode-test' } as never);
  assert.match(html, /id="confirm-block"/);
  assert.match(html, /id="btn-back-input"/);
});

test('blocked workflowGenerated renders read-only confirm: disables start, shows reasons', () => {
  const rt = setupWebviewScriptRuntime(true);
  const workflow = {
    id: 'wf_blocked',
    version: '2.0',
    meta: { title: 't', taskType: 'prototype', userInput: 'u', createdAt: new Date().toISOString() },
    stages: [
      {
        id: 'stage_test_run_x',
        title: '验证 main.py',
        tool: 'code-runner',
        toolConfig: { type: 'code-runner', command: 'python main.py', captureOutput: true },
        input: { sources: [], mergeStrategy: 'concat' },
        outputs: [{ key: 'log', format: 'text' }],
        pauseAfter: false,
      },
    ],
  };
  rt.send({
    type: 'workflowGenerated',
    workflow,
    blocked: true,
    blockReasons: ['code-runner 执行脚本「main.py」未出现在工作流 artifact 登记中'],
    warnings: [],
  });

  assert.equal(rt.document.getElementById('view-confirm')!.className.includes('active'), true);
  assert.equal(rt.document.getElementById('btn-start')!.disabled, true);
  const block = rt.document.getElementById('confirm-block')!;
  assert.equal(block.style.display, 'block');
  assert.ok(block.innerHTML.includes('main.py'));

  // 后续一次成功生成应解除拦截、重新启用开始执行
  rt.send({ type: 'workflowGenerated', workflow, warnings: [] });
  assert.equal(rt.document.getElementById('btn-start')!.disabled, false);
  assert.equal(rt.document.getElementById('confirm-block')!.style.display, 'none');
});
