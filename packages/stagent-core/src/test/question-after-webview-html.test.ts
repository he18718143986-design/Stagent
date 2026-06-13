import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildWorkflowWebviewHtml } from '../WebviewPanel';

test('webview embeds questionAfter (stageQuestions) handling', () => {
  const html = buildWorkflowWebviewHtml({ cspSource: 'vscode-test' } as never);
  assert.match(html, /case 'stageQuestions'/);
  assert.match(html, /执行后追问/);
  assert.match(html, /buildAnswerQuestionsMessage/);
});
