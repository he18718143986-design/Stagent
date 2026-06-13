import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { WorkflowDefinition, WorkflowInstance } from '../WorkflowDefinition';
import { resolveExportContractTestFiles } from '../WorkflowEngineWorkspaceLint';

const baseMeta = {
  title: 't',
  taskType: 'software' as const,
  userInput: 'x',
  createdAt: '2026-01-01T00:00:00.000Z',
};

function llmStage(id: string, writeOutputToFile: string) {
  return {
    id,
    title: id,
    tool: 'llm-text' as const,
    toolConfig: { type: 'llm-text' as const, systemPrompt: 'x', writeOutputToFile },
    input: { sources: [], mergeStrategy: 'concat' as const },
    outputs: [{ key: 'code', format: 'text' as const }],
    pauseAfter: false,
  };
}

function instanceFrom(def: WorkflowDefinition): WorkflowInstance {
  return {
    definition: def,
    stageRuntimes: [],
    status: 'running',
    currentStageIndex: 0,
  };
}

test('resolveExportContractTestFiles scopes to current slice at test_run（Run #61）', () => {
  const wf: WorkflowDefinition = {
    id: 'wf',
    version: '2.0',
    meta: baseMeta,
    stages: [
      llmStage('stage_test_write_signals', 'tests/test_signals.py'),
      llmStage('stage_test_write_risk', 'tests/test_risk.py'),
    ],
  };
  const inst = instanceFrom(wf);
  const all = resolveExportContractTestFiles(inst);
  assert.deepEqual(all.sort(), ['tests/test_risk.py', 'tests/test_signals.py']);
  assert.deepEqual(resolveExportContractTestFiles(inst, 'risk'), ['tests/test_risk.py']);
  assert.deepEqual(resolveExportContractTestFiles(inst, 'signals'), ['tests/test_signals.py']);
});
