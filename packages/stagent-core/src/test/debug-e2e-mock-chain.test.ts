import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildWorkflowGeneratorPrompt } from '../WorkflowPrompts';
import { extractJsonObject } from '../JsonExtract';
import { validateGeneratedWorkflow } from '../WorkflowValidation';
import { verifyRule20 } from '../Rule20Verify';
import type { WorkflowDefinition } from '../WorkflowDefinition';

const FIXED_DEBUG_INPUT = '定位并修复启动阶段偶发超时，要求先复现、再给出根因假设、最后回归验证。';

test('debug e2e mock chain: fixed input generates structurally valid workflow and passes verifier', () => {
  const prompt = buildWorkflowGeneratorPrompt('debug');
  assert.equal(prompt.includes("taskType='debug'"), true);
  assert.equal(prompt.includes('stage_reproduce_debug_case'), true);

  const mockRaw = `
这里是调试场景说明，真实模型可能会输出额外解释。
\`\`\`json
{
  "id": "wf_debug_startup_timeout",
  "version": "2.0",
  "meta": {
    "title": "Debug Startup Timeout",
    "taskType": "debug",
    "userInput": "${FIXED_DEBUG_INPUT}",
    "createdAt": "2026-05-09T08:30:00.000Z",
    "isGreenfield": false
  },
  "stages": [
    {
      "id": "stage_decide_debug_scope",
      "title": "决策调试范围",
      "tool": "llm-text",
      "toolConfig": { "type": "llm-text", "systemPrompt": "定义复现边界与成功判据" },
      "input": { "sources": [{ "type": "user-input", "label": "故障描述" }], "mergeStrategy": "concat" },
      "outputs": [{ "key": "decisionRecord", "format": "markdown" }],
      "pauseAfter": true,
      "isDecisionStage": true
    },
    {
      "id": "stage_reproduce_debug_case",
      "title": "复现故障",
      "tool": "code-runner",
      "toolConfig": { "type": "code-runner", "command": "npm run test -- startup-timeout", "captureOutput": true },
      "input": {
        "sources": [{ "type": "stage-output", "stageId": "stage_decide_debug_scope", "outputKey": "decisionRecord", "label": "调试范围" }],
        "mergeStrategy": "concat"
      },
      "outputs": [{ "key": "reproduceReport", "format": "markdown" }],
      "pauseAfter": false
    },
    {
      "id": "stage_hypothesis_debug_root_cause",
      "title": "根因假设",
      "tool": "llm-text",
      "toolConfig": { "type": "llm-text", "systemPrompt": "给出根因假设与排除顺序" },
      "input": {
        "sources": [{ "type": "stage-output", "stageId": "stage_reproduce_debug_case", "outputKey": "reproduceReport", "label": "复现结果" }],
        "mergeStrategy": "concat"
      },
      "outputs": [{ "key": "hypothesis", "format": "markdown" }],
      "pauseAfter": false
    },
    {
      "id": "stage_impl_debug_fix",
      "title": "实现调试修复",
      "tool": "llm-text",
      "toolConfig": { "type": "llm-text", "systemPrompt": "按假设实施最小修复" },
      "input": {
        "sources": [{ "type": "stage-output", "stageId": "stage_hypothesis_debug_root_cause", "outputKey": "hypothesis", "label": "根因假设" }],
        "mergeStrategy": "concat"
      },
      "outputs": [{ "key": "fixPatch", "format": "markdown" }],
      "pauseAfter": false
    },
    {
      "id": "stage_test_run_debug_regression",
      "title": "回归验证",
      "tool": "code-runner",
      "toolConfig": { "type": "code-runner", "command": "npm run test -- startup-timeout-regression", "captureOutput": true },
      "input": {
        "sources": [{ "type": "stage-output", "stageId": "stage_impl_debug_fix", "outputKey": "fixPatch", "label": "修复结果" }],
        "mergeStrategy": "concat"
      },
      "outputs": [{ "key": "regressionReport", "format": "markdown" }],
      "pauseAfter": false
    }
  ]
}
\`\`\`
`;

  const jsonText = extractJsonObject(mockRaw);
  assert.ok(jsonText, '应能从 mock 原始输出中提取 debug workflow JSON');
  const workflow = JSON.parse(jsonText) as WorkflowDefinition;

  assert.equal(workflow.meta.taskType, 'debug');
  assert.equal(workflow.meta.userInput, FIXED_DEBUG_INPUT);
  assert.equal(workflow.stages.some((s) => s.id === 'stage_reproduce_debug_case'), true);
  assert.equal(workflow.stages.some((s) => s.id === 'stage_hypothesis_debug_root_cause'), true);
  assert.equal(workflow.stages.some((s) => s.id === 'stage_test_run_debug_regression' || s.tool === 'code-runner'), true);

  const structuralErrors = validateGeneratedWorkflow(workflow);
  assert.equal(structuralErrors.length, 0);

  const verifyResult = verifyRule20(workflow);
  assert.equal(verifyResult.passed, true);
  assert.equal(verifyResult.violations.length, 0);
  assert.equal(verifyResult.warnings.length, 0);
});

