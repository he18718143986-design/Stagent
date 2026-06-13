import type * as vscode from '../platform/HostTypes';
import type { StageRuntime, WorkflowInstance } from '../WorkflowDefinition';
import type { ToolExecutionUserCategory } from '../errors/catalog/toolExecutionCopy';
import { parseCodeRunnerExitCode } from '../errors/catalog/toolExecutionCopy';
import { isTestRunStageId } from '../workflow/StageIdPatterns';
import { findBestImplStageIndex } from '../TddStackMatch';
import {
  applyRetryBase,
  applyRetryForNonDecision,
  guardedInstanceTransition,
} from '../WorkflowStateTransitions';
import { rollbackArtifactsForStage } from '../hitl/ArtifactRollback';
import type { HitlCoordinatorHost } from '../hitl/HitlCoordinatorHost';
import { enforceRetryLimitOrReject } from '../hitl/RetryLimitGate';
import { postHitlActionHint } from '../hitl/postHitlStageError';
import { HITL_HINT_NO_INSTANCE, HITL_HINT_STAGE_NOT_ACTIONABLE } from '../hitl/hitlHints';
import { findHitlStage } from '../hitl/resolveHitlStage';
import { evaluateManualRetryLimit } from '../ManualRetryLimit';
import {
  collectUpstreamFixResets,
  copyFailureSnapshotForUpstreamFix,
} from './UpstreamFixResets';
import type { UpstreamFixResult } from './UpstreamFixResult';

export const UPSTREAM_FIX_HINT_NOT_ELIGIBLE =
  '当前失败不适合「修复代码」：仅 test_run 代码类失败（非环境问题）可用此操作。';

export const UPSTREAM_FIX_HINT_NO_IMPL =
  '未找到可修复的上游 impl 阶段，请手动选择阶段重试。';

export interface UpstreamFixEligibilityInput {
  stageId: string;
  userCategory?: ToolExecutionUserCategory;
  weakenRetry?: boolean;
  exitCode?: number;
}

export function deriveUpstreamFixEligibility(
  failedStageId: string,
  runtime: StageRuntime,
): UpstreamFixEligibilityInput {
  const exitCode =
    runtime.lastFailureSnapshot?.exitCode ??
    parseCodeRunnerExitCode(runtime.lastError?.error ?? '');
  const weakenRetry = exitCode === 127;
  let userCategory: ToolExecutionUserCategory | undefined;
  if (exitCode === 127) {
    userCategory = 'environment';
  } else if (exitCode === 1) {
    userCategory = 'code';
  } else if (
    runtime.lastFailureSnapshot?.errorType === 'tool-execution-failed' ||
    runtime.lastError?.errorType === 'tool-execution-failed'
  ) {
    userCategory = 'code';
  }
  return { stageId: failedStageId, userCategory, weakenRetry, exitCode };
}

/** test_run + code 类 + 非 weakenRetry（127 等环境问题排除）。 */
export function isUpstreamFixEligible(input: UpstreamFixEligibilityInput): boolean {
  if (!isTestRunStageId(input.stageId)) {
    return false;
  }
  if (input.weakenRetry) {
    return false;
  }
  if (input.userCategory !== 'code') {
    return false;
  }
  if (input.exitCode === 127) {
    return false;
  }
  return true;
}

export function resolveUpstreamImplStageIndex(
  instance: WorkflowInstance,
  failedTestRunStageId: string,
): number {
  const failedIdx = instance.definition.stages.findIndex((s) => s.id === failedTestRunStageId);
  if (failedIdx < 0) {
    return -1;
  }
  const testRunStage = instance.definition.stages[failedIdx]!;
  return findBestImplStageIndex(instance.definition, failedIdx, testRunStage);
}

export function resolveUpstreamImplStageId(
  instance: WorkflowInstance,
  failedTestRunStageId: string,
): string | undefined {
  const idx = resolveUpstreamImplStageIndex(instance, failedTestRunStageId);
  if (idx < 0) {
    return undefined;
  }
  return instance.definition.stages[idx]?.id;
}

/**
 * 从 test_run 错误卡触发：路由到切片内最近 impl，复制失败 snapshot，reset test_run，自动推进执行。
 * upstream-fix 消耗 target impl 的 retryCount（与手动重试共享限额，applyRetryBase 自增）。
 */
export async function handleUpstreamFix(
  host: HitlCoordinatorHost,
  failedStageId: string,
  panel: vscode.WebviewPanel,
): Promise<UpstreamFixResult> {
  host.bindPanel(panel);
  const instance = host.getInstance();
  if (!instance) {
    postHitlActionHint(host, panel, HITL_HINT_NO_INSTANCE, failedStageId);
    return { ok: false, reason: 'no-instance', message: HITL_HINT_NO_INSTANCE };
  }

  const failedBinding = findHitlStage(instance, failedStageId);
  if (!failedBinding) {
    postHitlActionHint(host, panel, HITL_HINT_STAGE_NOT_ACTIONABLE, failedStageId);
    return { ok: false, reason: 'stage-not-actionable', message: HITL_HINT_STAGE_NOT_ACTIONABLE };
  }

  const failedRt = failedBinding.rt;
  const eligibility = deriveUpstreamFixEligibility(failedStageId, failedRt);

  if (!isUpstreamFixEligible(eligibility)) {
    postHitlActionHint(host, panel, UPSTREAM_FIX_HINT_NOT_ELIGIBLE, failedStageId);
    return { ok: false, reason: 'not-eligible', message: UPSTREAM_FIX_HINT_NOT_ELIGIBLE };
  }

  const implIdx = resolveUpstreamImplStageIndex(instance, failedStageId);
  if (implIdx < 0) {
    postHitlActionHint(host, panel, UPSTREAM_FIX_HINT_NO_IMPL, failedStageId);
    return { ok: false, reason: 'no-upstream-impl', message: UPSTREAM_FIX_HINT_NO_IMPL };
  }

  const implStage = instance.definition.stages[implIdx]!;
  const implRt = instance.stageRuntimes[implIdx]!;

  const limit = evaluateManualRetryLimit(implRt.retryCount, host.getMaxManualStageRetries());
  if (!limit.allowed) {
    enforceRetryLimitOrReject(host, panel, implStage.id, implRt.retryCount);
    return { ok: false, reason: 'retry-limit-exceeded', message: limit.message };
  }

  host.logUserAction('upstream_fix', {
    failedStageId,
    targetImplStageId: implStage.id,
  });

  copyFailureSnapshotForUpstreamFix(failedRt, implRt);

  await rollbackArtifactsForStage(host, instance, implStage.id, implRt.retryCount + 1);
  // upstream-fix 消耗 impl 的 retryCount（与侧栏手动重试 impl 共享 maxManualStageRetries）。
  applyRetryBase(implRt, '');
  applyRetryForNonDecision(implRt);

  const { resetStageIds, resetStageTitles } = collectUpstreamFixResets(
    instance.definition,
    instance,
    failedStageId,
  );

  host.postMessage(panel, {
    type: 'upstreamFixStarted',
    failedStageId,
    targetImplStageId: implStage.id,
    resetStageIds,
    resetStageTitles,
  });

  host.setCurrentStageIndex(implIdx);
  guardedInstanceTransition(instance, 'running', 'upstream-fix-resume-execution');
  host.setInstanceStatus('running');
  host.scheduleSave();
  await host.executeNextStage(panel);

  return { ok: true, targetImplStageId: implStage.id };
}
