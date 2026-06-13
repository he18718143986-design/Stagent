import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildWorkflowGeneratorPrompt } from '../WorkflowPrompts';
import { extractJsonObject } from '../JsonExtract';
import { validateGeneratedWorkflow } from '../WorkflowValidation';
import { verifyRule20 } from '../Rule20Verify';
import type { WorkflowDefinition } from '../WorkflowDefinition';

const FIXED_USER_INPUT = '重构工作流引擎模块边界，保持外部行为兼容，并补齐可执行验证链路。';

test('refactor e2e mock chain: fixed input generates structurally valid workflow and passes verifier', () => {
  const prompt = buildWorkflowGeneratorPrompt('refactor');
  assert.equal(prompt.includes("taskType='refactor'"), true);
  assert.equal(prompt.includes('stage_decide_refactor_<X>'), true);

  const mockRaw = `
这里是解释文本，真实模型可能会混入说明。
\`\`\`json
{
  "id": "wf_refactor_engine_boundary",
  "version": "2.0",
  "meta": {
    "title": "Refactor Engine Boundary",
    "taskType": "refactor",
    "userInput": "${FIXED_USER_INPUT}",
    "createdAt": "2026-05-09T08:00:00.000Z",
    "isGreenfield": false
  },
  "stages": [
    {
      "id": "stage_decide_refactor_engine_boundary",
      "title": "决策引擎边界重构",
      "tool": "llm-text",
      "toolConfig": { "type": "llm-text", "systemPrompt": "输出重构决策清单" },
      "input": { "sources": [{ "type": "user-input", "label": "重构目标" }], "mergeStrategy": "concat" },
      "outputs": [{ "key": "decisionRecord", "format": "markdown" }],
      "pauseAfter": true,
      "isDecisionStage": true
    },
    {
      "id": "stage_test_write_engine_boundary",
      "title": "编写回归测试",
      "tool": "llm-text",
      "toolConfig": { "type": "llm-text", "systemPrompt": "按行为等价编写测试" },
      "input": {
        "sources": [{ "type": "stage-output", "stageId": "stage_decide_refactor_engine_boundary", "outputKey": "decisionRecord", "label": "已确认决策" }],
        "mergeStrategy": "concat"
      },
      "outputs": [{ "key": "testPlan", "format": "markdown" }],
      "pauseAfter": false
    },
    {
      "id": "stage_impl_engine_boundary",
      "title": "实现引擎边界重构",
      "tool": "llm-text",
      "toolConfig": { "type": "llm-text", "systemPrompt": "严格按照已确认的决策清单实现，不得偏离。如发现清单中存在矛盾，在代码注释中标注。" },
      "input": {
        "sources": [{ "type": "stage-output", "stageId": "stage_decide_refactor_engine_boundary", "outputKey": "decisionRecord", "label": "已确认的决策清单" }],
        "mergeStrategy": "concat"
      },
      "outputs": [{ "key": "implPatch", "format": "markdown" }],
      "pauseAfter": false
    },
    {
      "id": "stage_test_run_engine_boundary",
      "title": "运行回归验证",
      "tool": "code-runner",
      "toolConfig": { "type": "code-runner", "command": "npm run test -- engine-boundary", "captureOutput": true },
      "input": {
        "sources": [{ "type": "stage-output", "stageId": "stage_impl_engine_boundary", "outputKey": "implPatch", "label": "实现结果" }],
        "mergeStrategy": "concat"
      },
      "outputs": [{ "key": "testReport", "format": "markdown" }],
      "pauseAfter": false
    }
  ]
}
\`\`\`
`;

  const jsonText = extractJsonObject(mockRaw);
  assert.ok(jsonText, '应能从 mock 原始输出中提取 workflow JSON');
  const workflow = JSON.parse(jsonText) as WorkflowDefinition;

  assert.equal(workflow.meta.taskType, 'refactor');
  assert.equal(workflow.meta.userInput, FIXED_USER_INPUT);
  assert.equal(workflow.stages.some((s) => s.id.startsWith('stage_decide_refactor_')), true);
  assert.equal(workflow.stages.some((s) => s.id.startsWith('stage_test_run_') || s.tool === 'code-runner'), true);

  const structuralErrors = validateGeneratedWorkflow(workflow);
  assert.equal(structuralErrors.length, 0);

  const verifyResult = verifyRule20(workflow);
  assert.equal(verifyResult.passed, true);
  assert.equal(verifyResult.violations.length, 0);
  assert.equal(verifyResult.warnings.length, 0);
});

