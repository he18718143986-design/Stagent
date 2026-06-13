import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { BackendMessage } from '../WorkflowDefinition';
import {
  findButtonByText,
  findElementContainingText,
  setupWebviewScriptRuntime,
} from './webview-script-test-harness';

test('stageConfidenceUpdate message shape matches BackendMessage contract', () => {
  const msg: BackendMessage = {
    type: 'stageConfidenceUpdate',
    stageId: 'stage_impl_x',
    score: 0.61,
    level: 'medium',
    reasons: ['质量评分建议人工复核'],
  };
  assert.equal(msg.type, 'stageConfidenceUpdate');
  assert.equal(msg.reasons.length, 1);
});

test('webview exec timeline renders confidence bar for impl stage', () => {
  const rt = setupWebviewScriptRuntime(true);
  const workflow = {
    id: 'wf_conf',
    version: '2.0',
    meta: { title: 'c', taskType: 'software', userInput: 'x', createdAt: new Date().toISOString() },
    stages: [
      { id: 'stage_impl_x', title: '实现模块', tool: 'llm-text', pauseAfter: false },
    ],
  };

  rt.send({ type: 'workflowGenerated', workflow, warnings: [] });
  rt.send({ type: 'stageStatusUpdate', stageId: 'stage_impl_x', status: 'done' });
  rt.send({
    type: 'stageConfidenceUpdate',
    stageId: 'stage_impl_x',
    score: 0.61,
    level: 'medium',
    reasons: ['实现阶段输出未含代码块'],
  });

  const timeline = rt.document.getElementById('timeline-exec');
  assert.ok(timeline);
  const hit = findElementContainingText(timeline, '0.61');
  assert.ok(hit, 'timeline should show confidence score');
  assert.ok(findElementContainingText(timeline, '■'), 'timeline should show bar blocks');
});

test('decision stage with high confidence still shows approve button', () => {
  const rt = setupWebviewScriptRuntime(true);
  const workflow = {
    id: 'wf_dec_conf',
    version: '2.0',
    meta: { title: 'd', taskType: 'software', userInput: 'x', createdAt: new Date().toISOString() },
    stages: [{ id: 'stage_decide_x', title: '架构决策', isDecisionStage: true }],
  };

  rt.send({ type: 'workflowGenerated', workflow, warnings: [] });
  rt.send({ type: 'stageStatusUpdate', stageId: 'stage_decide_x', status: 'paused' });
  rt.send({ type: 'stageOutputUpdate', stageId: 'stage_decide_x', content: '## 决策' });
  rt.send({
    type: 'stageConfidenceUpdate',
    stageId: 'stage_decide_x',
    score: 0.92,
    level: 'high',
    reasons: ['信号良好，置信度较高'],
  });
  rt.send({ type: 'stageStatusUpdate', stageId: 'stage_decide_x', status: 'paused' });

  const pauseBar = rt.document.getElementById('pause-bar');
  assert.ok(pauseBar);
  assert.ok(findButtonByText(pauseBar, '✅ 批准此决策'));
  const timeline = rt.document.getElementById('timeline-exec');
  assert.ok(timeline);
  assert.ok(findElementContainingText(timeline, '0.92'));
});

test('low confidence shows warning marker in timeline', () => {
  const rt = setupWebviewScriptRuntime(true);
  const workflow = {
    id: 'wf_low',
    version: '2.0',
    meta: { title: 'l', taskType: 'software', userInput: 'x', createdAt: new Date().toISOString() },
    stages: [{ id: 'stage_impl_y', title: '实现 Y' }],
  };

  rt.send({ type: 'workflowGenerated', workflow, warnings: [] });
  rt.send({ type: 'stageStatusUpdate', stageId: 'stage_impl_y', status: 'done' });
  rt.send({
    type: 'stageConfidenceUpdate',
    stageId: 'stage_impl_y',
    score: 0.32,
    level: 'critical',
    reasons: ['质量评分建议重试'],
  });

  const timeline = rt.document.getElementById('timeline-exec');
  assert.ok(timeline);
  assert.ok(findElementContainingText(timeline, '⚠'));
});
