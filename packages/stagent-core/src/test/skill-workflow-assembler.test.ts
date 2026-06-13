import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'path';
import { assembleSkillWorkflow } from '../SkillWorkflowAssembler';
import { SkillRegistry, type SkillFsPort } from '../SkillRegistry';
import { validateGeneratedWorkflow } from '../WorkflowValidation';
import { isSkillStageId } from '../SkillToolKinds';
import type { LlmTextConfig } from '../WorkflowDefinition';

/** 内存 fs（同 skill-registry 测试）。 */
function makeFakeFs(files: Record<string, string>): SkillFsPort {
  const norm = (p: string) => p.replace(/\/+$/, '');
  const fileSet = new Set(Object.keys(files).map(norm));
  const dirSet = new Set<string>();
  for (const f of fileSet) {
    let d = path.dirname(f);
    while (d && d !== path.dirname(d)) {
      dirSet.add(norm(d));
      d = path.dirname(d);
    }
  }
  return {
    exists: (p) => fileSet.has(norm(p)) || dirSet.has(norm(p)),
    readFile: (p) => files[norm(p)] ?? files[p],
    isDirectory: (p) => dirSet.has(norm(p)),
    listDir: (p) => {
      const base = norm(p);
      const out = new Set<string>();
      for (const f of [...fileSet, ...dirSet]) {
        if (path.dirname(f) === base) {
          out.add(path.basename(f));
        }
      }
      return [...out];
    },
  };
}

const ROOT = '/skills';

function registryWith(refs: string[]): SkillRegistry {
  const files: Record<string, string> = {};
  for (const ref of refs) {
    files[`${ROOT}/engineering/${ref}/SKILL.md`] = `# ${ref}\nbody for ${ref}`;
  }
  const reg = new SkillRegistry({ skillsRoot: ROOT, fs: makeFakeFs(files) });
  reg.load();
  return reg;
}

test('express：grill-me → tdd，产出引擎可校验的工作流', () => {
  const reg = registryWith(['grill-me', 'tdd']);
  const { workflow, route, skipped } = assembleSkillWorkflow(
    { taskType: 'software', estimatedScope: 'single_slice', repo: { isGreenfield: false } },
    reg,
    { bundle: { userTask: '加一个邮件通知开关' }, meta: { userInput: '加一个邮件通知开关' } },
  );
  assert.equal(route.template, 'express');
  assert.deepEqual(skipped, []);
  assert.equal(workflow.version, '2.0');
  assert.deepEqual(
    workflow.stages.map((s) => s.id),
    ['stage_skill_grill_me', 'stage_skill_tdd'],
  );
  // 第一阶段 = native grill 决策阶段
  const grill = workflow.stages[0];
  assert.equal(grill.isDecisionStage, true);
  assert.ok(isSkillStageId(grill.id));
  assert.ok((grill.toolConfig as LlmTextConfig).systemPrompt.includes('# grill-me'));
  assert.ok((grill.toolConfig as LlmTextConfig).systemPrompt.includes('加一个邮件通知开关'));
  // 关键：通过引擎真实结构校验（含 I-1/I-5）
  assert.deepEqual(validateGeneratedWorkflow(workflow), []);
});

test('greenfield 全量：setup→grill-with-docs→to-prd→to-issues→tdd 全部 engine-valid', () => {
  const reg = registryWith([
    'setup-matt-pocock-skills',
    'grill-with-docs',
    'to-prd',
    'to-issues',
    'tdd',
  ]);
  const { workflow, route, skipped } = assembleSkillWorkflow(
    { taskType: 'software', estimatedScope: 'multi_slice', repo: { isGreenfield: true } },
    reg,
  );
  assert.equal(route.template, 'greenfield_full');
  assert.deepEqual(skipped, []);
  assert.equal(workflow.meta.isGreenfield, true);
  assert.equal(workflow.stages.length, 5);
  // grill-with-docs 为决策阶段
  const grill = workflow.stages.find((s) => s.id === 'stage_skill_grill_with_docs');
  assert.equal(grill?.isDecisionStage, true);
  assert.deepEqual(validateGeneratedWorkflow(workflow), []);
});

test('registry 未命中的 skill 记入 skipped 且不破坏校验', () => {
  const reg = registryWith(['grill-me']); // 缺 tdd
  const { workflow, skipped } = assembleSkillWorkflow(
    { taskType: 'software', estimatedScope: 'single_slice', repo: { isGreenfield: false } },
    reg,
  );
  assert.deepEqual(skipped, ['tdd']);
  assert.deepEqual(
    workflow.stages.map((s) => s.id),
    ['stage_skill_grill_me'],
  );
  assert.deepEqual(validateGeneratedWorkflow(workflow), []);
});

test('debug：triage→diagnose→tdd（均 engine-valid，无决策违规）', () => {
  const reg = registryWith(['triage', 'diagnose', 'tdd']);
  const { workflow, route } = assembleSkillWorkflow(
    { taskType: 'debug', repo: { isGreenfield: false } },
    reg,
  );
  assert.equal(route.template, 'debug');
  assert.deepEqual(validateGeneratedWorkflow(workflow), []);
});
