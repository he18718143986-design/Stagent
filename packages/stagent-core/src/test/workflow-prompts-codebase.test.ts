import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildWorkflowGeneratorPrompt } from '../WorkflowPrompts';

test('buildWorkflowGeneratorPrompt appends codebaseContext block when provided', () => {
  const prompt = buildWorkflowGeneratorPrompt('software', {
    userInput: 'build todo app',
    codebaseContext: '项目类型: node\npackage.json: name=demo',
  });
  assert.ok(prompt.includes('【工作区代码库快照'));
  assert.ok(prompt.includes('项目类型: node'));
});
