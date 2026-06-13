import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildSkillStage, buildGrillStage } from '../SkillStageFactory';
import type { SkillSource } from '../SkillRegistry';
import type { LlmTextConfig } from '../WorkflowDefinition';

function skill(ref: string, content = `# ${ref}\nbody`): SkillSource {
  return { ref, skillMdPath: `/x/${ref}/SKILL.md`, content, version: 'v1', subFiles: {} };
}

test('buildSkillStage：编译为 llm-text 阶段，id 用 skill 约定', () => {
  const st = buildSkillStage(skill('to-prd'), { userTask: 'x' });
  assert.equal(st.tool, 'llm-text');
  assert.equal(st.id, 'stage_skill_to_prd');
  assert.equal((st.toolConfig as LlmTextConfig).type, 'llm-text');
  assert.ok((st.toolConfig as LlmTextConfig).systemPrompt.includes('# to-prd'));
  assert.equal(st.outputs[0].key, 'to_prd_output');
  assert.equal(st.pauseAfter, false);
});

test('buildGrillStage：决策阶段（HITL 经 approveDecision），不违反 I-5', () => {
  const st = buildGrillStage(skill('grill-with-docs'), { userTask: '做登录' });
  assert.equal(st.tool, 'llm-text');
  assert.equal(st.id, 'stage_skill_grill_with_docs');
  assert.equal(st.isDecisionStage, true);
  // I-5：决策阶段不得设 exposeAssumptions
  assert.notEqual(st.exposeAssumptions, true);
  assert.equal(st.outputs[0].key, 'grill_alignment');
  // SKILL.md 原文 + 用户任务都进入 systemPrompt
  const sys = (st.toolConfig as LlmTextConfig).systemPrompt;
  assert.ok(sys.includes('# grill-with-docs'));
  assert.ok(sys.includes('做登录'));
});

test('buildGrillStage：grill-me 标题区分', () => {
  const st = buildGrillStage(skill('grill-me'));
  assert.ok(st.title.includes('grill-me'));
});

test('buildSkillStage：温度/maxTokens 透传', () => {
  const st = buildSkillStage(skill('tdd'), {}, { temperature: 0.2, maxTokens: 2048 });
  const cfg = st.toolConfig as LlmTextConfig;
  assert.equal(cfg.temperature, 0.2);
  assert.equal(cfg.maxTokens, 2048);
});
