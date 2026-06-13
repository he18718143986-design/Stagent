import * as fs from 'fs';
import * as path from 'path';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { validateGeneratedWorkflow } from '../WorkflowValidation';
import { verifyRule20 } from '../Rule20Verify';
import type { WorkflowDefinition } from '../WorkflowDefinition';

test('validateGeneratedWorkflow rejects test_run importing missing config module', () => {
  const fixturePath = path.join(
    process.cwd(),
    'scripts/fixtures/prototype/fail-missing-config-py-import.json',
  );
  const wf = JSON.parse(fs.readFileSync(fixturePath, 'utf-8')) as WorkflowDefinition;
  const errors = validateGeneratedWorkflow(wf);
  assert.ok(errors.some((e) => e.includes('python-c-import-not-in-artifacts') || e.includes('config')));
  const rule20 = verifyRule20(wf);
  assert.equal(rule20.passed, false);
  assert.ok(rule20.violations.some((v) => v.type === 'test-run-imports-missing-artifact'));
});

test('verifyRule20 warns prototype impl missing file-read followup', () => {
  const fixturePath = path.join(
    process.cwd(),
    'scripts/fixtures/prototype/fail-missing-config-py-import.json',
  );
  const wf = JSON.parse(fs.readFileSync(fixturePath, 'utf-8')) as WorkflowDefinition;
  const result = verifyRule20(wf);
  assert.ok(
    result.warnings.some((w) => w.type === 'prototype-impl-missing-file-read-followup'),
    JSON.stringify(result.warnings.map((w) => w.type)),
  );
});

test('verifyRule20 does NOT warn when downstream code-runner runs entry main.py', () => {
  const impl = (name: string, file: string): WorkflowDefinition['stages'][number] =>
    ({
      id: `stage_impl_prototype_${name}`,
      title: `生成 ${file}`,
      tool: 'llm-text',
      toolConfig: { type: 'llm-text', systemPrompt: `生成 ${file}`, writeOutputToFile: file },
      input: {
        sources: [
          {
            type: 'stage-output',
            stageId: 'stage_decide_prototype_arch',
            outputKey: 'decisionRecord',
            label: '决策',
          },
        ],
        mergeStrategy: 'concat',
      },
      outputs: [{ key: `${name}Py`, format: 'markdown' }],
      pauseAfter: false,
    }) as WorkflowDefinition['stages'][number];

  const wf: WorkflowDefinition = {
    id: 'wf_prototype_multi_module_entry',
    version: '2.0',
    meta: { title: '多模块原型', taskType: 'prototype', userInput: '原型', createdAt: '2026-05-30T00:00:00.000Z' },
    stages: [
      {
        id: 'stage_decide_prototype_arch',
        title: '全局架构决策',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: '明确模块边界与契约' },
        input: { sources: [{ type: 'user-input', label: '目标' }], mergeStrategy: 'concat' },
        outputs: [{ key: 'decisionRecord', format: 'markdown' }],
        isDecisionStage: true,
        pauseAfter: true,
      },
      impl('reader', 'reader.py'),
      impl('fetcher', 'fetcher.py'),
      impl('analyzer', 'analyzer.py'),
      impl('writer', 'writer.py'),
      impl('main', 'main.py'),
      {
        id: 'stage_test_run_prototype_integration',
        title: '集成测试与验证',
        tool: 'code-runner',
        toolConfig: {
          type: 'code-runner',
          command: 'python -m venv .venv && pip install -r requirements.txt && python main.py',
          captureOutput: true,
        },
        input: { sources: [{ type: 'user-input', label: '运行' }], mergeStrategy: 'concat' },
        outputs: [{ key: 'report', format: 'markdown' }],
        pauseAfter: false,
      },
    ],
  } as WorkflowDefinition;

  const result = verifyRule20(wf);
  assert.ok(
    !result.warnings.some((w) => w.type === 'prototype-impl-missing-file-read-followup'),
    JSON.stringify(result.warnings.map((w) => `${w.type}:${w.stageId}`)),
  );
});
