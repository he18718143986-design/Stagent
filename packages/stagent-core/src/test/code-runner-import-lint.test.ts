import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { detectPythonImportLintIssues } from '../CodeRunnerImportLint';
import { collectWorkflowArtifacts } from '../WorkflowArtifactRegistry';
import type { WorkflowDefinition } from '../WorkflowDefinition';

function buildPrototypeArtifactWorkflow(): WorkflowDefinition {
  return {
    id: 'wf_import_lint',
    version: '2.0',
    meta: { title: 't', taskType: 'prototype', userInput: 'x', createdAt: new Date().toISOString() },
    stages: [
      {
        id: 'stage_impl_prototype_config',
        title: 'config yaml',
        tool: 'llm-text',
        toolConfig: {
          type: 'llm-text',
          systemPrompt: 'x',
          writeOutputToFile: 'config.yaml',
          writePathBase: 'workspace',
        },
        input: { sources: [], mergeStrategy: 'concat' },
        outputs: [{ key: 'fileContent', format: 'text' }],
        pauseAfter: false,
      },
      {
        id: 'stage_impl_prototype_fetcher',
        title: 'fetcher',
        tool: 'llm-text',
        toolConfig: {
          type: 'llm-text',
          systemPrompt: 'x',
          writeOutputToFile: 'fetcher.py',
          writePathBase: 'workspace',
        },
        input: { sources: [], mergeStrategy: 'concat' },
        outputs: [{ key: 'fileContent', format: 'text' }],
        pauseAfter: false,
      },
      {
        id: 'stage_impl_prototype_reader',
        title: 'reader',
        tool: 'llm-text',
        toolConfig: {
          type: 'llm-text',
          systemPrompt: 'x',
          writeOutputToFile: 'reader.py',
          writePathBase: 'workspace',
        },
        input: { sources: [], mergeStrategy: 'concat' },
        outputs: [{ key: 'fileContent', format: 'text' }],
        pauseAfter: false,
      },
      {
        id: 'stage_test_run_prototype_fetcher_check',
        title: 'fetcher check',
        tool: 'code-runner',
        toolConfig: {
          type: 'code-runner',
          command:
            '.venv/bin/python -c "from fetcher import fetch_product_info; from config import load_config; cfg=load_config(\'config.yaml\'); print(fetch_product_info(\'B0\', cfg))"',
          captureOutput: true,
          pathBase: 'workspace',
          workingDir: '.',
        },
        input: { sources: [], mergeStrategy: 'concat' },
        outputs: [{ key: 'text', format: 'text' }],
        pauseAfter: false,
      },
    ],
  };
}

test('detectPythonImportLintIssues flags missing config module when only config.yaml exists', () => {
  const wf = buildPrototypeArtifactWorkflow();
  const registry = collectWorkflowArtifacts(wf);
  const stage = wf.stages.find((s) => s.id === 'stage_test_run_prototype_fetcher_check')!;
  const cmd = (stage.toolConfig as { command: string }).command;
  const issues = detectPythonImportLintIssues(cmd, registry, { stageId: stage.id });
  assert.ok(
    issues.some((i) => i.code === 'python-c-import-not-in-artifacts' && /模块「config」/.test(i.message)),
  );
});

test('detectPythonImportLintIssues allows yaml import with requirements.txt', () => {
  const wf = buildPrototypeArtifactWorkflow();
  wf.stages.unshift({
    id: 'stage_impl_prototype_requirements',
    title: 'req',
    tool: 'llm-text',
    toolConfig: {
      type: 'llm-text',
      systemPrompt: 'x',
      writeOutputToFile: 'requirements.txt',
      writePathBase: 'workspace',
    },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'fileContent', format: 'text' }],
    pauseAfter: false,
  });
  const registry = collectWorkflowArtifacts(wf);
  const cmd =
    '.venv/bin/python -c "import yaml; from fetcher import fetch_product_info; cfg=yaml.safe_load(open(\'config.yaml\')); print(fetch_product_info(\'B0\', cfg))"';
  const issues = detectPythonImportLintIssues(cmd, registry);
  assert.equal(issues.length, 0);
});

test('detectPythonImportLintIssues allows numpy (third-party) when requirements.txt declared', () => {
  const wf = buildPrototypeArtifactWorkflow();
  wf.stages.unshift({
    id: 'stage_impl_prototype_requirements',
    title: 'req',
    tool: 'llm-text',
    toolConfig: { type: 'llm-text', systemPrompt: 'x', writeOutputToFile: 'requirements.txt', writePathBase: 'workspace' },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'fileContent', format: 'text' }],
    pauseAfter: false,
  });
  const registry = collectWorkflowArtifacts(wf);
  const cmd = '.venv/bin/python -c "import numpy as np, pandas as pd; from reader import read; print(np.array([1]))"';
  const issues = detectPythonImportLintIssues(cmd, registry);
  assert.equal(issues.length, 0, '声明 requirements.txt 后第三方包不应被拦');
});

test('detectPythonImportLintIssues flags undeclared non-third-party module without requirements.txt', () => {
  const wf = buildPrototypeArtifactWorkflow();
  const registry = collectWorkflowArtifacts(wf);
  // myhelper 既非 stdlib、非已生成 .py、非已知三方、且无 requirements.txt → flag-undeclared
  const cmd = '.venv/bin/python -c "import myhelper; print(myhelper.x)"';
  const issues = detectPythonImportLintIssues(cmd, registry);
  assert.ok(issues.some((i) => i.code === 'python-c-import-not-in-artifacts' && /myhelper/.test(i.message)));
});
