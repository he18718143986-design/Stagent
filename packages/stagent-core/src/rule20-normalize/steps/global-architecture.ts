import type { Stage, WorkflowDefinition } from '../../WorkflowDefinition';
import { shouldWarnSoftwareMissingGlobalArchitectureDecision } from '../../Rule20Verify';
import { ensureDecisionPromptStrict } from '../../WorkflowPrompts';
import { rule20Msg } from '../../l10n/rule20Msg';
import { formatRule20IssueLine } from '../../Rule20RuntimeGate';
import { isDecideStageId, isImplStageId } from '../../workflow/StageIdPatterns';
import { STAGE_TOOL_LLM_TEXT } from '../../workflow/StageToolKinds';
import { PRIMARY_DECISION_OUTPUT_KEY } from '../../WorkflowOutputKeys';
import { GLOBAL_ARCHITECTURE_DECIDE_STAGE_ID } from '../types';

const GLOBAL_ARCH_SHELL_PROMPT_BASE =
  '你是资深软件架构师。请基于「用户任务」输出可审核的全局架构 DecisionRecord（Markdown），须含模块边界表、模块间接口合约、技术栈选型理由、阶段预算与超限削减建议。';

function findGlobalArchitectureShellInsertIndex(stages: Stage[]): number {
  for (let i = 0; i < stages.length; i++) {
    const id = stages[i].id;
    if (isDecideStageId(id) || isImplStageId(id)) {
      return i;
    }
  }
  return stages.length > 0 ? 0 : 0;
}

export function buildGlobalArchitectureDecisionStageShell(): Stage {
  return {
    id: GLOBAL_ARCHITECTURE_DECIDE_STAGE_ID,
    title: '全局架构决策（引擎插入）',
    description:
      '由 stagent.autoInsertGlobalArchitectureDecision 插入的空壳阶段：请在审核页确认模块边界与接口后再执行。',
    tool: STAGE_TOOL_LLM_TEXT,
    toolConfig: {
      type: STAGE_TOOL_LLM_TEXT,
      systemPrompt: ensureDecisionPromptStrict(GLOBAL_ARCH_SHELL_PROMPT_BASE),
    },
    input: { sources: [{ type: 'user-input', label: '用户任务' }], mergeStrategy: 'concat' },
    outputs: [{ key: PRIMARY_DECISION_OUTPUT_KEY, format: 'markdown' }],
    pauseAfter: true,
    isDecisionStage: true,
  };
}

/**
 * 多模块 software 计划缺全局架构决策时插入空壳阶段（须由配置开启）。
 * @returns 是否插入了新阶段
 */
export function insertGlobalArchitectureDecisionShellIfNeeded(wf: WorkflowDefinition): boolean {
  if (!shouldWarnSoftwareMissingGlobalArchitectureDecision(wf)) {
    return false;
  }
  if (wf.stages.some((s) => s.id === GLOBAL_ARCHITECTURE_DECIDE_STAGE_ID)) {
    return false;
  }
  const insertAt = findGlobalArchitectureShellInsertIndex(wf.stages);
  wf.stages.splice(insertAt, 0, buildGlobalArchitectureDecisionStageShell());
  wf.meta = {
    ...wf.meta,
    engineAutoInsertedGlobalArchitectureStageId: GLOBAL_ARCHITECTURE_DECIDE_STAGE_ID,
  };
  return true;
}

/** 插入壳后追加的 SOFT warning 行（`workflowGenerated.warnings`）。 */
export function buildAutoInsertedGlobalArchitectureWarningLine(wf: WorkflowDefinition): string | undefined {
  const stageId = wf.meta?.engineAutoInsertedGlobalArchitectureStageId;
  if (!stageId) {
    return undefined;
  }
  return formatRule20IssueLine(
    {
      type: 'global-architecture-decision-auto-inserted',
      stageId,
      message: rule20Msg('global-architecture-decision-auto-inserted'),
    },
    'warning',
  );
}
