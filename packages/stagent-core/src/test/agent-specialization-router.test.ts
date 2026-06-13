import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  buildAgentSelectionConfig,
  classifyStageRole,
  pickModelForStage,
} from '../AgentSpecializationRouter';
import type { Stage } from '../WorkflowDefinition';

function stage(id: string, extra?: Partial<Stage>): Stage {
  return {
    id,
    title: id,
    tool: 'llm-text',
    toolConfig: { type: 'llm-text', systemPrompt: 'x' },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'out', format: 'text' }],
    pauseAfter: false,
    ...extra,
  };
}

const models = [
  { family: 'gpt-4o', name: 'gpt-4o', id: 'gpt-4o-1' },
  { family: 'direct:deepseek-chat', name: 'direct:deepseek-chat', id: 'http:deepseek' },
];

test('classifyStageRole maps decision and impl prefixes', () => {
  assert.equal(classifyStageRole(stage('stage_decide_api', { isDecisionStage: true })), 'decision');
  assert.equal(classifyStageRole(stage('stage_impl_foo')), 'implementation');
  assert.equal(classifyStageRole(stage('stage_test_write_foo')), 'test-write');
});

test('pickModelForStage honors agentRoleOverrides', () => {
  const cfg = buildAgentSelectionConfig({ implementation: 'direct:deepseek-chat' });
  const picked = pickModelForStage(stage('stage_impl_x'), cfg, models);
  assert.equal(picked?.family, 'direct:deepseek-chat');
});

test('pickModelForStage falls back to first model', () => {
  const cfg = buildAgentSelectionConfig({});
  const picked = pickModelForStage(stage('stage_impl_x'), cfg, models);
  assert.equal(picked?.family, 'gpt-4o');
});
