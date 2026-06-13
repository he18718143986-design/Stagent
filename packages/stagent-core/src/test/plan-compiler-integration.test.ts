import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { Stage, WorkflowDefinition } from '../WorkflowDefinition';
import { compilePlan } from '../plan-compiler/compilePlan';
import { STAGE_INIT_NPM_WORKSPACE_ID } from '../disk-bootstrap/constants';

function pythonExpressWf(stages: Stage[]): WorkflowDefinition {
  return {
    id: 'wf_pc',
    version: '2.0',
    meta: {
      title: 't',
      taskType: 'software',
      userInput: 'pytest TDD',
      createdAt: new Date().toISOString(),
      workflowTemplate: 'express',
    },
    globalConfig: { language: 'python', stackProfile: 'python' },
    stages,
  };
}

test('compilePlan strips LLM npm infra then bootstraps python chain without npm', () => {
  const impl: Stage = {
    id: 'stage_impl_calc',
    title: 'impl',
    tool: 'llm-text',
    toolConfig: { type: 'llm-text', systemPrompt: 'impl', writeOutputToFile: 'calc.py' },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'implCode', format: 'text' }],
    pauseAfter: false,
  };
  const npmInit: Stage = {
    id: STAGE_INIT_NPM_WORKSPACE_ID,
    title: 'npm',
    tool: 'code-runner',
    toolConfig: { type: 'code-runner', command: 'npm init -y', captureOutput: true },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'npmInitLog', format: 'text' }],
    pauseAfter: false,
  };
  const result = compilePlan(pythonExpressWf([npmInit, impl]), {
    taskType: 'software',
    userInput: 'Python pytest TDD calculator',
    planCompletenessEnabled: false,
    structuralRepairMode: 'off',
    fullOrchestration: true,
    normalizeWorkflow: (w) => w,
  });
  assert.ok('ok' in result && result.ok);
  const ids = result.workflow.stages?.map((s) => s.id) ?? [];
  assert.ok(!ids.includes(STAGE_INIT_NPM_WORKSPACE_ID));
  assert.ok(ids.includes('stage_impl_calc'));
});
