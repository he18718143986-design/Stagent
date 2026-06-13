import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { Stage, WorkflowDefinition } from '../WorkflowDefinition';
import { assessGeneratedPlanStructure } from '../generation/assessGeneratedPlanStructure';
import { hardBlockPlanCompletenessIssues } from '../GeneratedWorkflowGate';

function stage(id: string, tool: Stage['tool'] = 'llm-text'): Stage {
  return {
    id,
    title: id,
    tool,
    toolConfig: { type: 'llm-text', systemPrompt: 'x' },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'text', format: 'text' }],
    pauseAfter: false,
  };
}

function wf(stages: Stage[], taskType: WorkflowDefinition['meta']['taskType'] = 'software'): WorkflowDefinition {
  return { id: 'w', version: '2.0', meta: { title: 't', taskType, userInput: 'u', createdAt: '' }, stages };
}

test('assessGeneratedPlanStructure flags low stage count for software', () => {
  const issue = assessGeneratedPlanStructure(
    wf([stage('stage_decide_a'), stage('stage_test_write_a')]),
    'software',
  );
  assert.equal(issue?.issue, 'stage_count_too_low');
});

test('assessGeneratedPlanStructure flags test_write without test_run', () => {
  const issue = assessGeneratedPlanStructure(
    wf([
      stage('stage_decide_a'),
      stage('stage_test_write_mvp'),
      stage('stage_impl_mvp'),
      stage('stage_setup', 'code-runner'),
    ]),
    'software',
  );
  assert.ok(issue);
  assert.equal(issue!.issue, 'missing_test_run_pair');
});

test('hardBlockPlanCompletenessIssues catches missing-test-run-pair', () => {
  const issues = hardBlockPlanCompletenessIssues(
    wf([stage('stage_test_write_mvp'), stage('stage_impl_mvp')]),
    'software',
  );
  assert.ok(issues.some((i) => i.type === 'missing-test-run-pair'));
});
