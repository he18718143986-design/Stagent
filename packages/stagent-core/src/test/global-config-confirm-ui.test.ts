import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { setupWebviewScriptRuntime } from './webview-script-test-harness';

test('confirm detail shows globalConfig summary', () => {
  const rt = setupWebviewScriptRuntime(true);
  const workflow = {
    id: 'wf_m19_gc',
    version: '2.0',
    meta: { title: 'm19 gc', taskType: 'software', userInput: 'x', createdAt: new Date().toISOString() },
    globalConfig: {
      enableDagScheduler: true,
      dagMaxParallelism: 2,
      globalDecisionInjectMode: 'summary',
    },
    stages: [{ id: 'stage_a', title: 'Stage A', pauseAfter: false }],
  };

  rt.send({ type: 'workflowGenerated', workflow, warnings: [] });
  const detail = rt.document.getElementById('detail');
  assert.ok(detail);
  assert.ok(detail.textContent.includes('全局配置'));
  assert.ok(detail.textContent.includes('DAG 调度：开启'));
  assert.ok(detail.textContent.includes('DAG 并行度：2'));
  assert.ok(detail.textContent.includes('决策注入模式：summary'));
});
