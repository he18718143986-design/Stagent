import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LLM_MAX_OUTPUT_TOKENS } from '../LlmInvokeHelpers';
import {
  GREENFIELD_FULL_MIN_OUTPUT_TOKENS,
  resolveWorkflowGenMaxOutputTokens,
} from '../generation/workflowGenMaxTokens';

test('resolveWorkflowGenMaxOutputTokens defaults to engine default', () => {
  assert.equal(resolveWorkflowGenMaxOutputTokens(undefined, 'express'), DEFAULT_LLM_MAX_OUTPUT_TOKENS);
});

function mockCfg(values: Record<string, unknown>) {
  return {
    get: <T>(key: string) => values[key] as T | undefined,
    has: (key: string) => key in values,
  };
}

test('resolveWorkflowGenMaxOutputTokens bumps greenfield_full to at least 16384', () => {
  assert.equal(
    resolveWorkflowGenMaxOutputTokens(mockCfg({ llmMaxOutputTokens: 4096 }), 'greenfield_full'),
    GREENFIELD_FULL_MIN_OUTPUT_TOKENS,
  );
});

test('resolveWorkflowGenMaxOutputTokens keeps higher configured value', () => {
  assert.equal(
    resolveWorkflowGenMaxOutputTokens(mockCfg({ llmMaxOutputTokens: 32_768 }), 'greenfield_full'),
    32_768,
  );
});
