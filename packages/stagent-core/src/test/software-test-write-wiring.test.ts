import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { expandGreenfieldPythonSkeleton } from '../plan-skeleton';
import {
  TEST_WRITE_CONTRACT_SNIPPET,
  wireSoftwareTestWriteDecisionSources,
} from '../rule20-normalize/steps/software-test-write-wiring';
import { PRIMARY_DECISION_OUTPUT_KEY } from '../WorkflowOutputKeys';
import { DECISION_ARTIFACTS_OUTPUT_KEY } from '../WorkflowOutputKeys';
import { T4_REQUIREMENT_SNIPPET } from './fixtures/t4RequirementSnippet';

test('wireSoftwareTestWriteDecisionSources prepends decide sources and contract prompt', () => {
  const { workflow } = expandGreenfieldPythonSkeleton({
    userInput: T4_REQUIREMENT_SNIPPET,
    taskType: 'software',
  });
  wireSoftwareTestWriteDecisionSources(workflow);
  const tw = workflow.stages.find((s) => s.id === 'stage_test_write_indicators')!;
  const sources = tw.input.sources.filter((s) => s.type === 'stage-output');
  assert.ok(
    sources.some(
      (s) => s.stageId === 'stage_decide_indicators' && s.outputKey === PRIMARY_DECISION_OUTPUT_KEY,
    ),
  );
  assert.ok(
    sources.some(
      (s) => s.stageId === 'stage_decide_indicators' && s.outputKey === DECISION_ARTIFACTS_OUTPUT_KEY,
    ),
  );
  const prompt = (tw.toolConfig as { systemPrompt?: string }).systemPrompt ?? '';
  assert.ok(prompt.includes(TEST_WRITE_CONTRACT_SNIPPET));
});
