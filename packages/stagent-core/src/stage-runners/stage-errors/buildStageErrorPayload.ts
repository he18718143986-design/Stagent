import type { BackendMessage } from '../../WorkflowDefinition';
import { classifyThrownError, StagentError } from '../../ErrorTypeUtils';
import {
  ERROR_TYPE_CODE_RUNNER_TIMEOUT,
  ERROR_TYPE_INVARIANT_VIOLATION,
  ERROR_TYPE_LLM_CONTEXT_OVERFLOW,
  ERROR_TYPE_LLM_INVALID_OUTPUT,
  ERROR_TYPE_TOOL_EXECUTION_FAILED,
  LLM_CONTEXT_OVERFLOW_THROW_MESSAGE,
  llmContextOverflowStageError,
  stageErrorPayload,
} from '../../errors/stageErrorBuilders';
import { resolveTestRunStageErrorMessage } from '../../TestRunFailurePlaybook';
import { LOG_PREVIEW_ERROR_HEAD } from '../../LogPreviewLimits';
import type { StageStepContext } from '../StageStepContext';
import { DEBUG_EVENT_TEST_RUN_FAILURE_PLAYBOOK } from '../../DebugLogEvents';
import { planDiagnosticRouteFromStageError } from '../../diagnostic-router';
import { readContractDiagnosticRouterEnabled } from '../../settings/readers/contract';

type StageErrorMessage = Extract<BackendMessage, { type: 'stageError' }>;

export function buildStageErrorPayload(
  ctx: StageStepContext,
  e: unknown,
  attempt: number,
): { cancelled: boolean; payload: Omit<StageErrorMessage, 'type'>; implHollow: boolean } {
  const { params, stage, runtime } = ctx;
  const { debugLog, isCancellationError } = params;

  const msg = e instanceof Error ? e.message : String(e);
  if (e instanceof StagentError && e.errorType === ERROR_TYPE_LLM_CONTEXT_OVERFLOW) {
    return {
      cancelled: false,
      implHollow: false,
      payload: llmContextOverflowStageError(stage.id, 'LLM 上下文超出限制'),
    };
  }
  if (msg === LLM_CONTEXT_OVERFLOW_THROW_MESSAGE) {
    return {
      cancelled: false,
      implHollow: false,
      payload: llmContextOverflowStageError(stage.id, 'LLM 上下文超出限制'),
    };
  }

  const cancelled = isCancellationError(e) || (e instanceof Error && /cancel/i.test(e.message));
  const errorType = classifyThrownError(e, cancelled);
  const implHollow =
    e instanceof StagentError && e.errorType === ERROR_TYPE_LLM_INVALID_OUTPUT && msg.includes('impl-hollow');
  const isInvariantViolation = errorType === ERROR_TYPE_INVARIANT_VIOLATION;
  if (implHollow) {
    runtime.outputs._implExecNote = '实现阶段输出连续两次为空洞确认语句，已终止阶段，请检查该阶段 systemPrompt。';
  }
  const defaultError = implHollow
    ? '实现阶段输出为空洞确认语句（自动重试后仍失败）'
    : isInvariantViolation
      ? msg.replace('invariant-violation:', '')
      : msg;
  const so = runtime.outputs.stdout;
  const se = runtime.outputs.stderr;
  const resolvedError = resolveTestRunStageErrorMessage({
    stage,
    errorType,
    defaultError,
    stdout: typeof so === 'string' ? so : '',
    stderr: typeof se === 'string' ? se : '',
    timedOut: errorType === ERROR_TYPE_CODE_RUNNER_TIMEOUT,
    enabled: params.testRunFailurePlaybookEnabled !== false,
  });
  if (resolvedError !== defaultError) {
    debugLog(stage.id, DEBUG_EVENT_TEST_RUN_FAILURE_PLAYBOOK, attempt, {
      defaultError,
      resolvedHead: resolvedError.slice(0, LOG_PREVIEW_ERROR_HEAD),
    });
  }
  const errPayload: Omit<StageErrorMessage, 'type'> = stageErrorPayload(stage.id, errorType, resolvedError);
  if (readContractDiagnosticRouterEnabled()) {
    const route = planDiagnosticRouteFromStageError({
      stageId: stage.id,
      errorType,
      message: resolvedError,
      stdout: typeof so === 'string' ? so : undefined,
      stderr: typeof se === 'string' ? se : undefined,
    });
    errPayload.diagnosticRoute = route;
    runtime.outputs._diagnosticRoute = route;
  }
  if (errorType === ERROR_TYPE_TOOL_EXECUTION_FAILED || errorType === ERROR_TYPE_CODE_RUNNER_TIMEOUT) {
    if (typeof so === 'string' && so.length > 0) {
      errPayload.stdout = so;
    }
    if (typeof se === 'string' && se.length > 0) {
      errPayload.stderr = se;
    }
  }
  return { cancelled, payload: errPayload, implHollow };
}
