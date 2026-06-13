/* ------------------------------------------------------------------ */
/*  SkillToolKinds — S0「skill-invoke」工具类型与 skill 阶段 id 约定      */
/*                                                                     */
/*  设计（见 stagent_docs/SKILLS-ENGINE-INTEGRATION.md §5）：           */
/*  - 「skill-invoke」是一个**编译目标**而非新的运行时 ToolType：       */
/*    它在阶段构造期由 SkillStageFactory 编译为标准 `llm-text` 阶段     */
/*    （systemPrompt = SKILL.md 原文 + Context Bundle），从而复用现有    */
/*    执行器 / HITL / 置信度 / 自愈，不改动 WorkflowExecutor。          */
/*  - skill 来源（provenance）通过稳定的阶段 id 约定 `stage_skill_<ref>` */
/*    表达，便于审计与「原版 skill 调用」标记。                          */
/* ------------------------------------------------------------------ */

/** 逻辑工具标记（非 WorkflowDefinition.ToolType；编译到 llm-text 后执行）。 */
export const STAGE_TOOL_SKILL_INVOKE = 'skill-invoke' as const;

/** skill 阶段 id 前缀。 */
export const SKILL_STAGE_ID_PREFIX = 'stage_skill_';

const RE_SKILL_STAGE = /^stage_skill_(.+)$/;

/** 把 skillRef（如 `grill-with-docs`）规范化为可嵌入阶段 id 的 slug。 */
export function skillRefToSlug(skillRef: string): string {
  return skillRef.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/** 由 skillRef 生成稳定的 skill 阶段 id。 */
export function skillStageId(skillRef: string): string {
  return `${SKILL_STAGE_ID_PREFIX}${skillRefToSlug(skillRef)}`;
}

/** 是否为 skill-invoke 阶段（按 id 约定判定）。 */
export function isSkillStageId(stageId: string): boolean {
  return RE_SKILL_STAGE.test(stageId);
}

/** 从 skill 阶段 id 还原出 slug（非 skill 阶段返回 undefined）。 */
export function skillSlugFromStageId(stageId: string): string | undefined {
  const m = RE_SKILL_STAGE.exec(stageId);
  return m ? m[1] : undefined;
}

/**
 * 是否为「skill-native 工作流」：非空且**全部**阶段均为 skill-invoke 阶段。
 * 这类工作流是上游「规划/对齐」层（grill / to-prd / to-issues …），不含 impl/test，
 * 因此引擎的 impl 形状规则（Rule20 / PlanCompleteness）应作为**后置 verifier** 跳过它，
 * 见 SKILLS-ENGINE-INTEGRATION.md §7。
 */
export function isSkillNativeWorkflow(wf: { stages?: Array<{ id: string }> }): boolean {
  const stages = wf?.stages ?? [];
  return stages.length > 0 && stages.every((s) => isSkillStageId(s.id));
}
