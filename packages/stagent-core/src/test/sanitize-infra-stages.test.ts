import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { Stage } from '../WorkflowDefinition';
import { sanitizeInfraStages, sanitizeInfraStagesOnWorkflow } from '../plan-compiler/sanitizeInfraStages';
import { STAGE_INIT_NPM_WORKSPACE_ID } from '../disk-bootstrap/constants';

function implStage(id: string): Stage {
  return {
    id,
    title: 'impl',
    tool: 'llm-text',
    toolConfig: { type: 'llm-text', systemPrompt: 'x' },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'text', format: 'text' }],
    pauseAfter: false,
  };
}

test('sanitizeInfraStages removes LLM npm init and records warnings', () => {
  const npmInit: Stage = {
    id: STAGE_INIT_NPM_WORKSPACE_ID,
    title: 'npm init',
    tool: 'code-runner',
    toolConfig: { type: 'code-runner', command: 'npm init -y', captureOutput: true },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'npmInitLog', format: 'text' }],
    pauseAfter: false,
  };
  const { stages, warnings, discardedStageIds } = sanitizeInfraStages(
    [npmInit, implStage('stage_impl_x')],
    'python',
  );
  assert.equal(stages.length, 1);
  assert.equal(stages[0].id, 'stage_impl_x');
  assert.ok(warnings.some((w) => w.includes('llm_infra_stage_discarded')));
  assert.deepEqual(discardedStageIds, [STAGE_INIT_NPM_WORKSPACE_ID]);
});

test('sanitizeInfraStages keeps stage_test_run with .venv/bin/python pytest', () => {
  const testRun: Stage = {
    id: 'stage_test_run_indicators',
    title: 'pytest',
    tool: 'code-runner',
    toolConfig: {
      type: 'code-runner',
      command: '.venv/bin/python -m pytest -q tests/test_indicators.py',
      captureOutput: true,
    },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'testLog', format: 'text' }],
    pauseAfter: false,
  };
  const { stages, discardedStageIds } = sanitizeInfraStages(
    [implStage('stage_impl_indicators'), testRun],
    'python',
  );
  assert.equal(stages.length, 2);
  assert.deepEqual(discardedStageIds, []);
});

test('sanitizeInfraStagesOnWorkflow attaches planCompilerWarnings', () => {
  const venv: Stage = {
    id: 'stage_venv_create',
    title: 'venv',
    tool: 'code-runner',
    toolConfig: { type: 'code-runner', command: 'python3 -m venv .venv', captureOutput: true },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'venvLog', format: 'text' }],
    pauseAfter: false,
  };
  const out = sanitizeInfraStagesOnWorkflow(
    {
      id: 'wf',
      version: '2.0',
      meta: { title: 't', taskType: 'software', userInput: 'u', createdAt: new Date().toISOString() },
      stages: [venv, implStage('stage_impl_a')],
    },
    'python',
  );
  assert.equal(out.stages?.length, 1);
  assert.ok(out.planCompilerWarnings?.some((w) => w.includes('stage_venv_create')));
});
