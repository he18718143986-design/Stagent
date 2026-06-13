/**
 * 输入降级策略（full / summary / reference）—从 InputContextPolicy.ts 抽出（1.3）。
 * 仅负责单条 stage-output 的角色分级与降级模式选择。
 */
import { isImplStageId } from '../workflow/StageIdPatterns';
import { PRIMARY_DECISION_OUTPUT_KEY } from '../WorkflowOutputKeys';
import {
  INPUT_DEGRADE_DECISION_FULL_MAX,
  INPUT_DEGRADE_DECISION_SUMMARY_MAX,
  INPUT_DEGRADE_DEFAULT_FULL_MAX,
  INPUT_DEGRADE_IMPL_FULL_MAX,
  INPUT_DEGRADE_IMPL_SUMMARY_MAX,
} from '../InputDegradeThresholds';
import { DEFAULT_STAGE_INPUT_TRUNCATE_TOKENS } from '../InputTokenBudgets';
import type { InputSource } from '../WorkflowDefinition';

/** stage-output 输入在 resolveInput 中的降级角色 */
export type InputSourceRole = 'decision-record' | 'implementation' | 'default';

export type InputDegradeMode = 'full' | 'summary' | 'reference';

export interface InputDegradeThresholds {
  fullMax: number;
  summaryMax: number;
  /** 总上下文超限时，优先保留 full/summary，最后再降级此类条目 */
  preserveOnTotalOverflow: boolean;
}

/** 普通 stage-output（实现代码、日志等）：较早 summary */
export const INPUT_THRESHOLDS_DEFAULT: InputDegradeThresholds = {
  fullMax: INPUT_DEGRADE_DEFAULT_FULL_MAX,
  summaryMax: DEFAULT_STAGE_INPUT_TRUNCATE_TOKENS,
  preserveOnTotalOverflow: false,
};

/** decisionRecord 与全局决策注入块：尽量保留全文 */
export const INPUT_THRESHOLDS_DECISION_RECORD: InputDegradeThresholds = {
  fullMax: INPUT_DEGRADE_DECISION_FULL_MAX,
  summaryMax: INPUT_DEGRADE_DECISION_SUMMARY_MAX,
  preserveOnTotalOverflow: true,
};

/** 实现类输出（测试/源码）：略高阈值；总上下文超限时优先保留 */
export const INPUT_THRESHOLDS_IMPLEMENTATION: InputDegradeThresholds = {
  fullMax: INPUT_DEGRADE_IMPL_FULL_MAX,
  summaryMax: INPUT_DEGRADE_IMPL_SUMMARY_MAX,
  preserveOnTotalOverflow: true,
};

const IMPLEMENTATION_OUTPUT_KEYS = new Set([
  'testCode',
  'implementationCode',
  'sourceCode',
  'fileContent',
  'bindVideoTs',
  'indexPage',
  'packageJson',
]);

export function thresholdsForRole(role: InputSourceRole): InputDegradeThresholds {
  switch (role) {
    case 'decision-record':
      return INPUT_THRESHOLDS_DECISION_RECORD;
    case 'implementation':
      return INPUT_THRESHOLDS_IMPLEMENTATION;
    default:
      return INPUT_THRESHOLDS_DEFAULT;
  }
}

/** 按 outputKey / 来源 stageId 对 stage-output 分级，决定 full / summary / reference 阈值 */
export function classifyStageOutputSource(source: InputSource): InputSourceRole {
  if (source.type !== 'stage-output') {
    return 'default';
  }
  if (source.outputKey === PRIMARY_DECISION_OUTPUT_KEY) {
    return 'decision-record';
  }
  if (source.stageId && isImplStageId(source.stageId)) {
    return 'implementation';
  }
  if (source.outputKey && IMPLEMENTATION_OUTPUT_KEYS.has(source.outputKey)) {
    return 'implementation';
  }
  return 'default';
}

/** M20.3：源上显式 contextMode 覆盖自动降级计划 */
export function resolveExplicitContextDegradeMode(
  source: InputSource,
  tokenCount: number,
  role: InputSourceRole,
): InputDegradeMode | undefined {
  const mode = source.contextMode;
  if (!mode) {
    return undefined;
  }
  const { summaryMax } = thresholdsForRole(role);
  if (mode === 'full') {
    return 'full';
  }
  if (mode === 'reference') {
    return 'reference';
  }
  if (mode === 'summary') {
    return tokenCount <= summaryMax ? 'full' : 'summary';
  }
  return undefined;
}

export function planInputDegradeMode(tokenCount: number, role: InputSourceRole): InputDegradeMode {
  const { fullMax, summaryMax } = thresholdsForRole(role);
  if (tokenCount <= fullMax) {
    return 'full';
  }
  if (tokenCount <= summaryMax) {
    return 'summary';
  }
  return 'reference';
}

/** 总上下文超限时，选择下一个应降级的条目（非 preserve 优先，同组内 token 大者优先） */
export function pickEntryIndexToDegrade(
  entries: Array<{
    mode: InputDegradeMode;
    preservePriority: boolean;
    tokenCount: number;
    /** required=true 的 source：硬保留，永不降级；无法满足预算时由调用方抛 overflow。 */
    hardRequired?: boolean;
  }>,
): number {
  let best = -1;
  let bestPreserve = true;
  let bestTokens = -1;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.mode === 'reference') {
      continue;
    }
    if (e.hardRequired) {
      continue;
    }
    const preserve = e.preservePriority;
    const tokens = e.tokenCount;
    if (best < 0) {
      best = i;
      bestPreserve = preserve;
      bestTokens = tokens;
      continue;
    }
    if (bestPreserve && !preserve) {
      best = i;
      bestPreserve = preserve;
      bestTokens = tokens;
      continue;
    }
    if (bestPreserve === preserve && tokens > bestTokens) {
      best = i;
      bestTokens = tokens;
    }
  }
  return best;
}
