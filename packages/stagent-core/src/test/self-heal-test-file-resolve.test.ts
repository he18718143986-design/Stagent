import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { Stage, WorkflowDefinition } from '../WorkflowDefinition';
import { injectSelfHealStages } from '../workflow-self-heal/injectSelfHealStages';
import {
  inferPythonTestFile,
  resolvePythonImplFileForFix,
  resolvePythonTestFileForVerify,
} from '../workflow-self-heal/SelfHealStageFactory';

function llmWrite(id: string, file: string): Stage {
  return {
    id,
    title: id,
    tool: 'llm-text',
    toolConfig: { type: 'llm-text', systemPrompt: 'x', writeOutputToFile: file },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'out', format: 'text' }],
    pauseAfter: false,
  };
}

function codeRunner(id: string, command: string): Stage {
  return {
    id,
    title: id,
    tool: 'code-runner',
    toolConfig: { type: 'code-runner', command, captureOutput: true },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'verifyOut', format: 'text' }],
    pauseAfter: false,
  };
}

const baseMeta = {
  title: 't',
  taskType: 'prototype' as const,
  userInput: 'u',
  createdAt: new Date().toISOString(),
};

test('resolvePythonTestFileForVerify reads test_write writeOutputToFile', () => {
  const stages = [
    llmWrite('stage_impl_main', 'main.py'),
    llmWrite('stage_test_write_main', 'tests/test_core.py'),
    codeRunner('stage_test_run_main', 'pytest -q'),
  ];
  assert.equal(inferPythonTestFile('stage_test_run_main'), 'tests/test_main.py');
  assert.equal(resolvePythonTestFileForVerify('stage_test_run_main', stages), 'tests/test_core.py');
});

test('resolvePythonImplFileForFix reads impl writeOutputToFile', () => {
  const stages = [
    llmWrite('stage_impl_main', 'main.py'),
    llmWrite('stage_test_write_main', 'tests/test_core.py'),
    codeRunner('stage_test_run_main', 'pytest -q'),
  ];
  assert.equal(resolvePythonImplFileForFix('stage_test_run_main', stages), 'main.py');
});

test('injectSelfHealStages uses test_write path for verify_imports command', () => {
  const wf: WorkflowDefinition = {
    id: 'wf',
    version: '2.0',
    meta: baseMeta,
    stages: [
      llmWrite('stage_impl_main', 'main.py'),
      llmWrite('stage_test_write_main', 'tests/test_core.py'),
      codeRunner('stage_test_run_main', 'pytest -q tests/test_core.py'),
    ],
  };
  const { workflow } = injectSelfHealStages(wf);
  const verify = workflow.stages.find((s) => s.id === 'stage_verify_imports_main');
  assert.ok(verify);
  const cmd = verify!.toolConfig.type === 'code-runner' ? verify!.toolConfig.command : '';
  assert.match(cmd, /tests\/test_core\.py/);
  assert.doesNotMatch(cmd, /tests\/test_main\.py/);
});

test('injectSelfHealStages fix stage targets impl file not test file', () => {
  const wf: WorkflowDefinition = {
    id: 'wf',
    version: '2.0',
    meta: baseMeta,
    stages: [
      llmWrite('stage_impl_main', 'main.py'),
      llmWrite('stage_test_write_main', 'tests/test_core.py'),
      codeRunner('stage_test_run_main', 'pytest -q tests/test_core.py'),
    ],
  };
  const { workflow } = injectSelfHealStages(wf);
  const fix = workflow.stages.find((s) => s.id === 'stage_fix_if_failed_main');
  assert.ok(fix);
  assert.equal(fix!.toolConfig.type === 'llm-text' ? fix!.toolConfig.writeOutputToFile : '', 'main.py');
});
