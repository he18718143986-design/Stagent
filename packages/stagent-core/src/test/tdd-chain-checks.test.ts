import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { Stage, WorkflowDefinition } from '../WorkflowDefinition';
import { lintMissingTestRunPairs, lintSoftwareRequiresVerification } from '../plan-completeness/tddChainChecks';

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

test('lintMissingTestRunPairs flags test_write without test_run', () => {
  const issues = lintMissingTestRunPairs(
    wf([stage('stage_test_write_mvp'), stage('stage_impl_mvp')]),
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0]!.type, 'missing-test-run-pair');
});

test('lintMissingTestRunPairs passes when test_run paired', () => {
  const issues = lintMissingTestRunPairs(
    wf([
      stage('stage_test_write_mvp'),
      stage('stage_impl_mvp'),
      stage('stage_test_run_mvp', 'code-runner'),
    ]),
  );
  assert.equal(issues.length, 0);
});

test('lintSoftwareRequiresVerification for single impl software', () => {
  const issue = lintSoftwareRequiresVerification(wf([stage('stage_impl_mvp')]));
  assert.ok(issue);
  assert.equal(issue!.type, 'missing-verification-stage');
});
