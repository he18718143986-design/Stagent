import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'path';
import { SkillRegistry } from '../SkillRegistry';
import { assembleSkillWorkflow } from '../SkillWorkflowAssembler';
import { validateGeneratedWorkflow } from '../WorkflowValidation';

/**
 * 用仓库内真实 `skills-main-lastest/skills` 的原版 SKILL.md，端到端验证
 * S2 引擎方法所走的路径：SkillRegistry(真实根) → assembleSkillWorkflow → 引擎校验。
 * 若该目录在当前布局下不可达（如 core 被单独 checkout），跳过断言以免误报。
 */
function realSkillsRoot(): string {
  // dist/test → dist → stagent-core → packages → autoAI → <repo>/skills-main-lastest/skills
  return path.resolve(__dirname, '../../../../../skills-main-lastest/skills');
}

test('真实 skills 根：greenfield 全量编排产物通过引擎校验', () => {
  const reg = new SkillRegistry({ skillsRoot: realSkillsRoot() });
  const loaded = reg.load();
  if (loaded === 0) {
    // 目录不可达（脱离 monorepo 布局）→ 跳过
    assert.ok(true, 'skills-main-lastest 不可达，跳过真实 skills 集成断言');
    return;
  }
  assert.ok(loaded >= 10, `应加载到多个真实 skill（实际 ${loaded}）`);
  assert.equal(reg.has('grill-with-docs'), true);

  const { workflow, route, skipped } = assembleSkillWorkflow(
    { taskType: 'software', estimatedScope: 'multi_slice', repo: { isGreenfield: true } },
    reg,
    { bundle: { userTask: '做一个任务看板' }, meta: { userInput: '做一个任务看板' } },
  );
  assert.equal(route.template, 'greenfield_full');
  assert.deepEqual(skipped, [], `不应跳过任何主路径 skill（skipped=${skipped.join(',')}）`);

  // grill-with-docs 注入了真实 SKILL.md 原文
  const grill = workflow.stages.find((s) => s.id === 'stage_skill_grill_with_docs');
  assert.ok(grill, '应含 grill-with-docs 阶段');
  const sys = (grill!.toolConfig as { systemPrompt: string }).systemPrompt;
  assert.ok(sys.includes('grill-with-docs'), 'systemPrompt 应含真实 SKILL.md 内容');

  // 关键：真实 skill 产出的工作流通过引擎结构 + 不变式校验
  assert.deepEqual(validateGeneratedWorkflow(workflow), []);
});
