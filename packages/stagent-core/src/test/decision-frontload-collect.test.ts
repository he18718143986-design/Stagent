import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectFrontloadDecisionBoard } from '../decision-frontload/collectDecisionBoard';
import type { WorkflowDefinition } from '../WorkflowDefinition';

const baseInput = { sources: [], mergeStrategy: 'concat' as const };

test('collectFrontloadDecisionBoard returns null when no decision stages', () => {
  const wf: WorkflowDefinition = {
    id: 'wf-1',
    version: '2.0',
    meta: { title: 't', taskType: 'software', userInput: 'x', createdAt: new Date().toISOString() },
    stages: [
      {
        id: 's1',
        title: 'impl',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'p' },
        input: baseInput,
        outputs: [],
        pauseAfter: false,
      },
    ],
  };
  assert.equal(collectFrontloadDecisionBoard(wf, '/tmp'), null);
});

test('collectFrontloadDecisionBoard builds board for decision stages', () => {
  const wf: WorkflowDefinition = {
    id: 'wf-2',
    version: '2.0',
    meta: { title: 't', taskType: 'software', userInput: 'x', createdAt: new Date().toISOString() },
    stages: [
      {
        id: 'd1',
        title: '架构决策',
        isDecisionStage: true,
        tool: 'user-prompt',
        toolConfig: { type: 'user-prompt', promptText: 'p', inputLabel: 'l' },
        input: baseInput,
        outputs: [{ key: 'decision', format: 'text' }],
        pauseAfter: true,
      },
    ],
  };
  const board = collectFrontloadDecisionBoard(wf, '/nonexistent-workspace');
  assert.ok(board);
  assert.equal(board!.summary.total, 1);
  assert.equal(board!.items[0].stageId, 'd1');
});
