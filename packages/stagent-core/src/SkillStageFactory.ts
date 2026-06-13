/* ------------------------------------------------------------------ */
/*  SkillStageFactory — 把 skill-invoke 编译为标准 `llm-text` 阶段        */
/*                                                                     */
/*  这是「skill native 化」的落点：产出的 Stage 由现有 WorkflowExecutor   */
/*  直接执行（复用 HITL / 置信度 / 暂停 / 自愈），systemPrompt 为          */
/*  SKILL.md 原文 + Context Bundle。grill 阶段标记为 isDecisionStage +    */
/*  pauseAfter，保留 skill 的人工拍板纪律。                              */
/* ------------------------------------------------------------------ */

import type { Stage, StageInput } from './WorkflowDefinition';
import type { SkillSource } from './SkillRegistry';
import { skillStageId } from './SkillToolKinds';
import {
  assembleSkillSystemPrompt,
  type SkillContextBundle,
} from './SkillPromptAssembler';
import { SKILL_GRILL_WITH_DOCS, SKILL_GRILL_ME } from './ScenarioRouter';

export interface BuildSkillStageOptions {
  /** 覆盖默认标题 */
  title?: string;
  /** 是否为决策阶段（grill/to-prd 等判断重的为 true） */
  isDecisionStage?: boolean;
  /** 执行后暂停等人（HITL 闸门） */
  pauseAfter?: boolean;
  /** 暴露假设（决策阶段建议 true） */
  exposeAssumptions?: boolean;
  /** 主输出 key（默认 `<ref>_output`） */
  outputKey?: string;
  /** llm 温度 */
  temperature?: number;
  maxTokens?: number;
}

/** 默认输入：携带用户任务（来自实例 userInput）。 */
function defaultInput(): StageInput {
  return {
    sources: [{ type: 'user-input', label: 'User task' }],
    mergeStrategy: 'concat',
  };
}

/**
 * 通用：把任意 skill 编译为一个 llm-text 阶段。
 * provenance 由阶段 id `stage_skill_<ref>` 表达；systemPrompt 注入 SKILL.md 原文。
 */
export function buildSkillStage(
  skill: SkillSource,
  bundle: SkillContextBundle = {},
  opts: BuildSkillStageOptions = {},
): Stage {
  const outputKey = opts.outputKey ?? `${skill.ref.replace(/[^a-z0-9]+/gi, '_')}_output`;
  return {
    id: skillStageId(skill.ref),
    title: opts.title ?? `Skill: ${skill.ref}`,
    description: `Native invocation of skill "${skill.ref}" (SKILL.md v${skill.version}).`,
    tool: 'llm-text',
    toolConfig: {
      type: 'llm-text',
      systemPrompt: assembleSkillSystemPrompt(skill, bundle),
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
    },
    input: defaultInput(),
    outputs: [{ key: outputKey, format: 'markdown' }],
    pauseAfter: opts.pauseAfter ?? false,
    ...(opts.isDecisionStage ? { isDecisionStage: true } : {}),
    ...(opts.exposeAssumptions ? { exposeAssumptions: true } : {}),
  };
}

/**
 * grill native 化：构造一个 grill skill 阶段。
 * - skill = grill-with-docs（默认，写 CONTEXT/ADR）或 grill-me（轻量）
 * - isDecisionStage=true：复用引擎的「决策阶段 → 暂停 → approveDecision」HITL 机制，
 *   把 grill 的对齐结论作为 DecisionRecord 交用户拍板（保留人工把关）。
 * - 注意不变式 I-5：决策阶段不得再设 exposeAssumptions；I-1：决策阶段必须 llm-text。
 *   决策阶段本身即暂停等审批，无需额外 pauseAfter。
 */
export function buildGrillStage(
  skill: SkillSource,
  bundle: SkillContextBundle = {},
  opts: { title?: string } = {},
): Stage {
  const isWithDocs = skill.ref === SKILL_GRILL_WITH_DOCS;
  const defaultTitle = isWithDocs
    ? '需求对齐（grill-with-docs，原版 skill）'
    : skill.ref === SKILL_GRILL_ME
      ? '需求对齐（grill-me，原版 skill）'
      : `需求对齐（${skill.ref}）`;
  return buildSkillStage(skill, bundle, {
    title: opts.title ?? defaultTitle,
    isDecisionStage: true,
    pauseAfter: false,
    outputKey: 'grill_alignment',
  });
}
