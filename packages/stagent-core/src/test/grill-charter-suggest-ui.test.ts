import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  collectTextInputs,
  findButtonByText,
  setupWebviewScriptRuntime,
} from './webview-script-test-harness';

test('charter suggest: prefill input and amber class for charter_inferred', () => {
  const rt = setupWebviewScriptRuntime(true);
  const questionBefore = [
    {
      id: 'b1',
      text: '是否合并 seam？',
      hint: 'bh1',
      required: true,
      suggestedAnswer: '不要合并 unrelated seam（主旨直接命中）',
      provenance: 'charter_inferred',
      ruleRefs: [2],
    },
  ];
  const workflow = {
    id: 'wf_charter_suggest',
    version: '2.0',
    meta: {
      title: 'charter suggest',
      taskType: 'software',
      userInput: 'x',
      createdAt: new Date().toISOString(),
    },
    stages: [
      {
        id: 'stage_impl_y',
        title: 'impl y',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'x' },
        input: { sources: [{ type: 'user-input', label: 'u' }], mergeStrategy: 'concat' },
        outputs: [{ key: 'code', format: 'text' }],
        pauseAfter: true,
        questionBefore,
      },
    ],
  };

  rt.send({ type: 'workflowGenerated', workflow, warnings: [] });
  rt.send({
    type: 'stageStatusUpdate',
    stageId: 'stage_impl_y',
    status: 'waiting-questions',
    isDecisionStage: false,
  });
  rt.send({
    type: 'stageQuestionsBefore',
    stageId: 'stage_impl_y',
    questions: questionBefore,
  });

  const pauseBar = rt.document.getElementById('pause-bar');
  assert.ok(pauseBar);
  const inputs = collectTextInputs(pauseBar);
  assert.equal(inputs.length, 1);
  assert.match(inputs[0].value, /不要合并 unrelated seam/);

  const inferredField = pauseBar.querySelector('.question-field-charter-inferred');
  assert.ok(inferredField);

  findButtonByText(pauseBar, '开始执行').onclick?.();
  const msg = rt.postMessages.find((m) => (m as { type?: string }).type === 'answerQuestionsBefore') as
    | { type: 'answerQuestionsBefore'; stageId: string; answers: Record<string, string> }
    | undefined;
  assert.ok(msg);
  assert.match(msg.answers.b1, /不要合并 unrelated seam/);
});
