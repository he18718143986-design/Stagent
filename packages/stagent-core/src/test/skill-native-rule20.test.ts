import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'path';
import { assembleSkillWorkflow } from '../SkillWorkflowAssembler';
import { SkillRegistry, type SkillFsPort } from '../SkillRegistry';
import { isSkillNativeWorkflow } from '../SkillToolKinds';
import { verifyRule20 } from '../Rule20Verify';
import { lintPlanCompleteness } from '../PlanCompletenessGate';
import type { WorkflowDefinition } from '../WorkflowDefinition';

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

function skillNativeSoftwareWorkflow(): WorkflowDefinition {
  const refs = ['setup-matt-pocock-skills', 'grill-with-docs', 'to-prd', 'to-issues', 'tdd'];
  const files: Record<string, string> = {};
  for (const r of refs) {
    files[`/skills/engineering/${r}/SKILL.md`] = `# ${r}\nbody`;
  }
  const reg = new SkillRegistry({ skillsRoot: '/skills', fs: makeFakeFs(files) });
  reg.load();
  return assembleSkillWorkflow(
    { taskType: 'software', estimatedScope: 'multi_slice', repo: { isGreenfield: true } },
    reg,
  ).workflow;
}

test('isSkillNativeWorkflow：全 skill 阶段 → true；含 impl 阶段 → false', () => {
  const wf = skillNativeSoftwareWorkflow();
  assert.equal(isSkillNativeWorkflow(wf), true);

  const mixed: WorkflowDefinition = {
    ...wf,
    stages: [...wf.stages, { ...wf.stages[0], id: 'stage_impl_foo' }],
  };
  assert.equal(isSkillNativeWorkflow(mixed), false);
  assert.equal(isSkillNativeWorkflow({ stages: [] }), false);
});

test('verifyRule20：skill-native software 工作流放行（无 violations/warnings）', () => {
  const wf = skillNativeSoftwareWorkflow();
  const r = verifyRule20(wf);
  assert.deepEqual(r.violations, []);
  assert.deepEqual(r.warnings, []);
});

test('lintPlanCompleteness：skill-native 工作流不适用 impl 完整性硬门（返回空）', () => {
  const wf = skillNativeSoftwareWorkflow();
  assert.deepEqual(lintPlanCompleteness(wf), []);
});

test('回归：非 skill-native（含 stage_impl_ 无配对决策）的 software 仍被 Rule20 检查', () => {
  const wf: WorkflowDefinition = {
    id: 'x',
    version: '2.0',
    meta: { title: 't', taskType: 'software', userInput: 'u', createdAt: '2026-01-01' },
    stages: [
      {
        id: 'stage_impl_auth',
        title: 'impl auth',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'x' },
        input: { sources: [], mergeStrategy: 'concat' },
        outputs: [{ key: 'code', format: 'markdown' }],
        pauseAfter: false,
      },
    ],
  };
  assert.equal(isSkillNativeWorkflow(wf), false);
  // 非 skill-native：守卫不生效，Rule20 正常运作（此处至少应产生 missing-decision 类违规）
  const r = verifyRule20(wf);
  assert.ok(r.violations.length > 0, 'impl 无配对决策应触发 Rule20 violations');
});
