import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  workflowGenContinueLlmInvokeOpts,
  workflowGenLlmInvokeOpts,
  workflowGenRepairLlmInvokeOpts,
} from '../core/LlmInvokeOpts';
import { parseWorkflowJson } from '../WorkflowGeneration';
import type { LlmInvokeOpts } from '../core/LlmInvokeOpts';
import { TRACE_STAGE_WORKFLOW_GEN_REPAIR } from '../generation/GenerationTraceStageIds';

test('workflowGenLlmInvokeOpts enables jsonMode and maxTokens', () => {
  const opts = workflowGenLlmInvokeOpts(8192);
  assert.equal(opts.requireStructured, true);
  assert.equal(opts.jsonMode, true);
  assert.equal(opts.maxTokens, 8192);
});

test('workflowGenRepairLlmInvokeOpts enables jsonMode with maxTokens', () => {
  const opts = workflowGenRepairLlmInvokeOpts(16_384);
  assert.equal(opts.requireStructured, true);
  assert.equal(opts.jsonMode, true);
  assert.equal(opts.maxTokens, 16_384);
});

test('workflowGenContinueLlmInvokeOpts passes maxTokens without jsonMode', () => {
  const opts = workflowGenContinueLlmInvokeOpts(16_384);
  assert.equal(opts.requireStructured, true);
  assert.equal(opts.jsonMode, undefined);
  assert.equal(opts.maxTokens, 16_384);
});

test('parseWorkflowJson repair passes jsonMode opts to invokeLlmRaw', async () => {
  const calls: Array<{ trace: string; opts?: LlmInvokeOpts }> = [];
  const wf = {
    id: 'wf_t',
    version: '2.0',
    meta: {
      title: 't',
      taskType: 'software',
      userInput: 'u',
      createdAt: new Date().toISOString(),
    },
    stages: [
      {
        id: 'stage_a',
        title: 'a',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'x'.repeat(30) },
        input: { sources: [], mergeStrategy: 'concat' },
        outputs: [{ key: 'out', format: 'text' }],
        pauseAfter: false,
      },
    ],
  };
  await parseWorkflowJson('plain prose without json braces', {
    invokeLlmRaw: async (_sys, _user, trace, opts) => {
      calls.push({ trace, opts });
      if (trace === TRACE_STAGE_WORKFLOW_GEN_REPAIR) {
        return JSON.stringify(wf);
      }
      return '';
    },
  });
  const repairCall = calls.find((c) => c.trace === TRACE_STAGE_WORKFLOW_GEN_REPAIR);
  assert.ok(repairCall);
  assert.equal(repairCall!.opts?.jsonMode, true);
  assert.equal(repairCall!.opts?.requireStructured, true);
});
