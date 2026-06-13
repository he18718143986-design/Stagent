import type { Stage, SkipCondition } from '../WorkflowDefinition';
import type { LlmTextConfig } from '../workflow-types/StageTypes';
import { isLlmTextTool, STAGE_TOOL_LLM_TEXT } from '../workflow/StageToolKinds';
import { isTestWriteStageId } from '../workflow/StageIdPatterns';
import { DELIVERY_WRAPUP_TEXT } from '../generated/PromptFragments';

/** 交付收口阶段固定 id（末尾追加，幂等）。 */
export const DELIVERY_WRAPUP_STAGE_ID = 'stage_delivery_wrapup';

/** test_run 未全绿时跳过 delivery（配合 blockDeliveryOnTestFailure 硬失败）。 */
export const DELIVERY_SKIP_IF_ANY_TEST_RUN_FAILED: SkipCondition = {
  type: 'anyTestRunFailed',
  stageId: '_any_test_run_',
};

/** 本次工作流的「产物文件清单」：所有 llm-text 阶段的 writeOutputToFile 落盘路径（含测试文件）。 */
export function collectDeliverableFilePaths(stages: Stage[]): string[] {
  const paths: string[] = [];
  for (const s of stages) {
    if (!isLlmTextTool(s.tool)) {
      continue;
    }
    const out = (s.toolConfig as LlmTextConfig).writeOutputToFile?.trim();
    if (out) {
      paths.push(out);
    }
  }
  return [...new Set(paths)];
}

function buildDeliveryWrapupSystemPrompt(filePaths: string[]): string {
  const manifest = filePaths.length
    ? filePaths.map((p) => `- ${p}`).join('\n')
    : '（本次未声明 writeOutputToFile 产物；请基于已批准决策如实说明）';
  return `${DELIVERY_WRAPUP_TEXT}\n\n## 产物文件清单（务必逐一覆盖，不要编造清单外文件）\n${manifest}`;
}

/**
 * 交付收口：在工作流末尾追加 `stage_delivery_wrapup`（llm-text → DELIVERY.md）。
 * - 汇总「做了什么 / 文件清单 / 怎么运行 / 验收清单 / 一键自检 / 已知限制」。
 * - pauseAfter=true：作为「里程碑可感知验收」让用户过目（交付收口）。
 * - 已批准 DecisionRecord 由 GlobalDecisionContext 自动注入本 llm-text 阶段。
 * - 幂等：已存在则不重复注入；无任何代码/测试产物时不注入。
 */
export function injectDeliveryWrapupStage(stages: Stage[]): Stage[] {
  if (stages.some((s) => s.id === DELIVERY_WRAPUP_STAGE_ID)) {
    return stages;
  }
  const allDeliverables = collectDeliverableFilePaths(stages);
  // 仅当存在「非测试」产物（真正的可交付实现）时才收口，避免给纯文档/空计划加噪声。
  const hasImplDeliverable = stages.some(
    (s) =>
      isLlmTextTool(s.tool) &&
      !isTestWriteStageId(s.id) &&
      !!(s.toolConfig as LlmTextConfig).writeOutputToFile?.trim(),
  );
  if (!hasImplDeliverable) {
    return stages;
  }

  const last = stages[stages.length - 1];
  const stage: Stage = {
    id: DELIVERY_WRAPUP_STAGE_ID,
    title: '交付收口（验收 + 运行说明）',
    description:
      '汇总本次交付：做了什么、文件清单、怎么运行、验收清单、一键自检、已知限制，写入工作区根 DELIVERY.md，并暂停供用户验收。',
    aiTip: '面向非技术用户的验收页：核对「做得对吗 / 怎么跑」，不对则可回到对应阶段修。',
    tool: STAGE_TOOL_LLM_TEXT,
    toolConfig: {
      type: STAGE_TOOL_LLM_TEXT,
      systemPrompt: buildDeliveryWrapupSystemPrompt(allDeliverables),
      writeOutputToFile: 'DELIVERY.md',
      writePathBase: 'workspace',
    },
    dependsOn: last ? [last.id] : undefined,
    input: {
      sources: [{ type: 'user-input', label: '原始需求' }],
      mergeStrategy: 'concat',
    },
    outputs: [{ key: 'delivery', format: 'markdown' }],
    pauseAfter: true,
    skipIf: DELIVERY_SKIP_IF_ANY_TEST_RUN_FAILED,
  };
  return [...stages, stage];
}
