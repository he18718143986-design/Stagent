import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  hoistStageWriteOutputToToolConfig,
  isRenderableWorkflowForConfirm,
  validateAndPrepareGeneratedWorkflow,
} from '../WorkflowEngineHelpers';
import { collectWorkflowArtifacts } from '../WorkflowArtifactRegistry';
import type { WorkflowDefinition } from '../WorkflowDefinition';

const baseWorkflowMeta = {
  title: '测试生成工作流',
  taskType: 'software',
  userInput: '实现一个简单的 TODO 应用',
  createdAt: new Date().toISOString(),
};

test('generateWorkflow path validates before applying software disk pipeline', () => {
  const wf = {
    id: 'wf_invalid_stages',
    version: '2.0',
    meta: baseWorkflowMeta,
  } as unknown as WorkflowDefinition;

  const result = validateAndPrepareGeneratedWorkflow(wf, 'software');

  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /stages 不能为空/);
  assert.strictEqual(result.workflow, wf, 'Invalid workflow should not be transformed by pipeline');
});

test('generateWorkflow path applies software disk pipeline after validation for valid software workflow', () => {
  const wf = {
    id: 'wf_software_valid',
    version: '2.0',
    meta: baseWorkflowMeta,
    stages: [
      {
        id: 'stage_impl_todo',
        title: '生成 TODO 业务实现',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: '请生成实现内容' },
        input: { sources: [{ type: 'user-input', label: '任务描述' }], mergeStrategy: 'concat' },
        outputs: [{ key: 'text', format: 'text' }],
        pauseAfter: false,
      },
      {
        id: 'stage_test_run_todo',
        title: '运行测试',
        tool: 'code-runner',
        toolConfig: { type: 'code-runner', command: 'npm test', captureOutput: true },
        input: { sources: [], mergeStrategy: 'concat' },
        outputs: [{ key: 'testResults', format: 'json' }],
        pauseAfter: false,
      },
    ],
  } as unknown as WorkflowDefinition;

  const result = validateAndPrepareGeneratedWorkflow(wf, 'software');

  assert.equal(result.errors.length, 0);
  assert.ok(result.workflow.stages.length >= 3, 'Software pipeline should inject extra stages');
  assert.equal(result.workflow.stages[0].id, 'stage_init_npm_workspace');
  const testRunStage = result.workflow.stages.find((s) => s.id === 'stage_test_run_todo');
  assert.ok(testRunStage);
  assert.equal((testRunStage!.toolConfig as { pathBase?: string }).pathBase, 'workspace');
});

test('hoistStageWriteOutputToToolConfig moves stage-level writeOutputToFile into toolConfig', () => {
  const wf = {
    id: 'wf_hoist',
    version: '2.0',
    meta: baseWorkflowMeta,
    stages: [
      {
        id: 'stage_impl_main',
        title: '实现 main.py',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: '生成 main.py' },
        input: { sources: [], mergeStrategy: 'concat' },
        outputs: [{ key: 'sourceCode', format: 'text' }],
        pauseAfter: false,
        writeOutputToFile: 'main.py',
        writePathBase: 'workspace',
      },
    ],
  } as unknown as WorkflowDefinition;

  hoistStageWriteOutputToToolConfig(wf);

  const tc = wf.stages[0].toolConfig as { writeOutputToFile?: string; writePathBase?: string };
  assert.equal(tc.writeOutputToFile, 'main.py');
  assert.equal(tc.writePathBase, 'workspace');
  assert.equal((wf.stages[0] as unknown as { writeOutputToFile?: string }).writeOutputToFile, undefined);

  const registry = collectWorkflowArtifacts(wf);
  assert.ok(registry.pathSet.has('main.py'));
  assert.ok(registry.moduleSet.has('main'));
});

test('hoistStageWriteOutputToToolConfig keeps existing toolConfig value', () => {
  const wf = {
    id: 'wf_hoist_keep',
    version: '2.0',
    meta: baseWorkflowMeta,
    stages: [
      {
        id: 'stage_impl_a',
        title: 'a',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'x', writeOutputToFile: 'canonical.py' },
        input: { sources: [], mergeStrategy: 'concat' },
        outputs: [{ key: 'sourceCode', format: 'text' }],
        pauseAfter: false,
        writeOutputToFile: 'stray.py',
      },
    ],
  } as unknown as WorkflowDefinition;

  hoistStageWriteOutputToToolConfig(wf);

  const tc = wf.stages[0].toolConfig as { writeOutputToFile?: string };
  assert.equal(tc.writeOutputToFile, 'canonical.py');
  assert.equal((wf.stages[0] as unknown as { writeOutputToFile?: string }).writeOutputToFile, undefined);
});

test('isRenderableWorkflowForConfirm accepts a structurally complete workflow', () => {
  const wf = {
    id: 'wf_renderable',
    version: '2.0',
    meta: baseWorkflowMeta,
    stages: [
      {
        id: 'stage_impl_a',
        title: '实现 A',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'x' },
        input: { sources: [], mergeStrategy: 'concat' },
        outputs: [{ key: 'sourceCode', format: 'text' }],
        pauseAfter: false,
      },
    ],
  } as unknown as WorkflowDefinition;

  assert.equal(isRenderableWorkflowForConfirm(wf), true);
});

test('blocked-confirm routing: unregistered python script yields errors AND renderable wf', () => {
  // 复现用户场景：code-runner 跑 main.py，但无任何 writeOutputToFile: main.py 阶段。
  // 期望：validateGeneratedWorkflow 返回 python-script-not-in-artifacts 错误，
  //       且 isRenderableWorkflowForConfirm 为 true —— 二者同时成立即触发只读 blocked 确认页。
  const wf = {
    id: 'wf_proto_blocked',
    version: '2.0',
    meta: { ...baseWorkflowMeta, taskType: 'prototype' },
    stages: [
      {
        id: 'stage_test_run_prototype_experiment',
        title: '验证 main.py',
        tool: 'code-runner',
        toolConfig: { type: 'code-runner', command: 'python main.py', captureOutput: true },
        input: { sources: [], mergeStrategy: 'concat' },
        outputs: [{ key: 'log', format: 'text' }],
        pauseAfter: false,
      },
    ],
  } as unknown as WorkflowDefinition;

  const prepared = validateAndPrepareGeneratedWorkflow(wf, 'prototype');
  assert.ok(prepared.errors.length > 0, '应产生校验错误');
  assert.ok(
    prepared.errors.some((e) => e.includes('python-script-not-in-artifacts')),
    '错误应包含 python-script-not-in-artifacts',
  );
  assert.equal(isRenderableWorkflowForConfirm(wf), true, '结构可渲染 → 应走 blocked 确认页而非退回输入页');
});

test('isRenderableWorkflowForConfirm rejects empty / malformed stages', () => {
  assert.equal(isRenderableWorkflowForConfirm(undefined), false);
  assert.equal(
    isRenderableWorkflowForConfirm({ id: 'x', version: '2.0', meta: baseWorkflowMeta, stages: [] } as unknown as WorkflowDefinition),
    false,
  );
  const missingTool = {
    id: 'wf_bad',
    version: '2.0',
    meta: baseWorkflowMeta,
    stages: [{ id: 'stage_a', title: 'A' }],
  } as unknown as WorkflowDefinition;
  assert.equal(isRenderableWorkflowForConfirm(missingTool), false);
});
