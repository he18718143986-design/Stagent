import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { WorkflowDefinition } from '../WorkflowDefinition';
import { validateGeneratedWorkflow } from '../WorkflowValidation';
import { normalizeQuestions } from '../QuestionNormalization';

function normalizeM7LikeEngine(wf: WorkflowDefinition): WorkflowDefinition {
  const copy: WorkflowDefinition = JSON.parse(JSON.stringify(wf));
  for (const stage of copy.stages) {
    stage.questionBefore = normalizeQuestions(stage.questionBefore, stage.id, 'before');
    stage.questionAfter = normalizeQuestions(stage.questionAfter, stage.id, 'after');
    if (/^stage_impl_/.test(stage.id) && stage.pauseAfter === false && (stage.questionAfter?.length ?? 0) > 0) {
      const mergedBefore = [...(stage.questionBefore ?? []), ...(stage.questionAfter ?? [])];
      stage.questionBefore = normalizeQuestions(mergedBefore, stage.id, 'before');
      stage.questionAfter = undefined;
    }
  }
  return copy;
}

test('migrates impl questionAfter to questionBefore when pauseAfter=false', () => {
  const wf: WorkflowDefinition = {
    id: 'wf_fix_i6',
    version: '2.0',
    meta: { title: 'fix', taskType: 'software', userInput: 'x', createdAt: new Date().toISOString() },
    stages: [
      {
        id: 'stage_impl_scan_todos',
        title: 'impl',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'x' },
        input: { sources: [{ type: 'user-input', label: '需求' }], mergeStrategy: 'concat' },
        outputs: [{ key: 'code', format: 'text' }],
        pauseAfter: false,
        questionAfter: [{ id: 'q1', text: '超时时间？', hint: '30s', required: true }],
      },
    ],
  };

  const fixed = normalizeM7LikeEngine(wf);
  const stage = fixed.stages[0];
  assert.equal(stage.questionAfter, undefined);
  assert.equal(stage.questionBefore?.length, 1);
  assert.equal(stage.questionBefore?.[0].text, '超时时间？');
  assert.deepEqual(validateGeneratedWorkflow(fixed), []);
});
