import { markArtifactsVerifiedForStage } from '../ArtifactLifecycleManager';
import { collectStageArtifactHints } from '../ArtifactUiHints';
import {
  appendGlobalFailureJsonl,
  appendWorkflowFailureJsonl,
  buildWorkflowFailureRecord,
} from '../WorkflowFailureLog';
import {
  appendWorkflowExperience,
  buildWorkflowExperience,
  resolveExperienceStorePath,
} from '../WorkflowExperienceStore';
import { readMemoryExperienceStoreEnabled, readMemoryMaxExperienceEntries } from '../StagentSettings';
import { FEEDBACK_LAST_ASKED_KEY } from '../instance/StagentGlobalStateKeys';
import type { BackendMessage, ErrorType, WorkflowInstance } from '../WorkflowDefinition';
import type { PlatformAdapter } from '../platform/PlatformAdapter';
import type { CoreDebugLogApi } from './CoreDebugLog';

export interface CorePostMessageHandlerDeps {
  platform: PlatformAdapter;
  getInstance(): WorkflowInstance | undefined;
  getInstanceKey(): string | undefined;
  getExperiencePersistedForKey(): string | undefined;
  setExperiencePersistedForKey(key: string | undefined): void;
  warn(message: string): void;
  debug: Pick<CoreDebugLogApi, 'debugLog' | 'logUserAction'>;
}

export function createCorePostMessageHandler(deps: CorePostMessageHandlerDeps) {
  function markStageArtifactsVerified(stageId: string): void {
    const inst = deps.getInstance();
    if (!inst?.artifactRegistry) {
      return;
    }
    markArtifactsVerifiedForStage(inst.artifactRegistry, stageId);
  }

  function emitStageArtifactHints(stageId: string): void {
    const inst = deps.getInstance();
    if (!inst) {
      return;
    }
    const stage = inst.definition.stages.find((s) => s.id === stageId);
    if (!stage || stage.isDecisionStage) {
      return;
    }
    const artifacts = collectStageArtifactHints(inst.artifactRegistry, stage);
    if (artifacts.length === 0) {
      return;
    }
    deps.platform.ui.send({ type: 'stageArtifactHints', stageId, artifacts });
  }

  function debugStageErrorLine(msg: Extract<BackendMessage, { type: 'stageError' }>): void {
    const err = msg.error;
    const preview = err.length > 400 ? `${err.slice(0, 400)}…` : err;
    deps.debug.debugLog(msg.stageId, 'stage_error', 0, {
      errorType: msg.errorType,
      errorPreview: preview,
      hasRawOutput: Boolean(msg.rawOutput),
      hasStdout: Boolean(msg.stdout),
      hasStderr: Boolean(msg.stderr),
    });
  }

  function persistWorkflowExperience(
    completionStatus: 'completed' | 'failed',
    failure?: { stageId: string; errorType: ErrorType },
  ): void {
    const inst = deps.getInstance();
    if (!inst) {
      return;
    }
    const instanceKey = deps.getInstanceKey();
    if (!instanceKey || deps.getExperiencePersistedForKey() === instanceKey) {
      return;
    }
    const cfg = deps.platform.config;
    if (!readMemoryExperienceStoreEnabled(cfg)) {
      return;
    }
    const workspaceRoot = inst.definition.meta.taskWorkspacePath?.trim();
    if (!workspaceRoot) {
      return;
    }
    const maxEntries = readMemoryMaxExperienceEntries(cfg);
    const experience = buildWorkflowExperience(inst, {
      completionStatus,
      instanceKey,
      failureStageId: failure?.stageId,
      failureErrorType: failure?.errorType,
    });
    appendWorkflowExperience(
      resolveExperienceStorePath(workspaceRoot),
      experience,
      maxEntries,
      (m) => deps.warn(m),
    );
    deps.setExperiencePersistedForKey(instanceKey);
  }

  function maybePromptFeedback(): void {
    try {
      const formUrl = deps.platform.config.get<string>('feedback.formUrl', '').trim();
      if (!formUrl) {
        return;
      }
      const cooldownDays = Math.max(0, deps.platform.config.get<number>('feedback.cooldownDays', 7));
      const lastAsked = deps.platform.state.get<string>(FEEDBACK_LAST_ASKED_KEY);
      if (lastAsked) {
        const elapsedDays = (Date.now() - new Date(lastAsked).getTime()) / 86_400_000;
        if (Number.isFinite(elapsedDays) && elapsedDays < cooldownDays) {
          return;
        }
      }
      deps.platform.state.set(FEEDBACK_LAST_ASKED_KEY, new Date().toISOString());
      void deps.platform.notify
        .info('Stagent：工作流已完成，欢迎花 1 分钟反馈使用体验，帮助我们改进。', '填写反馈')
        .then((choice) => {
          if (choice === '填写反馈') {
            void deps.platform.shell.openExternal(formUrl);
          }
        });
    } catch (e) {
      deps.warn(`feedback_prompt_failed: ${String(e)}`);
    }
  }

  function handlePreSend(msg: BackendMessage): void {
    if (msg.type === 'stageError') {
      try {
        debugStageErrorLine(msg);
      } catch (e) {
        deps.warn(`stage_error debug log: ${String(e)}`);
      }
      try {
        const inst = deps.getInstance();
        if (inst?.taskDir) {
          const rec = buildWorkflowFailureRecord(inst, {
            stageId: msg.stageId,
            error: msg.error,
            errorType: msg.errorType,
          });
          if (rec) {
            appendWorkflowFailureJsonl(inst.taskDir, rec, (m) => deps.warn(m));
            appendGlobalFailureJsonl(deps.platform.paths.globalStorageDir(), rec, (m) => deps.warn(m));
          }
        }
      } catch (e) {
        deps.warn(`stageError failure-log: ${String(e)}`);
      }
      if (deps.getInstance()?.status === 'failed') {
        persistWorkflowExperience('failed', {
          stageId: msg.stageId,
          errorType: msg.errorType,
        });
      }
      try {
        deps.debug.logUserAction('stage_error', {
          stageId: msg.stageId,
          errorType: msg.errorType,
          errorPreview:
            typeof msg.error === 'string' && msg.error.length > 200
              ? `${msg.error.slice(0, 200)}…(+${msg.error.length - 200})`
              : msg.error,
        });
      } catch (e) {
        deps.warn(`stage_error user_action: ${String(e)}`);
      }
    }
    if (msg.type === 'workflowCompleted') {
      persistWorkflowExperience('completed');
      maybePromptFeedback();
    }
    if (
      msg.type === 'stageStatusUpdate' &&
      msg.status === 'paused' &&
      !msg.isDecisionStage &&
      deps.getInstance()
    ) {
      markStageArtifactsVerified(msg.stageId);
      emitStageArtifactHints(msg.stageId);
    }
  }

  return { handlePreSend };
}
