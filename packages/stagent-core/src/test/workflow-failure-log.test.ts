import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { sanitizeFailureSummary, truncateFailureSummary, buildWorkflowFailureRecord } from '../WorkflowFailureLog';
import type { WorkflowDefinition, WorkflowInstance } from '../WorkflowDefinition';

test('sanitizeFailureSummary redacts common secret shapes', () => {
  assert.match(sanitizeFailureSummary('key sk-abcdefghijklmnopqrst'), /\[REDACTED\]/);
  assert.match(sanitizeFailureSummary('h Bearer abcdefghi'), /\[REDACTED\]/);
  assert.match(sanitizeFailureSummary('x password=secret123'), /\[REDACTED\]/);
});

test('truncateFailureSummary caps length', () => {
  const long = 'x'.repeat(300);
  assert.equal(truncateFailureSummary(long, 200).length, 201);
  assert.ok(truncateFailureSummary(long, 200).endsWith('…'));
});

test('buildWorkflowFailureRecord returns null without taskDir', () => {
  const wf: WorkflowDefinition = {
    id: 'wf_t',
    version: '2.0',
    meta: { title: 't', taskType: 'software', userInput: '', createdAt: '' },
    stages: [
      {
        id: 's1',
        title: 'S1',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'x' },
        input: { sources: [], mergeStrategy: 'concat' },
        outputs: [{ key: 'text', format: 'text' }],
        pauseAfter: false,
      },
    ],
  };
  const inst: WorkflowInstance = {
    definition: wf,
    currentStageIndex: 0,
    stageRuntimes: wf.stages.map((s) => ({ stageId: s.id, status: 'pending', outputs: {}, retryCount: 1 })),
    status: 'running',
    traceId: 'trace_test',
  };
  assert.equal(buildWorkflowFailureRecord(inst, { stageId: 's1', error: 'boom', errorType: 'unknown' }), null);
});

test('buildWorkflowFailureRecord builds row when taskDir set', () => {
  const wf: WorkflowDefinition = {
    id: 'wf_t',
    version: '2.0',
    meta: { title: 't', taskType: 'software', userInput: '', createdAt: '' },
    stages: [
      {
        id: 's1',
        title: '阶段一',
        tool: 'code-runner',
        toolConfig: { type: 'code-runner', command: 'x', captureOutput: true },
        input: { sources: [], mergeStrategy: 'concat' },
        outputs: [{ key: 'text', format: 'text' }],
        pauseAfter: false,
      },
    ],
  };
  const inst: WorkflowInstance = {
    definition: wf,
    currentStageIndex: 0,
    stageRuntimes: wf.stages.map((s) => ({ stageId: s.id, status: 'error', outputs: {}, retryCount: 2 })),
    status: 'failed',
    traceId: 'trace_test',
    taskDir: '/tmp/stagent-test-task',
  };
  const row = buildWorkflowFailureRecord(inst, { stageId: 's1', error: 'fail', errorType: 'tool-execution-failed' });
  assert.ok(row);
  assert.equal(row!.workflowId, 'wf_t');
  assert.equal(row!.stageTitle, '阶段一');
  assert.equal(row!.retryCount, 2);
  assert.equal(row!.tool, 'code-runner');
});
