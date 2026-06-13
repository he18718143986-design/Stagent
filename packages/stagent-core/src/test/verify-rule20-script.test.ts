import * as fs from 'fs';
import * as path from 'path';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { WorkflowDefinition } from '../WorkflowDefinition';
import { verifyRule20 } from '../Rule20Verify';

function buildBaseWorkflow(): WorkflowDefinition {
  return {
    id: 'wf_verify_rule20',
    version: '2.0',
    meta: { title: 'verify', taskType: 'software', userInput: 'x', createdAt: new Date().toISOString() },
    stages: [
      {
        id: 'stage_decide_parser',
        title: 'decide parser',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'decision' },
        input: { sources: [{ type: 'user-input', label: '需求' }], mergeStrategy: 'concat' },
        outputs: [{ key: 'decisionRecord', format: 'markdown' }],
        pauseAfter: true,
        isDecisionStage: true,
      },
      {
        id: 'stage_impl_parser',
        title: 'impl parser',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: '严格按照已确认的决策清单实现，不得偏离。' },
        input: {
          sources: [{ type: 'stage-output', stageId: 'stage_decide_parser', outputKey: 'decisionRecord', label: '已确认的决策清单' }],
          mergeStrategy: 'concat',
        },
        outputs: [{ key: 'code', format: 'text' }],
        pauseAfter: false,
      },
    ],
  };
}

test('verify-rule20 flags missing-constraint-prompt', () => {
  const wf = buildBaseWorkflow();
  (wf.stages[1].toolConfig as { systemPrompt: string }).systemPrompt = 'implement freely';
  const result = verifyRule20(wf);
  assert.equal(result.passed, false);
  assert.equal(result.violations.some((v) => v.type === 'missing-constraint-prompt'), true);
});

test('verify-rule20 warns software-missing-global-architecture-decision when keywords hit §7.8', () => {
  const fixturePath = path.join(
    process.cwd(),
    'scripts/fixtures/rule20/warn-missing-global-architecture.json',
  );
  const wf = JSON.parse(fs.readFileSync(fixturePath, 'utf-8')) as WorkflowDefinition;
  const result = verifyRule20(wf);
  assert.equal(result.passed, true);
  assert.equal(
    result.warnings.some((w) => w.type === 'software-missing-global-architecture-decision'),
    true,
  );
});

test('verify-rule20 clears global-architecture warning when stage_decide_architecture_overview present', () => {
  const fixturePath = path.join(
    process.cwd(),
    'scripts/fixtures/rule20/warn-missing-global-architecture.json',
  );
  const wf = JSON.parse(fs.readFileSync(fixturePath, 'utf-8')) as WorkflowDefinition;
  wf.stages.unshift({
    id: 'stage_decide_architecture_overview',
    title: 'global blueprint',
    tool: 'llm-text',
    toolConfig: { type: 'llm-text', systemPrompt: 'decision' },
    input: { sources: [{ type: 'user-input', label: '需求' }], mergeStrategy: 'concat' },
    outputs: [{ key: 'decisionRecord', format: 'markdown' }],
    pauseAfter: true,
    isDecisionStage: true,
  });
  const result = verifyRule20(wf);
  assert.equal(result.warnings.some((w) => w.type === 'software-missing-global-architecture-decision'), false);
});

test('verify-rule20 flags test-run-must-use-code-runner', () => {
  const wf = buildBaseWorkflow();
  wf.stages.push({
    id: 'stage_test_run_bad',
    title: 'fake run',
    tool: 'llm-text',
    toolConfig: { type: 'llm-text', systemPrompt: '假装运行测试并口述结果' },
    input: {
      sources: [{ type: 'stage-output', stageId: 'stage_impl_parser', outputKey: 'code', label: '实现' }],
      mergeStrategy: 'concat',
    },
    outputs: [{ key: 'report', format: 'markdown' }],
    pauseAfter: false,
  });
  const result = verifyRule20(wf);
  assert.equal(result.passed, false);
  assert.equal(result.violations.some((v) => v.type === 'test-run-must-use-code-runner'), true);
});

test('verify-rule20 emits model-tier-downgrade warning', () => {
  const wf = buildBaseWorkflow();
  wf.globalConfig = { modelOverrides: { decisionStage: 'gpt-4o-mini' } };
  const result = verifyRule20(wf);
  assert.equal(result.warnings.some((w) => w.type === 'model-tier-downgrade'), true);
});

test('verify-rule20 emits refactor warnings without blocking pass', () => {
  const wf = buildBaseWorkflow();
  wf.meta.taskType = 'refactor';
  wf.stages = [
    {
      id: 'stage_impl_all',
      title: 'impl all',
      tool: 'llm-text',
      toolConfig: { type: 'llm-text', systemPrompt: 'strict impl' },
      input: { sources: [{ type: 'user-input', label: '需求' }], mergeStrategy: 'concat' },
      outputs: [{ key: 'code', format: 'text' }],
      pauseAfter: false,
    },
  ];

  const result = verifyRule20(wf);
  assert.equal(result.passed, true);
  assert.equal(result.violations.length, 0);
  assert.equal(result.warnings.some((w) => w.type === 'refactor-missing-decision-stage'), true);
  assert.equal(result.warnings.some((w) => w.type === 'refactor-missing-verification-stage'), true);
  assert.equal(result.warnings.some((w) => w.type === 'refactor-monolithic-impl-naming'), true);
});

test('verify-rule20 emits to-issues-horizontal-layering when all decides precede first impl', () => {
  const wf: WorkflowDefinition = {
    id: 'wf_horizontal',
    version: '2.0',
    meta: { title: 'h', taskType: 'software', userInput: 'x', createdAt: new Date().toISOString() },
    stages: [
      {
        id: 'stage_decide_a',
        title: 'd a',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'd' },
        input: { sources: [{ type: 'user-input', label: '需求' }], mergeStrategy: 'concat' },
        outputs: [{ key: 'decisionRecord', format: 'markdown' }],
        pauseAfter: true,
        isDecisionStage: true,
      },
      {
        id: 'stage_decide_b',
        title: 'd b',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'd' },
        input: { sources: [{ type: 'user-input', label: '需求' }], mergeStrategy: 'concat' },
        outputs: [{ key: 'decisionRecord', format: 'markdown' }],
        pauseAfter: true,
        isDecisionStage: true,
      },
      {
        id: 'stage_test_write_a',
        title: 'tw a',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 't' },
        input: {
          sources: [{ type: 'stage-output', stageId: 'stage_decide_a', outputKey: 'decisionRecord', label: 'x' }],
          mergeStrategy: 'concat',
        },
        outputs: [{ key: 'tests', format: 'markdown' }],
        pauseAfter: false,
      },
      {
        id: 'stage_test_run_a',
        title: 'tr a',
        tool: 'code-runner',
        toolConfig: { type: 'code-runner', command: 'npm run test -- slice-a', captureOutput: true },
        input: {
          sources: [{ type: 'stage-output', stageId: 'stage_test_write_a', outputKey: 'tests', label: 'x' }],
          mergeStrategy: 'concat',
        },
        outputs: [{ key: 'report', format: 'markdown' }],
        pauseAfter: false,
      },
      {
        id: 'stage_test_write_b',
        title: 'tw b',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 't' },
        input: {
          sources: [{ type: 'stage-output', stageId: 'stage_decide_b', outputKey: 'decisionRecord', label: 'x' }],
          mergeStrategy: 'concat',
        },
        outputs: [{ key: 'tests', format: 'markdown' }],
        pauseAfter: false,
      },
      {
        id: 'stage_test_run_b',
        title: 'tr b',
        tool: 'code-runner',
        toolConfig: { type: 'code-runner', command: 'npm run test -- slice-b', captureOutput: true },
        input: {
          sources: [{ type: 'stage-output', stageId: 'stage_test_write_b', outputKey: 'tests', label: 'x' }],
          mergeStrategy: 'concat',
        },
        outputs: [{ key: 'report', format: 'markdown' }],
        pauseAfter: false,
      },
      {
        id: 'stage_impl_a',
        title: 'i a',
        tool: 'llm-text',
        toolConfig: {
          type: 'llm-text',
          systemPrompt: '严格按照已确认的决策清单实现，不得偏离。',
        },
        input: {
          sources: [
            { type: 'stage-output', stageId: 'stage_decide_a', outputKey: 'decisionRecord', label: '已确认的决策清单' },
          ],
          mergeStrategy: 'concat',
        },
        outputs: [{ key: 'code', format: 'text' }],
        pauseAfter: false,
      },
      {
        id: 'stage_impl_b',
        title: 'i b',
        tool: 'llm-text',
        toolConfig: {
          type: 'llm-text',
          systemPrompt: '严格按照已确认的决策清单实现，不得偏离。',
        },
        input: {
          sources: [
            { type: 'stage-output', stageId: 'stage_decide_b', outputKey: 'decisionRecord', label: '已确认的决策清单' },
          ],
          mergeStrategy: 'concat',
        },
        outputs: [{ key: 'code', format: 'text' }],
        pauseAfter: false,
      },
    ],
  };
  const result = verifyRule20(wf);
  assert.equal(result.passed, true);
  assert.equal(result.violations.length, 0);
  assert.equal(result.warnings.some((w) => w.type === 'to-issues-horizontal-layering'), true);
});

test('verify-rule20 emits to-issues warnings without blocking pass', () => {
  const wf = buildBaseWorkflow();
  wf.meta.taskType = 'software';
  wf.stages = [
    {
      id: 'stage_decide_all',
      title: 'decide all',
      tool: 'llm-text',
      toolConfig: { type: 'llm-text', systemPrompt: 'decision' },
      input: { sources: [{ type: 'user-input', label: '需求' }], mergeStrategy: 'concat' },
      outputs: [{ key: 'decisionRecord', format: 'markdown' }],
      pauseAfter: true,
      isDecisionStage: true,
    },
    {
      id: 'stage_test_write_parser',
      title: 'test write parser',
      tool: 'llm-text',
      toolConfig: { type: 'llm-text', systemPrompt: 'write tests' },
      input: { sources: [{ type: 'user-input', label: '需求' }], mergeStrategy: 'concat' },
      outputs: [{ key: 'tests', format: 'markdown' }],
      pauseAfter: true,
    },
    {
      id: 'stage_impl_all',
      title: 'impl all',
      tool: 'llm-text',
      toolConfig: { type: 'llm-text', systemPrompt: '严格按照已确认的决策清单实现，不得偏离。' },
      input: {
        sources: [{ type: 'stage-output', stageId: 'stage_decide_all', outputKey: 'decisionRecord', label: '已确认的决策清单' }],
        mergeStrategy: 'concat',
      },
      outputs: [{ key: 'code', format: 'text' }],
      pauseAfter: true,
    },
  ];

  const result = verifyRule20(wf);
  assert.equal(result.passed, true);
  assert.equal(result.violations.length, 0);
  assert.equal(result.warnings.some((w) => w.type === 'to-issues-missing-chain'), true);
  assert.equal(result.warnings.some((w) => w.type === 'to-issues-missing-verification'), true);
  assert.equal(result.warnings.some((w) => w.type === 'to-issues-monolithic-impl-naming'), true);
  assert.equal(result.warnings.some((w) => w.type === 'to-issues-high-hitl-ratio'), true);
});

test('verify-rule20 emits debug warnings without blocking pass', () => {
  const wf = buildBaseWorkflow();
  wf.meta.taskType = 'debug';
  wf.stages = [
    {
      id: 'stage_decide_debug_scope',
      title: 'decide debug scope',
      tool: 'llm-text',
      toolConfig: { type: 'llm-text', systemPrompt: 'debug scope' },
      input: { sources: [{ type: 'user-input', label: '故障描述' }], mergeStrategy: 'concat' },
      outputs: [{ key: 'decisionRecord', format: 'markdown' }],
      pauseAfter: true,
      isDecisionStage: true,
    },
    {
      id: 'stage_impl_debug_fix',
      title: 'implement debug fix',
      tool: 'llm-text',
      toolConfig: { type: 'llm-text', systemPrompt: 'apply fix' },
      input: { sources: [{ type: 'user-input', label: '上下文' }], mergeStrategy: 'concat' },
      outputs: [{ key: 'patch', format: 'markdown' }],
      pauseAfter: false,
    },
  ];

  const result = verifyRule20(wf);
  assert.equal(result.passed, true);
  assert.equal(result.violations.length, 0);
  assert.equal(result.warnings.some((w) => w.type === 'debug-missing-reproduce-stage'), true);
  assert.equal(result.warnings.some((w) => w.type === 'debug-missing-hypothesis-stage'), true);
  assert.equal(result.warnings.some((w) => w.type === 'debug-missing-verification-stage'), true);
  assert.equal(result.warnings.some((w) => w.type === 'debug-impl-missing-decision-source'), true);
});

test('verify-rule20 emits prototype warnings without blocking pass', () => {
  const wf = buildBaseWorkflow();
  wf.meta.taskType = 'prototype';
  wf.stages = [
    {
      id: 'stage_impl_prototype_mvp',
      title: 'build prototype mvp',
      tool: 'llm-text',
      toolConfig: { type: 'llm-text', systemPrompt: 'build quick demo' },
      input: { sources: [{ type: 'user-input', label: '目标' }], mergeStrategy: 'concat' },
      outputs: [{ key: 'mvp', format: 'markdown' }],
      pauseAfter: false,
    },
  ];

  const result = verifyRule20(wf);
  assert.equal(result.passed, true);
  assert.equal(result.violations.length, 0);
  assert.equal(result.warnings.some((w) => w.type === 'prototype-missing-verification-stage'), true);
  assert.equal(result.warnings.some((w) => w.type === 'prototype-missing-success-criteria'), true);
});

test('verify-rule20 skips prototype-missing-success-criteria when verification stage exists', () => {
  const wf = buildBaseWorkflow();
  wf.meta.taskType = 'prototype';
  wf.stages = [
    {
      id: 'stage_impl_prototype_mvp',
      title: 'build prototype mvp',
      tool: 'llm-text',
      toolConfig: {
        type: 'llm-text',
        systemPrompt: 'build quick demo',
        writeOutputToFile: 'mock_pipeline.py',
        writePathBase: 'workspace',
      },
      input: { sources: [{ type: 'user-input', label: '目标' }], mergeStrategy: 'concat' },
      outputs: [{ key: 'mvp', format: 'markdown' }],
      pauseAfter: false,
    },
    {
      id: 'stage_test_run_prototype_mock',
      title: '验证 Mock 管道可运行',
      tool: 'code-runner',
      toolConfig: {
        type: 'code-runner',
        command: 'python3 -m pip install -r requirements.txt && python3 mock_pipeline.py',
        captureOutput: true,
      },
      input: { sources: [{ type: 'user-input', label: '上下文' }], mergeStrategy: 'concat' },
      outputs: [{ key: 'testOutput', format: 'text' }],
      pauseAfter: false,
    },
  ];

  const result = verifyRule20(wf);
  assert.equal(result.passed, true);
  assert.equal(result.warnings.some((w) => w.type === 'prototype-missing-verification-stage'), false);
  assert.equal(result.warnings.some((w) => w.type === 'prototype-missing-success-criteria'), false);
});
