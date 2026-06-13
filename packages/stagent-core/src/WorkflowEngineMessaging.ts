/**
 * M41：Webview 消息副作用链 — postMessage 前后的 stageError 日志、experience、artifact hints。
 */
import type * as vscode from './platform/HostTypes';
import { showFeedbackPrompt } from './adapters/showFeedbackPrompt';
import { enrichBackendMessageInstanceKey } from './BackendMessageEnrichment';
import type { BackendMessage, ErrorType, WorkflowInstance } from './WorkflowDefinition';
import {
  appendGlobalFailureJsonl,
  appendWorkflowFailureJsonl,
  buildWorkflowFailureRecord,
} from './WorkflowFailureLog';
import { getStagentConfiguration } from './settings/getStagentConfiguration';
import { uiMsg } from './l10n/uiStrings';
import { MS_PER_DAY } from './TimeConstants';
import { LOG_PREVIEW_DEBUG_ERROR, LOG_PREVIEW_SHORT } from './LogPreviewLimits';
import {
  appendWorkflowExperience,
  buildWorkflowExperience,
  resolveExperienceStorePath,
} from './WorkflowExperienceStore';
import {
  markArtifactsApprovedForStage,
  markArtifactsVerifiedForStage,
} from './ArtifactLifecycleManager';
import { collectStageArtifactHints } from './ArtifactUiHints';
import {
  readEngineMemoryExperienceEnabled,
  readEngineMemoryMaxExperienceEntries,
} from './WorkflowEngineSettingsReaders';
import { DEBUG_EVENT_STAGE_ERROR } from './DebugLogEvents';
import { showMilestoneVerifyHintIfAny } from './adapters/showMilestoneVerifyHint';
import { computeCharterCoverageMetrics } from './charter/CharterCoverageMetrics';
import { maybePromptCharterFeedbackAsync } from './charter/maybePromptCharterFeedback';
import { evaluateAfkAcceptance } from './afk/evaluateAfkAcceptance';
import { readAfkEnabled } from './settings/readers/afk';
import { readFriendlyMilestoneVerifyHint } from './settings/readers/friendly';
import type { MessagingHost } from './engine-host/MessagingHost';

export { CHARTER_FEEDBACK_LAST_ASKED_KEY, FEEDBACK_LAST_ASKED_KEY } from './instance/StagentGlobalStateKeys';
export { MS_PER_DAY } from './TimeConstants';
export type { MessagingHost } from './engine-host/MessagingHost';

export function debugStageErrorLine(
  host: MessagingHost,
  msg: Extract<BackendMessage, { type: 'stageError' }>,
): void {
  const err = msg.error;
  const preview =
    err.length > LOG_PREVIEW_DEBUG_ERROR
      ? `${err.slice(0, LOG_PREVIEW_DEBUG_ERROR)}…`
      : err;
  host.debugLog(msg.stageId, DEBUG_EVENT_STAGE_ERROR, 0, {
    errorType: msg.errorType,
    errorPreview: preview,
    hasRawOutput: Boolean(msg.rawOutput),
    hasStdout: Boolean(msg.stdout),
    hasStderr: Boolean(msg.stderr),
  });
}

export function persistWorkflowExperience(
  host: MessagingHost,
  completionStatus: 'completed' | 'failed',
  failure?: { stageId: string; errorType: ErrorType },
): void {
  const instance = host.getInstance();
  if (!instance) {
    return;
  }
  const instanceKey = host.getCurrentInstanceKey();
  if (!instanceKey || host.getExperiencePersistedForKey() === instanceKey) {
    return;
  }

  if (!readEngineMemoryExperienceEnabled()) {
    return;
  }

  const workspaceRoot = instance.definition.meta.taskWorkspacePath?.trim();
  if (!workspaceRoot) {
    return;
  }

  const maxEntries = readEngineMemoryMaxExperienceEntries();
  const experience = buildWorkflowExperience(instance, {
    completionStatus,
    instanceKey,
    failureStageId: failure?.stageId,
    failureErrorType: failure?.errorType,
  });
  appendWorkflowExperience(
    resolveExperienceStorePath(workspaceRoot),
    experience,
    maxEntries,
    (m) => host.warn(m),
  );
  if (experience.charterCoverage) {
    host.logUserAction('charter_coverage_metrics', { ...experience.charterCoverage });
  }
  host.setExperiencePersistedForKey(instanceKey);
}

/** 工作流完成后引导用户填写反馈（移植自 ai-workflow）。 */
export async function maybePromptFeedbackAsync(
  host: MessagingHost,
  getLastAsked: () => string | undefined,
  setLastAsked: (iso: string) => Promise<void>,
): Promise<void> {
  try {
    const cfg = getStagentConfiguration();
    const formUrl = (cfg.get<string>('feedback.formUrl') ?? '').trim();
    if (!formUrl) {
      return;
    }
    const cooldownDays = Math.max(0, cfg.get<number>('feedback.cooldownDays') ?? 7);
    const lastAsked = getLastAsked();
    if (lastAsked) {
      const elapsedDays = (Date.now() - new Date(lastAsked).getTime()) / MS_PER_DAY;
      if (Number.isFinite(elapsedDays) && elapsedDays < cooldownDays) {
        return;
      }
    }
    await setLastAsked(new Date().toISOString());
    try {
      const feedbackLabel = uiMsg('stagent.action.openFeedback');
      await showFeedbackPrompt(uiMsg('stagent.info.feedbackPrompt'), feedbackLabel, formUrl);
    } catch (e) {
      host.warn(`feedback_message_failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  } catch (e) {
    host.warn(`feedback_prompt_failed: ${String(e)}`);
  }
}

export function markStageArtifactsVerified(instance: WorkflowInstance | undefined, stageId: string): void {
  if (!instance?.artifactRegistry) {
    return;
  }
  markArtifactsVerifiedForStage(instance.artifactRegistry, stageId);
}

export function markStageArtifactsApproved(instance: WorkflowInstance | undefined, stageId: string): void {
  if (!instance?.artifactRegistry) {
    return;
  }
  markArtifactsApprovedForStage(instance.artifactRegistry, stageId);
}

function voidWebviewPostMessage(
  panel: vscode.WebviewPanel,
  msg: BackendMessage,
  warn: (message: string) => void,
): void {
  const webview = (panel as { webview?: { postMessage: (m: BackendMessage) => void | Promise<void> } })
    .webview;
  if (!webview?.postMessage) {
    return;
  }
  void Promise.resolve(webview.postMessage(msg)).catch((e) => {
    const err = e instanceof Error ? e.message : String(e);
    warn(`webview_post_message_failed type=${msg.type} err=${err}`);
  });
}

export function emitStageArtifactHints(
  host: MessagingHost,
  instance: WorkflowInstance | undefined,
  panel: vscode.WebviewPanel,
  stageId: string,
  warn: (message: string) => void,
): void {
  if (!instance) {
    return;
  }
  const stage = instance.definition.stages.find((s) => s.id === stageId);
  if (!stage || stage.isDecisionStage) {
    return;
  }
  const artifacts = collectStageArtifactHints(instance.artifactRegistry, stage);
  if (artifacts.length === 0) {
    return;
  }
  const msg = enrichBackendMessageInstanceKey(host, { type: 'stageArtifactHints', stageId, artifacts });
  voidWebviewPostMessage(panel, msg, warn);
}

export interface SessionPromptDeps {
  getLastAsked: () => string | undefined;
  setLastAsked: (iso: string) => Promise<void>;
  getCharterFeedbackLastAsked: () => string | undefined;
  setCharterFeedbackLastAsked: (iso: string) => Promise<void>;
}

export function applyPostMessageSideEffects(
  host: MessagingHost,
  msg: BackendMessage,
  feedback: SessionPromptDeps,
): void {
  if (msg.type === 'stageError') {
    try {
      debugStageErrorLine(host, msg);
    } catch (e) {
      host.warn(`stage_error debug log: ${String(e)}`);
    }
    try {
      const instance = host.getInstance();
      if (instance?.taskDir) {
        const rec = buildWorkflowFailureRecord(instance, {
          stageId: msg.stageId,
          error: msg.error,
          errorType: msg.errorType,
        });
        if (rec) {
          appendWorkflowFailureJsonl(instance.taskDir, rec, (m) => host.warn(m));
          appendGlobalFailureJsonl(host.getGlobalStorageFsPath(), rec, (m) => host.warn(m));
        }
      }
    } catch (e) {
      host.warn(`stageError failure-log: ${String(e)}`);
    }
    if (host.getInstance()?.status === 'failed') {
      persistWorkflowExperience(host, 'failed', {
        stageId: msg.stageId,
        errorType: msg.errorType,
      });
    }
    try {
      host.logUserAction('stage_error', {
        stageId: msg.stageId,
        errorType: msg.errorType,
        errorPreview:
          typeof msg.error === 'string' && msg.error.length > LOG_PREVIEW_SHORT
            ? `${msg.error.slice(0, LOG_PREVIEW_SHORT)}…(+${msg.error.length - LOG_PREVIEW_SHORT})`
            : msg.error,
      });
    } catch (e) {
      host.warn(`stage_error user_action: ${String(e)}`);
    }
    if (host.getInstance()?.status === 'failed') {
      host.flushMetrics?.('failed');
    }
  }
  if (msg.type === 'workflowCompleted') {
    persistWorkflowExperience(host, 'completed');
    host.flushMetrics?.('completed');
    const completedInstance = host.getInstance();
    if (completedInstance?.status === 'completed') {
      const coverage = computeCharterCoverageMetrics(completedInstance);
      host.debugLog('workflow', 'charter_coverage', 0, coverage);
      if (readFriendlyMilestoneVerifyHint(getStagentConfiguration())) {
        void showMilestoneVerifyHintIfAny(completedInstance).catch((e) => {
          host.warn(`milestone_verify_hint_failed: ${e instanceof Error ? e.message : String(e)}`);
        });
      }
      if (readAfkEnabled(getStagentConfiguration())) {
        const afkReport = evaluateAfkAcceptance(completedInstance);
        host.logUserAction('afk_acceptance', { ...afkReport });
        host.debugLog('workflow', 'afk_acceptance', 0, afkReport);
      }
    }
    void maybePromptFeedbackAsync(host, feedback.getLastAsked, feedback.setLastAsked).catch((e) => {
      host.warn(`feedback_prompt_async_failed: ${e instanceof Error ? e.message : String(e)}`);
    });
    void maybePromptCharterFeedbackAsync(host, {
      getLastAsked: feedback.getCharterFeedbackLastAsked,
      setLastAsked: feedback.setCharterFeedbackLastAsked,
    }).catch((e) => {
      host.warn(`charter_feedback_prompt_async_failed: ${e instanceof Error ? e.message : String(e)}`);
    });
  }
}

export function applyPostMessageDeliveryEffects(
  host: MessagingHost,
  panel: vscode.WebviewPanel,
  msg: BackendMessage,
): void {
  if (
    msg.type === 'stageStatusUpdate' &&
    msg.status === 'paused' &&
    !msg.isDecisionStage &&
    host.getInstance()
  ) {
    markStageArtifactsVerified(host.getInstance(), msg.stageId);
    emitStageArtifactHints(host, host.getInstance(), panel, msg.stageId, (m) => host.warn(m));
  }
}
