import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  STAGE_TOOL_SKILL_INVOKE,
  SKILL_STAGE_ID_PREFIX,
  skillRefToSlug,
  skillStageId,
  isSkillStageId,
  skillSlugFromStageId,
  isSkillNativeWorkflow,
} from '../SkillToolKinds';

test('常量稳定', () => {
  assert.equal(STAGE_TOOL_SKILL_INVOKE, 'skill-invoke');
  assert.equal(SKILL_STAGE_ID_PREFIX, 'stage_skill_');
});

test('skillRefToSlug：非字母数字归一为下划线', () => {
  assert.equal(skillRefToSlug('grill-with-docs'), 'grill_with_docs');
  assert.equal(skillRefToSlug('improve-codebase-architecture'), 'improve_codebase_architecture');
  assert.equal(skillRefToSlug('  To-PRD  '), 'to_prd');
});

test('skillStageId / isSkillStageId / skillSlugFromStageId 往返', () => {
  const id = skillStageId('grill-with-docs');
  assert.equal(id, 'stage_skill_grill_with_docs');
  assert.equal(isSkillStageId(id), true);
  assert.equal(isSkillStageId('stage_impl_foo'), false);
  assert.equal(skillSlugFromStageId(id), 'grill_with_docs');
  assert.equal(skillSlugFromStageId('stage_decide_x'), undefined);
});

test('isSkillNativeWorkflow：全 skill 阶段 true；混入非 skill 阶段或空 → false', () => {
  assert.equal(
    isSkillNativeWorkflow({ stages: [{ id: 'stage_skill_grill_me' }, { id: 'stage_skill_tdd' }] }),
    true,
  );
  assert.equal(
    isSkillNativeWorkflow({ stages: [{ id: 'stage_skill_grill_me' }, { id: 'stage_impl_x' }] }),
    false,
  );
  assert.equal(isSkillNativeWorkflow({ stages: [] }), false);
  assert.equal(isSkillNativeWorkflow({}), false);
});
