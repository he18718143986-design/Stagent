import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { Stage, WorkflowDefinition } from '../WorkflowDefinition';
import {
  injectSelfHealStages,
  reorderVenvChainAfterRequirementsWriter,
} from '../workflow-self-heal/injectSelfHealStages';
import { buildVenvCreateStage, buildVenvPipInstallStage } from '../workflow-self-heal/SelfHealStageFactory';

function llmImpl(id: string, writeTo: string): Stage {
  return {
    id,
    title: id,
    tool: 'llm-text',
    toolConfig: { type: 'llm-text', systemPrompt: 'x', writeOutputToFile: writeTo, writePathBase: 'workspace' },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'text', format: 'text' }],
    pauseAfter: false,
  };
}

function testRun(id: string): Stage {
  return {
    id,
    title: id,
    tool: 'code-runner',
    toolConfig: { type: 'code-runner', command: '.venv/bin/pytest tests/test_x.py', captureOutput: true },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'out', format: 'text' }],
    pauseAfter: false,
  };
}

test('reorderVenvChainAfterRequirementsWriter moves venv pip after requirements impl', () => {
  const stages: Stage[] = [
    llmImpl('stage_impl_a', 'src/a.py'),
    buildVenvCreateStage(['stage_impl_a']),
    buildVenvPipInstallStage(['stage_venv_create'], '.venv/bin/python -m pip install -r requirements.txt'),
    llmImpl('stage_impl_requirements', 'requirements.txt'),
    testRun('stage_test_run_mvp'),
  ];
  const { stages: next, moved } = reorderVenvChainAfterRequirementsWriter(stages, stages.length);
  assert.equal(moved, true);
  const reqIdx = next.findIndex((s) => s.id === 'stage_impl_requirements');
  const pipIdx = next.findIndex((s) => s.id === 'stage_venv_pip_install');
  assert.ok(reqIdx >= 0 && pipIdx > reqIdx);
  assert.deepEqual(next.find((s) => s.id === 'stage_venv_create')?.dependsOn, ['stage_impl_requirements']);
});

test('injectSelfHealStages places venv pip after requirements writer (E9)', () => {
  const wf: WorkflowDefinition = {
    id: 'w',
    version: '2.0',
    meta: { title: 't', taskType: 'software', userInput: 'u', createdAt: '' },
    stages: [
      llmImpl('stage_impl_core', 'main.py'),
      {
        id: 'stage_test_write_mvp',
        title: 'tw',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'x', writeOutputToFile: 'tests/test_mvp.py' },
        input: { sources: [], mergeStrategy: 'concat' },
        outputs: [{ key: 'text', format: 'text' }],
        pauseAfter: false,
      },
      llmImpl('stage_impl_requirements', 'requirements.txt'),
      testRun('stage_test_run_mvp'),
    ],
  };
  const { workflow } = injectSelfHealStages(wf);
  const reqIdx = workflow.stages.findIndex((s) => s.id === 'stage_impl_requirements');
  const pipIdx = workflow.stages.findIndex((s) => s.id === 'stage_venv_pip_install');
  assert.ok(reqIdx >= 0, 'requirements writer present');
  assert.ok(pipIdx > reqIdx, 'venv pip after requirements writer');
});
