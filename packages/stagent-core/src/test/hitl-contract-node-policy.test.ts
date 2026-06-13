import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  countDownstreamStageOutputRefs,
  isContractNode,
  isDataPipelineCoreStage,
  shouldEscalateContractNodePause,
} from '../HITLContractNodePolicy';
import { DEFAULT_HITL_POLICY, shouldPauseAfterStage } from '../AdaptiveHITLPolicy';
import type { Stage, StageRuntime, WorkflowDefinition } from '../WorkflowDefinition';
import type { ConfidenceResult } from '../ConfidenceScorer';

function stage(partial: Partial<Stage> & Pick<Stage, 'id'>): Stage {
  return {
    title: partial.id,
    tool: 'llm-text',
    toolConfig: { type: 'llm-text', systemPrompt: 'x' },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'out', format: 'text' }],
    pauseAfter: false,
    ...partial,
  };
}

function wf(stages: Stage[]): WorkflowDefinition {
  return {
    id: 'w',
    version: '2.0',
    meta: { title: 't', taskType: 'prototype', userInput: 'u', createdAt: '' },
    stages,
  };
}

function runtime(retryCount = 0): StageRuntime {
  return { stageId: 's', status: 'running', outputs: {}, retryCount };
}

function confidence(score: number): ConfidenceResult {
  return { score, level: score >= 0.75 ? 'high' : score >= 0.55 ? 'medium' : 'low', reasons: [] };
}

test('isDataPipelineCoreStage: reader/fetcher/analyzer/writer/main → true', () => {
  for (const id of [
    'stage_impl_prototype_reader',
    'stage_impl_prototype_fetcher',
    'stage_impl_prototype_analyzer',
    'stage_impl_prototype_writer',
    'stage_impl_prototype_main',
  ]) {
    const file = id.replace('stage_impl_prototype_', '') + '.py';
    assert.equal(
      isDataPipelineCoreStage(stage({ id, toolConfig: { type: 'llm-text', systemPrompt: 'x', writeOutputToFile: file } })),
      true,
      id,
    );
  }
});

test('isDataPipelineCoreStage: requirements/config/mock_data/create_sample → false', () => {
  const cases: Array<[string, string]> = [
    ['stage_impl_prototype_requirements', 'requirements.txt'],
    ['stage_impl_prototype_config_yaml', 'config.yaml'],
    ['stage_impl_prototype_mock_data', 'mock_data.json'],
    ['stage_impl_prototype_create_sample', 'create_sample.py'],
  ];
  for (const [id, file] of cases) {
    assert.equal(
      isDataPipelineCoreStage(stage({ id, toolConfig: { type: 'llm-text', systemPrompt: 'x', writeOutputToFile: file } })),
      false,
      id,
    );
  }
});

test('countDownstreamStageOutputRefs counts stage-output consumers', () => {
  const w = wf([
    stage({ id: 'a' }),
    stage({ id: 'b', input: { sources: [{ type: 'stage-output', stageId: 'a', outputKey: 'out' }], mergeStrategy: 'concat' } }),
    stage({ id: 'c', input: { sources: [{ type: 'stage-output', stageId: 'a', outputKey: 'out' }], mergeStrategy: 'concat' } }),
  ]);
  assert.equal(countDownstreamStageOutputRefs(w, 'a'), 2);
  assert.equal(countDownstreamStageOutputRefs(w, 'b'), 0);
});

test('isContractNode: ≥2 downstream refs OR data-pipeline core', () => {
  const reader = stage({
    id: 'stage_impl_prototype_reader',
    toolConfig: { type: 'llm-text', systemPrompt: 'x', writeOutputToFile: 'reader.py' },
  });
  const w = wf([
    stage({ id: 'a' }),
    stage({ id: 'b', input: { sources: [{ type: 'stage-output', stageId: 'a' }], mergeStrategy: 'concat' } }),
    stage({ id: 'c', input: { sources: [{ type: 'stage-output', stageId: 'a' }], mergeStrategy: 'concat' } }),
    reader,
  ]);
  assert.equal(isContractNode(w, w.stages[0]), true); // a referenced by 2
  assert.equal(isContractNode(w, reader), true); // data-pipeline core
  assert.equal(isContractNode(w, w.stages[1]), false);
});

test('shouldEscalateContractNodePause: contract node + below threshold → escalate', () => {
  assert.equal(
    shouldEscalateContractNodePause({ isContractNode: true, confidenceScore: 0.7, contractNodePauseThreshold: 0.75, enabled: true }),
    true,
  );
  assert.equal(
    shouldEscalateContractNodePause({ isContractNode: true, confidenceScore: 0.8, contractNodePauseThreshold: 0.75, enabled: true }),
    false,
  );
  assert.equal(
    shouldEscalateContractNodePause({ isContractNode: false, confidenceScore: 0.1, contractNodePauseThreshold: 0.75, enabled: true }),
    false,
  );
  assert.equal(
    shouldEscalateContractNodePause({ isContractNode: true, confidenceScore: 0.1, contractNodePauseThreshold: 0.75, enabled: false }),
    false,
  );
});

test('shouldPauseAfterStage: medium-confidence contract node pauses (regression of 0.7-no-pause bug)', () => {
  const reader = stage({ id: 'stage_impl_prototype_reader' });
  assert.equal(
    shouldPauseAfterStage(reader, runtime(), confidence(0.7), DEFAULT_HITL_POLICY, { isContractNode: true }),
    true,
  );
});

test('shouldPauseAfterStage: high-confidence contract node still auto-advances', () => {
  const reader = stage({ id: 'stage_impl_prototype_reader' });
  assert.equal(
    shouldPauseAfterStage(reader, runtime(), confidence(0.8), DEFAULT_HITL_POLICY, { isContractNode: true }),
    false,
  );
});

test('shouldPauseAfterStage: non-contract medium node unaffected (backward compatible)', () => {
  const cfg = stage({ id: 'stage_impl_prototype_config_yaml' });
  assert.equal(
    shouldPauseAfterStage(cfg, runtime(), confidence(0.7), DEFAULT_HITL_POLICY, { isContractNode: false }),
    false,
  );
});

test('shouldPauseAfterStage: disabling pauseContractNodes restores old behavior', () => {
  const reader = stage({ id: 'stage_impl_prototype_reader' });
  const policy = { ...DEFAULT_HITL_POLICY, pauseContractNodesBelowThreshold: false };
  assert.equal(
    shouldPauseAfterStage(reader, runtime(), confidence(0.7), policy, { isContractNode: true }),
    false,
  );
});
