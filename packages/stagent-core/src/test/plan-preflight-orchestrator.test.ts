import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { WorkflowDefinition } from '../WorkflowDefinition';
import { runPlanPreflight } from '../plan-preflight/PlanPreflightOrchestrator';

const baseMeta = {
  title: 't',
  taskType: 'software',
  userInput: 'build app',
  createdAt: new Date().toISOString(),
};

function minimalSoftwareWf(): WorkflowDefinition {
  return {
    id: 'wf_preflight',
    version: '2.0',
    meta: baseMeta,
    stages: [
      {
        id: 'stage_decide_x',
        title: '决策',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'decide' },
        input: { sources: [], mergeStrategy: 'concat' },
        outputs: [{ key: 'decisionRecord', format: 'markdown' }],
        pauseAfter: true,
        isDecisionStage: true,
      },
      {
        id: 'stage_impl_x',
        title: '实现',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'impl' },
        input: { sources: [], mergeStrategy: 'concat' },
        outputs: [{ key: 'text', format: 'text' }],
        pauseAfter: false,
      },
      {
        id: 'stage_test_run_x',
        title: '测试',
        tool: 'code-runner',
        toolConfig: { type: 'code-runner', command: 'npm test', captureOutput: true },
        input: { sources: [], mergeStrategy: 'concat' },
        outputs: [{ key: 'testResults', format: 'json' }],
        pauseAfter: false,
      },
    ],
  };
}

describe('runPlanPreflight', () => {
  it('passes minimal software workflow when plan completeness disabled', () => {
    const wf = minimalSoftwareWf();
    const result = runPlanPreflight(wf, {
      taskType: 'software',
      userInput: baseMeta.userInput,
      planCompletenessEnabled: false,
      structuralRepairMode: 'off',
      fullOrchestration: false,
      normalizeWorkflow: (w) => w,
    });
    assert.equal('ok' in result && result.ok, true);
  });

  it('returns contractFailed for invalid workflow contract', () => {
    const wf = { ...minimalSoftwareWf(), version: '0.0' as '2.0' };
    const result = runPlanPreflight(wf, {
      taskType: 'software',
      userInput: baseMeta.userInput,
      planCompletenessEnabled: false,
      structuralRepairMode: 'off',
      fullOrchestration: false,
      normalizeWorkflow: (w) => w,
    });
    assert.equal('contractFailed' in result && result.contractFailed, true);
  });
});
