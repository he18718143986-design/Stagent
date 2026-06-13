import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { WorkflowDefinition } from '../WorkflowDefinition';
import { verifyRule20 } from '../Rule20Verify';

test('verify-debug: pass-minimal shape has no violations', () => {
  const wf: WorkflowDefinition = {
    id: 'wf_debug_pass_test',
    version: '2.0',
    meta: { title: 'debug pass', taskType: 'debug', userInput: 'x', createdAt: new Date().toISOString() },
    stages: [
      {
        id: 'stage_reproduce_debug_case',
        title: 'reproduce',
        tool: 'code-runner',
        toolConfig: { type: 'code-runner', command: 'npm run test -- x', captureOutput: true },
        input: { sources: [{ type: 'user-input', label: '故障' }], mergeStrategy: 'concat' },
        outputs: [{ key: 'r', format: 'markdown' }],
        pauseAfter: false,
      },
      {
        id: 'stage_hypothesis_debug_root_cause',
        title: 'root cause hypothesis',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'x' },
        input: { sources: [{ type: 'stage-output', stageId: 'stage_reproduce_debug_case', outputKey: 'r' }], mergeStrategy: 'concat' },
        outputs: [{ key: 'hypothesis', format: 'markdown' }],
        pauseAfter: false,
      },
      {
        id: 'stage_impl_debug_fix',
        title: 'impl debug fix',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'x' },
        input: { sources: [{ type: 'stage-output', stageId: 'stage_hypothesis_debug_root_cause', outputKey: 'hypothesis' }], mergeStrategy: 'concat' },
        outputs: [{ key: 'patch', format: 'markdown' }],
        pauseAfter: false,
      },
      {
        id: 'stage_test_run_debug_regression',
        title: 'regression',
        tool: 'code-runner',
        toolConfig: { type: 'code-runner', command: 'npm run test -- y', captureOutput: true },
        input: { sources: [{ type: 'stage-output', stageId: 'stage_impl_debug_fix', outputKey: 'patch' }], mergeStrategy: 'concat' },
        outputs: [{ key: 'v', format: 'markdown' }],
        pauseAfter: false,
      },
    ],
  };

  const result = verifyRule20(wf);
  assert.equal(result.passed, true);
  assert.equal(result.violations.length, 0);
  assert.equal(result.warnings.length, 0);
});

