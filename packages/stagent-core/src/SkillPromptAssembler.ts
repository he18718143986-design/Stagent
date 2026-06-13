/* ------------------------------------------------------------------ */
/*  SkillPromptAssembler — 组装 skill-invoke 阶段的 systemPrompt          */
/*                                                                     */
/*  systemPrompt = SKILL.md 原文（保真）+ Platform Context Bundle +      */
/*  Charter 自动应答 / 升级闸门指令（SKILLS-ENGINE-INTEGRATION.md §5.4）。*/
/* ------------------------------------------------------------------ */

import type { SkillSource } from './SkillRegistry';

/** Charter 应答模式（对齐 WORKFLOW §5.5.3）。 */
export type AutoAnswerMode = 'off' | 'suggest' | 'auto-with-escalation';

/** 注入给 skill 的上下文包（对齐 PRD §9.1 / 集成文档 §5.4）。 */
export interface SkillContextBundle {
  /** 用户任务（几句话需求） */
  userTask?: string;
  /** 决策主旨 Charter 文本（优先/避免/可接受/约束/升级触发） */
  charter?: string;
  autoAnswerMode?: AutoAnswerMode;
  /** CONTEXT.md 词汇表摘录（来自 ProjectGlossaryStore） */
  contextMd?: string;
  /** 相关 ADR 摘录（来自 AdrStore） */
  adrs?: string;
  /** 上游 skill 产出 / 既有决策摘要 */
  priorDecisions?: string;
  /** 仓库快照（绿场 / 是否动陌生模块等，便于 skill 自我定位） */
  repoSnapshot?: string;
}

function section(title: string, body: string | undefined): string | null {
  const trimmed = (body ?? '').trim();
  if (!trimmed) {
    return null;
  }
  return `### ${title}\n${trimmed}`;
}

/**
 * 升级闸门指令：即使 auto-with-escalation，命中 ADR 判据 / 越过约束 / 低置信
 * 也必须停下问人（对齐 WORKFLOW §5.5.4 MustEscalateToHuman）。
 */
export function buildEscalationInstruction(mode: AutoAnswerMode): string {
  if (mode === 'off') {
    return [
      '【应答模式：off】',
      '- 不要替用户回答；逐个把关键决策以「一次一个问题」的方式抛给用户。',
    ].join('\n');
  }
  const head =
    mode === 'suggest'
      ? '【应答模式：suggest】对每个可预见决策，给出带理由的**推荐答案**，并标注来源，等待用户确认。'
      : '【应答模式：auto-with-escalation】对可预见决策可按 Charter 自动作答并标注来源；仅在下列情况必须停下问人。';
  return [
    head,
    '【答案来源标注（provenance）】每个被代答的决策注明：human | charter_direct | charter_inferred | escalated。',
    '【必须升级给人（MustEscalateToHuman，不可绕过）】命中任一即停下提问：',
    '  1. 决策满足 ADR 判据（难逆转 + 无上下文会令人惊讶 + 存在真实 trade-off）；',
    '  2. 改动会越过 Charter「约束（Constraints）」边界；',
    '  3. 你的置信度低，或 Charter 对该问题沉默 / 自相矛盾。',
    '【纪律】不要用 Charter 关掉 grill：仍需挖掘用户未想到的盲区（未知的未知）。',
  ].join('\n');
}

/**
 * 组装 skill-invoke 阶段 systemPrompt：SKILL.md 原文置顶（保真），其后追加
 * Platform Context Bundle 与应答/升级指令。
 */
export function assembleSkillSystemPrompt(
  skill: SkillSource,
  bundle: SkillContextBundle = {},
): string {
  const mode: AutoAnswerMode = bundle.autoAnswerMode ?? 'off';
  const parts: string[] = [];

  // 1) SKILL.md 原文（single source of truth；逐字注入，消灭转写保真损失）
  parts.push(skill.content.trim());

  // 2) Platform Context Bundle
  const ctx: string[] = [];
  const sUser = section('User Task', bundle.userTask);
  const sCharter = section('Decision Charter', bundle.charter);
  const sCtx = section('CONTEXT.md (glossary excerpt)', bundle.contextMd);
  const sAdr = section('Relevant ADRs', bundle.adrs);
  const sPrior = section('Prior decisions (summary)', bundle.priorDecisions);
  const sRepo = section('Repo snapshot', bundle.repoSnapshot);
  for (const s of [sUser, sCharter, sCtx, sAdr, sPrior, sRepo]) {
    if (s) {
      ctx.push(s);
    }
  }
  if (ctx.length > 0) {
    parts.push(`---\n## Platform Context Bundle\n\n${ctx.join('\n\n')}`);
  }

  // 3) 应答模式 / 升级闸门
  parts.push(`---\n## Auto-Answer Policy\n\n${buildEscalationInstruction(mode)}`);

  // 4) 溯源标记（便于审计：用了哪个 skill 的哪个版本）
  parts.push(
    `---\n<!-- skill-invoke: ref=${skill.ref} version=${skill.version} mode=${mode} -->`,
  );

  return parts.join('\n\n');
}
