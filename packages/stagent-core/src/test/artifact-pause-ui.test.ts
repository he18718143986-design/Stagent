import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  findButtonByText,
  setupWebviewScriptRuntime,
} from './webview-script-test-harness';

test('non-decision pause bar shows artifact view and diff buttons', () => {
  const rt = setupWebviewScriptRuntime(true);
  const workflow = {
    id: 'wf_m19_art',
    version: '2.0',
    meta: { title: 'm19 art', taskType: 'software', userInput: 'x', createdAt: new Date().toISOString() },
    stages: [
      {
        id: 'stage_impl',
        title: '实现',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'x', writeOutputToFile: 'src/App.tsx' },
        pauseAfter: true,
      },
    ],
  };

  rt.send({ type: 'workflowGenerated', workflow, warnings: [] });
  rt.document.getElementById('btn-start')!.onclick?.();
  rt.send({ type: 'stageStatusUpdate', stageId: 'stage_impl', status: 'paused' });
  rt.send({
    type: 'stageArtifactHints',
    stageId: 'stage_impl',
    artifacts: [
      {
        filePath: '/tmp/ws/src/App.tsx',
        state: 'verified',
        canDiff: true,
      },
    ],
  });

  const pauseBar = rt.document.getElementById('pause-bar');
  assert.ok(pauseBar);
  const viewBtn = findButtonByText(pauseBar, '📄 查看 App.tsx');
  viewBtn.onclick?.();
  const openMsg = rt.postMessages.find((m) => (m as { type?: string }).type === 'openArtifactFile') as
    | { stageId: string; filePath: string }
    | undefined;
  assert.ok(openMsg);
  assert.equal(openMsg.stageId, 'stage_impl');
  assert.equal(openMsg.filePath, '/tmp/ws/src/App.tsx');

  const diffBtn = findButtonByText(pauseBar, '↔ 对比变更');
  diffBtn.onclick?.();
  const diffMsg = rt.postMessages.find((m) => (m as { type?: string }).type === 'openArtifactDiff') as
    | { stageId: string; filePath: string }
    | undefined;
  assert.ok(diffMsg);
  assert.equal(diffMsg.filePath, '/tmp/ws/src/App.tsx');
});
