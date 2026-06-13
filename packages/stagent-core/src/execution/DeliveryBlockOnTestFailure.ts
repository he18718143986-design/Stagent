import type { WorkspaceConfiguration } from '../platform/HostTypes';
import type { StageRuntime } from '../WorkflowDefinition';
import { CODE_RUNNER_EXIT_OUTPUT_KEY } from '../WorkflowOutputKeys';
import { isTestRunStageId } from '../workflow/StageIdPatterns';
import { DELIVERY_WRAPUP_STAGE_ID } from '../disk-bootstrap/deliveryWrapupStage';

const DELIVERY_STAGE_RE = /^stage_delivery(?:_|$)/;

/** 交付相关阶段（含 LLM 生成的 stage_delivery 与引擎注入的 wrapup）。 */
export function isDeliveryStageId(stageId: string): boolean {
  return stageId === DELIVERY_WRAPUP_STAGE_ID || DELIVERY_STAGE_RE.test(stageId);
}

/** 任一 test_run 的 code-runner exit ≠ 0（含软失败保留的 exit）。 */
export function anyTestRunFailed(runtimes: readonly StageRuntime[]): boolean {
  for (const rt of runtimes) {
    if (!isTestRunStageId(rt.stageId)) {
      continue;
    }
    const exit = rt.outputs[CODE_RUNNER_EXIT_OUTPUT_KEY];
    if (typeof exit === 'number' && exit !== 0) {
      return true;
    }
  }
  return false;
}

const NON_BLOCKING_TASK_TYPES = new Set(['prototype', 'document', 'refactor', 'video', 'debug']);

/**
 * software 默认 true；prototype/document/refactor 等默认 false。
 * 显式 `execution.blockDeliveryOnTestFailure` 覆盖 taskType 默认。
 */
export function readBlockDeliveryOnTestFailure(
  cfg: WorkspaceConfiguration | undefined,
  taskType: string | undefined,
): boolean {
  if (cfg && typeof cfg.get === 'function') {
    const explicit = cfg.get<boolean | undefined>('execution.blockDeliveryOnTestFailure');
    if (explicit === true) {
      return true;
    }
    if (explicit === false) {
      return false;
    }
  }
  const tt = (taskType ?? '').trim().toLowerCase();
  if (tt === 'software') {
    return true;
  }
  if (NON_BLOCKING_TASK_TYPES.has(tt)) {
    return false;
  }
  return false;
}
