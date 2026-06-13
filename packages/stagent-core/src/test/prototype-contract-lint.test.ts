import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { isWeakIntegrationAssertion, lintPrototypeDataContract } from '../PrototypeContractLint';
import type { Stage, WorkflowDefinition } from '../WorkflowDefinition';

function s(partial: Partial<Stage> & Pick<Stage, 'id'>): Stage {
  return {
    title: partial.id,
    tool: 'llm-text',
    toolConfig: { type: 'llm-text', systemPrompt: 'x' },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'out', format: 'text' }],
    pauseAfter: false,
    ...partial,
  };
}

function llm(id: string, file: string, sources: Stage['input']['sources'] = []): Stage {
  return s({
    id,
    toolConfig: { type: 'llm-text', systemPrompt: 'x', writeOutputToFile: file },
    input: { sources, mergeStrategy: 'concat' },
  });
}

function decision(id: string): Stage {
  return s({
    id,
    isDecisionStage: true,
    outputs: [{ key: 'decisionRecord', format: 'markdown' }],
  });
}

function testRun(id: string, command: string): Stage {
  return {
    id,
    title: id,
    tool: 'code-runner',
    toolConfig: { type: 'code-runner', command, captureOutput: true },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'text', format: 'text' }],
    pauseAfter: false,
  };
}

function wf(stages: Stage[]): WorkflowDefinition {
  return {
    id: 'w',
    version: '2.0',
    meta: { title: 't', taskType: 'prototype', userInput: 'u', createdAt: '' },
    stages,
  };
}

const DECISION_SRC = [
  { type: 'stage-output' as const, stageId: 'stage_decide_prototype_hypothesis', outputKey: 'decisionRecord' },
];

test('flags the exact failing-run shape: unshared sample/mock + impl missing decision + weak assert', () => {
  const w = wf([
    decision('stage_decide_prototype_hypothesis'),
    llm('stage_impl_prototype_reader', 'reader.py'), // missing decision source
    llm('stage_impl_prototype_analyzer', 'analyzer.py'), // missing decision source
    llm('stage_impl_prototype_create_sample', 'create_sample.py'),
    llm('stage_impl_prototype_mock_data', 'mock_data.json'), // not sharing create_sample
    llm('stage_impl_prototype_main', 'main.py'), // missing decision source
    testRun(
      'stage_test_run_prototype_mock_pipeline',
      '.venv/bin/python main.py --mode mock && .venv/bin/python -c "import csv,glob;rows=list(csv.DictReader(open(glob.glob(\'output/*.csv\')[0])));assert len(rows)>=3"',
    ),
  ]);
  const warnings = lintPrototypeDataContract(w);
  assert.ok(warnings.includes('contract:sample-mock-source-unshared:stage_impl_prototype_mock_data'));
  assert.ok(warnings.includes('contract:impl-missing-decision-source:stage_impl_prototype_reader'));
  assert.ok(warnings.includes('contract:impl-missing-decision-source:stage_impl_prototype_analyzer'));
  assert.ok(warnings.includes('contract:impl-missing-decision-source:stage_impl_prototype_main'));
  assert.ok(warnings.includes('contract:weak-integration-assertion:stage_test_run_prototype_mock_pipeline'));
});

test('clean prototype: shared source + decision-sourced impl + content assertion → no contract warnings', () => {
  const w = wf([
    decision('stage_decide_prototype_hypothesis'),
    llm('stage_impl_prototype_reader', 'reader.py', DECISION_SRC),
    llm('stage_impl_prototype_analyzer', 'analyzer.py', DECISION_SRC),
    llm('stage_impl_prototype_main', 'main.py', DECISION_SRC),
    llm('stage_impl_prototype_create_sample', 'create_sample.py'),
    llm('stage_impl_prototype_mock_data', 'mock_data.json', [
      { type: 'stage-output', stageId: 'stage_impl_prototype_create_sample', outputKey: 'createSamplePy' },
    ]),
    testRun(
      'stage_test_run_prototype_mock_pipeline',
      '.venv/bin/python main.py --mode mock && .venv/bin/python -c "import csv,glob;rows=list(csv.DictReader(open(glob.glob(\'output/*.csv\')[0])));ok=[r for r in rows if r.get(\'query_status\')==\'success\'];assert ok and len(rows)>=3"',
    ),
  ]);
  assert.deepEqual(lintPrototypeDataContract(w), []);
});

test('non-prototype workflows are not linted', () => {
  const w: WorkflowDefinition = {
    id: 'w',
    version: '2.0',
    meta: { title: 't', taskType: 'software', userInput: 'u', createdAt: '' },
    stages: [llm('stage_impl_core', 'core.py')],
  };
  assert.deepEqual(lintPrototypeDataContract(w), []);
});

test('isWeakIntegrationAssertion: count-only weak; content-aware strong; no-assert weak', () => {
  assert.equal(isWeakIntegrationAssertion('python main.py && python -c "assert len(rows)>=3"'), true);
  assert.equal(
    isWeakIntegrationAssertion('python main.py && python -c "assert any(r[\'query_status\']==\'success\' for r in rows)"'),
    false,
  );
  assert.equal(isWeakIntegrationAssertion('python main.py'), true);
});
