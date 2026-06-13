import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { collectWorkflowArtifacts } from '../WorkflowArtifactRegistry';
import { registryCoversPythonTopLevelModule } from '../artifact-registry/importPathCoverage';
import { lintSdkPathContract } from '../SdkPathContractLint';
import { lintTestWriteImportPathsInPlan } from '../plan-completeness/testWriteImportChecks';
import type { Stage, WorkflowDefinition } from '../WorkflowDefinition';

function implStage(id: string, file: string): Stage {
  return {
    id,
    title: id,
    tool: 'llm-text',
    toolConfig: { type: 'llm-text', systemPrompt: 'x', writeOutputToFile: file, writePathBase: 'workspace' },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'fileContent', format: 'text' }],
    pauseAfter: false,
  };
}

function testWriteStage(id: string, file: string, systemPrompt: string): Stage {
  return {
    id,
    title: id,
    tool: 'llm-text',
    toolConfig: {
      type: 'llm-text',
      systemPrompt,
      writeOutputToFile: file,
      writePathBase: 'workspace',
    },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'fileContent', format: 'text' }],
    pauseAfter: false,
  };
}

function packageLayoutWorkflow(): WorkflowDefinition {
  return {
    id: 'wf_pkg_layout',
    version: '2.0',
    meta: { title: 't', taskType: 'software', userInput: 'x', createdAt: new Date().toISOString() },
    stages: [
      implStage('stage_impl_indicators', 'indicators/__init__.py'),
      testWriteStage(
        'stage_test_write_indicators',
        'tests/test_indicators.py',
        'from indicators import calculate_ma\nassert calculate_ma',
      ),
    ],
  };
}

test('registryCoversPythonTopLevelModule accepts package __init__.py layout', () => {
  const registry = collectWorkflowArtifacts(packageLayoutWorkflow());
  assert.equal(registryCoversPythonTopLevelModule(registry, 'indicators'), true);
  assert.equal(registryCoversPythonTopLevelModule(registry, 'missing'), false);
});

test('lintSdkPathContract allows from indicators import when plan has indicators/__init__.py', () => {
  const workflow = packageLayoutWorkflow();
  const registry = collectWorkflowArtifacts(workflow);
  const issues = lintSdkPathContract({
    workflow,
    files: [
      {
        path: 'tests/test_indicators.py',
        content: 'from indicators import calculate_ma\n\ndef test_ma():\n    assert calculate_ma([1, 2, 3])',
      },
    ],
    decisionRecords: [],
    registry,
  });
  assert.equal(
    issues.some((i) => i.code === 'test-import-path-not-in-plan'),
    false,
    issues.map((i) => i.message).join('; '),
  );
});

test('lintTestWriteImportPathsInPlan accepts package module import in prompt', () => {
  const issues = lintTestWriteImportPathsInPlan(packageLayoutWorkflow());
  assert.equal(
    issues.some((i) => i.type === 'test-write-import-not-in-plan'),
    false,
    issues.map((i) => i.message).join('; '),
  );
});
