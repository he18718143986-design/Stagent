import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  findButtonByText,
  findElementContainingText,
  findFirstByTag,
  findInputByPlaceholder,
  setupWebviewScriptRuntime,
} from './webview-script-test-harness';

test('webview decision flow: approve branches to soft prompt then force approve postMessage', () => {
  const rt = setupWebviewScriptRuntime(true);
  const workflow = {
    id: 'wf_m8',
    version: '2.0',
    meta: { title: 'm8', taskType: 'software', userInput: 'x', createdAt: new Date().toISOString() },
    stages: [{ id: 'stage_decide_1', title: 'Decide 1', isDecisionStage: true }],
  };

  rt.send({ type: 'workflowGenerated', workflow, warnings: [] });
  rt.send({ type: 'stageStatusUpdate', stageId: 'stage_decide_1', status: 'paused' });
  rt.send({ type: 'stageOutputUpdate', stageId: 'stage_decide_1', content: '简短决策文本' });
  rt.send({ type: 'stageStatusUpdate', stageId: 'stage_decide_1', status: 'paused' });

  const pauseBar = rt.document.getElementById('pause-bar');
  assert.ok(pauseBar);
  const editor = findFirstByTag(pauseBar, 'textarea');
  editor.value = '## 决策文本（已人工修订）';
  const approveBtn = findButtonByText(pauseBar, '✅ 批准此决策');
  approveBtn.onclick?.();
  assert.equal(
    rt.postMessages.some((m) => (m as { type?: string }).type === 'approveDecision'),
    false,
  );

  const forceApproveBtn = findButtonByText(pauseBar, '忽略，直接批准');
  forceApproveBtn.onclick?.();
  const approveMsg = rt.postMessages.find((m) => (m as { type?: string }).type === 'approveDecision') as
    | { stageId: string; decisionRecord: string }
    | undefined;
  assert.ok(approveMsg);
  assert.equal(approveMsg.stageId, 'stage_decide_1');
  assert.equal(approveMsg.decisionRecord, '## 决策文本（已人工修订）');
});

test('webview decision flow: retry button posts retry payload with comment', () => {
  const rt = setupWebviewScriptRuntime(true);
  const workflow = {
    id: 'wf_m8_retry',
    version: '2.0',
    meta: { title: 'm8 retry', taskType: 'software', userInput: 'x', createdAt: new Date().toISOString() },
    stages: [
      { id: 'stage_decide_prev', title: 'Prev Decide', isDecisionStage: true },
      { id: 'stage_decide_2', title: 'Decide 2', isDecisionStage: true },
    ],
  };

  rt.send({ type: 'workflowGenerated', workflow, warnings: [] });
  rt.send({ type: 'stageStatusUpdate', stageId: 'stage_decide_prev', status: 'done' });
  rt.send({ type: 'stageStatusUpdate', stageId: 'stage_decide_2', status: 'paused' });
  rt.send({ type: 'stageOutputUpdate', stageId: 'stage_decide_2', content: '## 决策内容' });
  rt.send({ type: 'stageStatusUpdate', stageId: 'stage_decide_2', status: 'paused' });

  const pauseBar = rt.document.getElementById('pause-bar');
  assert.ok(pauseBar);
  const retryInput = findInputByPlaceholder(pauseBar, '重试提示（可选）');
  retryInput.value = '请补充边界压力测试';
  const retryBtn = findButtonByText(pauseBar, '🔄 让 AI 重新生成');
  retryBtn.onclick?.();

  const retryMsg = rt.postMessages.find((m) => (m as { type?: string }).type === 'retry') as
    | { stageId: string; comment: string }
    | undefined;
  assert.ok(retryMsg);
  assert.equal(retryMsg.stageId, 'stage_decide_2');
  assert.equal(retryMsg.comment, '请补充边界压力测试');
});

test('webview decision flow: conflict banner shows and expands approved decision details', () => {
  const rt = setupWebviewScriptRuntime(true);
  const workflow = {
    id: 'wf_m8_conflict',
    version: '2.0',
    meta: { title: 'm8 conflict', taskType: 'software', userInput: 'x', createdAt: new Date().toISOString() },
    stages: [
      { id: 'stage_decide_a', title: 'Decide A', isDecisionStage: true },
      { id: 'stage_decide_b', title: 'Decide B', isDecisionStage: true },
      { id: 'stage_decide_c', title: 'Decide C', isDecisionStage: true },
    ],
  };

  rt.send({ type: 'workflowGenerated', workflow, warnings: [] });
  rt.send({ type: 'stageOutputUpdate', stageId: 'stage_decide_a', content: '## A 决策记录' });
  rt.send({ type: 'stageOutputUpdate', stageId: 'stage_decide_b', content: '## B 决策记录' });
  rt.send({ type: 'stageStatusUpdate', stageId: 'stage_decide_a', status: 'done' });
  rt.send({ type: 'stageStatusUpdate', stageId: 'stage_decide_b', status: 'done' });
  rt.send({ type: 'stageStatusUpdate', stageId: 'stage_decide_c', status: 'paused' });
  rt.send({ type: 'stageOutputUpdate', stageId: 'stage_decide_c', content: '## C 待审核' });
  rt.send({ type: 'stageStatusUpdate', stageId: 'stage_decide_c', status: 'paused' });

  const pauseBar = rt.document.getElementById('pause-bar');
  assert.ok(pauseBar);
  findElementContainingText(pauseBar, '本工作流已有 2 个已批准的决策清单');

  const viewBtn = findButtonByText(pauseBar, '查看已批准的决策 ↗');
  viewBtn.onclick?.();

  const decideATitle = findElementContainingText(pauseBar, 'Decide A');
  assert.ok(decideATitle);
  const decideAContent = findElementContainingText(pauseBar, '## A 决策记录');
  assert.ok(decideAContent);
  const decideBContent = findElementContainingText(pauseBar, '## B 决策记录');
  assert.ok(decideBContent);
});
