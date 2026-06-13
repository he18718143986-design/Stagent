/* ------------------------------------------------------------------ */
/*  SkillWorkflowAssembler — S1：把「场景路由 + skill 序列」编排为一个      */
/*  引擎可执行的 WorkflowDefinition（grill 为 native 决策阶段）。          */
/*                                                                     */
/*  这是 ScenarioRouter（选哪些 skill）与 SkillStageFactory（每个 skill   */
/*  → llm-text 阶段）之间的「编排粘合层」。产出的工作流满足               */
/*  validateGeneratedWorkflow（结构 + 不变式 I-1/I-5/...），即可被现有     */
/*  WorkflowEngine 正常 normalize / 执行。                               */
/*                                                                     */
/*  见 SKILLS-ENGINE-INTEGRATION.md §3–§5。                             */
/* ------------------------------------------------------------------ */

import type { Stage, WorkflowDefinition, WorkflowMeta } from './WorkflowDefinition';
import type { SkillRegistry } from './SkillRegistry';
import type { SkillContextBundle } from './SkillPromptAssembler';
import type { ScenarioInput, ScenarioRoute } from './ScenarioRouter';
import { routeScenario, SKILL_GRILL_ME, SKILL_GRILL_WITH_DOCS } from './ScenarioRouter';
import { buildGrillStage, buildSkillStage } from './SkillStageFactory';

const GRILL_REFS = new Set<string>([SKILL_GRILL_WITH_DOCS, SKILL_GRILL_ME]);

export interface AssembleSkillWorkflowOptions {
  /** 注入每个 skill 阶段的上下文包（Charter / CONTEXT / ADR / 用户任务等） */
  bundle?: SkillContextBundle;
  /** 工作流元信息（title / taskType / userInput / isGreenfield 等）；缺省自动补齐 */
  meta?: Partial<WorkflowMeta>;
  /** 工作流 id（缺省自动生成） */
  id?: string;
}

export interface AssembleSkillWorkflowResult {
  workflow: WorkflowDefinition;
  route: ScenarioRoute;
  /** 因 registry 未命中而被跳过的 skillRef（透明可审计） */
  skipped: string[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function buildMeta(input: ScenarioInput, route: ScenarioRoute, meta?: Partial<WorkflowMeta>): WorkflowMeta {
  return {
    title: meta?.title ?? `Skill 工作流（${route.template}）`,
    taskType: meta?.taskType ?? input.taskType,
    userInput: meta?.userInput ?? '',
    createdAt: meta?.createdAt ?? nowIso(),
    ...(input.repo.isGreenfield ? { isGreenfield: true } : {}),
    ...(meta?.taskWorkspacePath ? { taskWorkspacePath: meta.taskWorkspacePath } : {}),
  };
}

/**
 * 把一个 skillRef 编译为阶段。grill → native 决策阶段；其余 → 普通 llm-text skill 阶段。
 * registry 未命中返回 undefined（调用方记入 skipped）。
 */
export function buildStageForSkillRef(
  skillRef: string,
  registry: SkillRegistry,
  bundle: SkillContextBundle,
): Stage | undefined {
  const skill = registry.get(skillRef);
  if (!skill) {
    return undefined;
  }
  if (GRILL_REFS.has(skillRef)) {
    return buildGrillStage(skill, bundle);
  }
  return buildSkillStage(skill, bundle, { title: `Skill: ${skill.ref}` });
}

/**
 * 由「已路由的场景」编排 skill-native 工作流。
 * 线性顺序 = route.skillSequence；grill 为决策阶段（HITL）。
 */
export function assembleSkillWorkflow(
  input: ScenarioInput,
  registry: SkillRegistry,
  opts: AssembleSkillWorkflowOptions = {},
): AssembleSkillWorkflowResult {
  const route = routeScenario(input);
  const bundle: SkillContextBundle = opts.bundle ?? {};
  const stages: Stage[] = [];
  const skipped: string[] = [];

  for (const ref of route.skillSequence) {
    const stage = buildStageForSkillRef(ref, registry, bundle);
    if (stage) {
      stages.push(stage);
    } else {
      skipped.push(ref);
    }
  }

  const workflow: WorkflowDefinition = {
    id: opts.id ?? `skillwf_${Math.random().toString(36).slice(2, 10)}`,
    version: '2.0',
    meta: buildMeta(input, route, opts.meta),
    stages,
  };

  return { workflow, route, skipped };
}
