import type { BackendMessage, StageRuntime, WorkflowInstance } from './WorkflowDefinition';
import { formatStageErrorForUser } from './StageErrorCatalog';
import type { PanelLike, StageStepOutcome } from './WorkflowExecutorTypes';
import { captureFailureSnapshot } from './retry/FailureSnapshot';

export {
  ERROR_TYPE_CODE_RUNNER_TIMEOUT,
  ERROR_TYPE_CONFIDENCE_TOO_LOW,
  ERROR_TYPE_FILE_NOT_FOUND,
  ERROR_TYPE_INVARIANT_VIOLATION,
  ERROR_TYPE_LLM_CONTEXT_OVERFLOW,
  ERROR_TYPE_LLM_INVALID_OUTPUT,
  ERROR_TYPE_LLM_QUALITY_BELOW_THRESHOLD,
  ERROR_TYPE_LLM_REFUSAL,
  ERROR_TYPE_LLM_TIMEOUT,
  ERROR_TYPE_RETRY_LIMIT_EXCEEDED,
  ERROR_TYPE_SANDBOX_MEMORY_EXCEEDED,
  ERROR_TYPE_SANDBOX_NETWORK_BLOCKED,
  ERROR_TYPE_STAGE_NOT_FOUND,
  ERROR_TYPE_STATIC_ANALYSIS_FAILED,
  ERROR_TYPE_TOOL_EXECUTION_FAILED,
  ERROR_TYPE_UNKNOWN,
  KNOWN_ERROR_TYPES,
  LLM_CONTEXT_OVERFLOW_THROW_MESSAGE,
  invariantStageError,
  llmContextOverflowStageError,
  llmInvalidOutputStageError,
  retryLimitStageError,
  stageErrorPayload,
} from './errors/stageErrorBuilders';

type StageErrorMessage = Extract<BackendMessage, { type: 'stageError' }>;

export function enrichStageErrorPayload(
  err: Omit<StageErrorMessage, 'type'>,
): Omit<StageErrorMessage, 'type'> {
  const formatted = formatStageErrorForUser(err.errorType, err.error, {
    stderr: err.stderr,
    stageId: err.stageId,
  });
  return {
    ...err,
    userTitle: formatted.title,
    userBody: formatted.userBody,
    userCategory: formatted.userCategory,
    exitCode: formatted.exitCode,
    weakenRetry: formatted.weakenRetry,
    playbookSteps: formatted.playbookSteps.length > 0 ? formatted.playbookSteps : undefined,
  };
}

export function persistStageLastError(runtime: StageRuntime, err: Omit<StageErrorMessage, 'type'>): void {
  runtime.lastError = {
    error: err.error,
    errorType: err.errorType,
    stdout: err.stdout,
    stderr: err.stderr,
  };
  captureFailureSnapshot(runtime, err);
}

export function postStageError(
  panel: PanelLike,
  postMessage: (panel: PanelLike, msg: BackendMessage) => void,
  runtime: StageRuntime,
  err: Omit<StageErrorMessage, 'type'>,
  options?: { persistLastError?: boolean },
): void {
  if (options?.persistLastError !== false) {
    persistStageLastError(runtime, err);
  }
  postMessage(panel, { type: 'stageError', ...enrichStageErrorPayload(err) });
}

/** 有 runtime 时走 postStageError；否则仍格式化并下发 stageError（如启动前校验尚无 runtime）。 */
export function emitStageError(
  panel: PanelLike | undefined,
  postMessage: (panel: PanelLike | undefined, msg: BackendMessage) => void,
  instance: WorkflowInstance | undefined,
  err: Omit<StageErrorMessage, 'type'>,
  options?: { persistLastError?: boolean },
): void {
  const runtime = instance?.stageRuntimes.find((r) => r.stageId === err.stageId);
  if (runtime && panel !== undefined) {
    postStageError(panel, postMessage, runtime, err, options);
    return;
  }
  postMessage(panel, { type: 'stageError', ...enrichStageErrorPayload(err) });
}

/** 阶段终态失败：同步 stageError + stageStatus error + workflowFailed。 */
export function failWorkflowStage(
  panel: PanelLike,
  postMessage: (panel: PanelLike, msg: BackendMessage) => void,
  runtime: StageRuntime,
  instance: WorkflowInstance,
  err: Omit<StageErrorMessage, 'type'>,
  scheduleSave: () => void,
): StageStepOutcome {
  runtime.status = 'error';
  instance.status = 'failed';
  postStageError(panel, postMessage, runtime, err);
  postMessage(panel, { type: 'stageStatusUpdate', stageId: err.stageId, status: 'error' });
  postMessage(panel, {
    type: 'workflowFailed',
    reason: err.error,
    errorType: err.errorType,
    stageId: err.stageId,
  });
  scheduleSave();
  return 'failed';
}
