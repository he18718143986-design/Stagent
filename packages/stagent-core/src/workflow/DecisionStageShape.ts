import type { Stage, WorkflowDefinition } from '../WorkflowDefinition';
import { DECISION_ARTIFACTS_OUTPUT_KEY, PRIMARY_DECISION_OUTPUT_KEY } from '../WorkflowOutputKeys';
import { isDecisionLlmTextStage, isLlmTextTool, STAGE_TOOL_LLM_TEXT } from './StageToolKinds';
import { isSoftwareTaskType } from './TaskType';

export const DECISION_STAGE_INVARIANT_I1_MSG = '不变式 I-1：决策阶段必须使用 llm-text';

const DEFAULT_DECISION_STAGE_PROMPT = '请输出可审核的决策清单（DecisionRecord）。';
const SOFTWARE_FIRST_DECISION_PROMPT =
  '你是资深工程师。请先输出可审核的决策清单（DecisionRecord），再进入实现，禁止仅返回拒绝句。';

export function validateDecisionStageInvariants(stage: Stage): string[] {
  const errors: string[] = [];

  if (stage.isDecisionStage && !isDecisionLlmTextStage(stage)) {
    errors.push(`不变式 I-1：阶段 ${stage.id} 为决策阶段但 tool 不是 llm-text`);
  }
  if (stage.isDecisionStage && stage.exposeAssumptions) {
    errors.push(`不变式 I-5：阶段 ${stage.id} isDecisionStage 与 exposeAssumptions 不能同时为 true`);
  }
  if (stage.questionAfter?.length && !stage.pauseAfter) {
    errors.push(`不变式 I-6：阶段 ${stage.id} 含 questionAfter 时 pauseAfter 必须为 true`);
  }

  if (stage.id === 'stage_impl_web_package_json' || stage.id === 'stage_impl_uniapp_package_json') {
    if (stage.isDecisionStage === true) {
      errors.push(
        `阶段 ${stage.id} 为实现阶段（生成 package.json），不得设置 isDecisionStage=true（否则 UI 会误用 approveDecision，日志 outputKey 易与决策混淆）`,
      );
    }
    const firstKey = stage.outputs?.[0]?.key;
    if (firstKey !== 'packageJson') {
      errors.push(
        `阶段 ${stage.id} 的首个 outputs[].key 必须为 "packageJson"（当前为 ${JSON.stringify(
          firstKey,
        )}）；禁止沿用决策阶段的 decisionRecord`,
      );
    }
  }

  return errors;
}

export function ensureDecisionStageOutput(stage: Stage): void {
  if (!stage.isDecisionStage) {
    return;
  }
  if (!Array.isArray(stage.outputs)) {
    stage.outputs = [];
  }
  if (!stage.outputs.some((o) => o.key === PRIMARY_DECISION_OUTPUT_KEY)) {
    stage.outputs.unshift({ key: PRIMARY_DECISION_OUTPUT_KEY, format: 'markdown' });
  }
  if (!stage.outputs.some((o) => o.key === DECISION_ARTIFACTS_OUTPUT_KEY)) {
    stage.outputs.push({ key: DECISION_ARTIFACTS_OUTPUT_KEY, format: 'json' });
  }
}

export interface NormalizeDecisionStageOptions {
  strictPrompt?: (basePrompt: string) => string;
  defaultPrompt?: string;
}

export function normalizeDecisionStage(
  stage: Stage,
  options: NormalizeDecisionStageOptions = {},
): void {
  if (!isDecisionLlmTextStage(stage)) {
    return;
  }
  const tc = stage.toolConfig as { type: 'llm-text'; systemPrompt?: string };
  const defaultPrompt = options.defaultPrompt ?? DEFAULT_DECISION_STAGE_PROMPT;
  const basePrompt = tc.systemPrompt?.trim() || defaultPrompt;
  if (options.strictPrompt) {
    tc.systemPrompt = options.strictPrompt(basePrompt);
  } else {
    tc.systemPrompt = basePrompt;
  }
  stage.pauseAfter = true;
  ensureDecisionStageOutput(stage);
}

export interface EnsureSoftwareDecisionStageOptions {
  strictPrompt?: (basePrompt: string) => string;
}

export function ensureSoftwareWorkflowHasDecisionStage(
  wf: WorkflowDefinition,
  options: EnsureSoftwareDecisionStageOptions = {},
): void {
  if (!isSoftwareTaskType(wf.meta?.taskType) || wf.stages.length === 0) {
    return;
  }
  const hasDecision = wf.stages.some((s) => s.isDecisionStage);
  if (hasDecision) {
    return;
  }
  const first = wf.stages[0];
  first.isDecisionStage = true;
  first.pauseAfter = true;
  ensureDecisionStageOutput(first);
  if (!isLlmTextTool(first.tool)) {
    first.tool = STAGE_TOOL_LLM_TEXT;
    const basePrompt = SOFTWARE_FIRST_DECISION_PROMPT;
    first.toolConfig = {
      type: 'llm-text',
      systemPrompt: options.strictPrompt ? options.strictPrompt(basePrompt) : basePrompt,
    };
  }
}
