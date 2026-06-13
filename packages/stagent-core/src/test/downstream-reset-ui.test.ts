import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  findElementContainingText,
  setupWebviewScriptRuntime,
} from './webview-script-test-harness';

test('downstreamReset renders inline panel with stages and rolled back files', () => {
  const rt = setupWebviewScriptRuntime(true);
  const workflow = {
    id: 'wf_m19_reset',
    version: '2.0',
    meta: { title: 'm19', taskType: 'software', userInput: 'x', createdAt: new Date().toISOString() },
    stages: [
      { id: 'stage_decide', title: '决策', isDecisionStage: true },
      { id: 'stage_impl', title: '实现', pauseAfter: true },
    ],
  };

  rt.send({ type: 'workflowGenerated', workflow, warnings: [] });
  rt.document.getElementById('btn-start')!.onclick?.();
  rt.send({
    type: 'downstreamReset',
    decisionStageId: 'stage_decide',
    resetStageIds: ['stage_impl'],
    resetStageTitles: ['实现'],
    rolledBackFiles: ['/tmp/ws/src/App.tsx'],
  });

  const panel = rt.document.getElementById('downstream-reset-panel');
  assert.ok(panel);
  assert.equal(panel.style.display, 'block');
  findElementContainingText(panel, '已重置下游阶段（决策重试）');
  findElementContainingText(panel, '实现');
  findElementContainingText(panel, '已回滚文件');
  findElementContainingText(panel, '/tmp/ws/src/App.tsx');
});
