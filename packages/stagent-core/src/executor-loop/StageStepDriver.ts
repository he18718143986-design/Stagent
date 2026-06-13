import { executeStageStep } from '../WorkflowStageStep';
import type { ExecuteNextStageLoopParams } from '../WorkflowExecutorTypes';
import {
  DEBUG_EVENT_LINEAR_STAGE_SKIP,
  DEBUG_EVENT_RUN_END,
  DEBUG_EVENT_RUN_END_CONTRACT_LINT,
  DEBUG_EVENT_RUN_END_CONTRACT_LINT_ERROR,
} from '../DebugLogEvents';
import { WORKFLOW_LEVEL_STAGE_ID } from '../workflow/WorkflowLevelIds';
import { buildQualityReportPayload } from '../quality-report/buildQualityReportPayload';

/**
 * M27.3：run_end 前兜底契约 lint（异常不影响完成流程）。
 * 返回需要在完成时展示给用户的提示：lint warnings + 检查本身失败时的错误说明，
 * 避免"看起来成功但收尾检查其实失败"的静默情况。
 */
export async function runEndContractLintSafely(params: ExecuteNextStageLoopParams): Promise<string[]> {
  try {
    let warnings: string[] = [];
    if (params.preRunEndContractLint) {
      warnings = await params.preRunEndContractLint();
    } else {
      return [];
    }
    if (warnings.length > 0) {
      params.debugLog(WORKFLOW_LEVEL_STAGE_ID, DEBUG_EVENT_RUN_END_CONTRACT_LINT, 0, { warnings });
    }
    return warnings;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    params.debugLog(WORKFLOW_LEVEL_STAGE_ID, DEBUG_EVENT_RUN_END_CONTRACT_LINT_ERROR, 0, {
      error: message,
    });
    return [`收尾契约检查未完成：${message}`];
  }
}

export async function executeNextStageLoopLinear(params: ExecuteNextStageLoopParams): Promise<void> {
  const { scheduleSave, debugLog, postMessage, panel } = params;

  // 每轮从 params.instance 重新取引用：runtime replan 会原地突变 stages/runtimes，
  // 任何在循环外缓存的解构引用都可能因未来的实例替换而失效（T4 Run #23 教训）。
  while (params.instance.currentStageIndex < params.instance.definition.stages.length) {
    const instance = params.instance;
    const idx = instance.currentStageIndex;
    const runtime = instance.stageRuntimes[idx];

    if (runtime.status === 'done' || runtime.status === 'skipped') {
      debugLog(instance.definition.stages[idx]?.id ?? `idx-${idx}`, DEBUG_EVENT_LINEAR_STAGE_SKIP, 0, {
        status: runtime.status,
        fromIndex: idx,
        toIndex: idx + 1,
      });
      instance.currentStageIndex++;
      continue;
    }
    if (runtime.status === 'paused') {
      return;
    }

    const outcome = await executeStageStep(params, idx);
    if (outcome === 'failed' || params.instance.status === 'failed') {
      return;
    }
    if (outcome === 'halt') {
      return;
    }
    if (outcome === 'replan') {
      scheduleSave();
      continue;
    }

    params.instance.currentStageIndex++;
    scheduleSave();
  }

  const instance = params.instance;
  const endWarnings = await runEndContractLintSafely(params);
  instance.status = 'completed';
  instance.completedAt = new Date().toISOString();
  debugLog(WORKFLOW_LEVEL_STAGE_ID, DEBUG_EVENT_RUN_END, 0, { status: 'completed' });
  postMessage(panel, {
    type: 'workflowCompleted',
    ...(endWarnings.length > 0 ? { warnings: endWarnings } : {}),
    qualityReport: buildQualityReportPayload(instance),
  });
  scheduleSave();
}
