import type { WorkflowDefinition } from './WorkflowDefinition';
import { resolveGeneratedTaskType } from './TaskTypeResolution';
import { resolveReuseStrategyFromClarify } from './ReuseStrategy';
import { scanExistingTopLevelFiles } from './WorkflowPreGenerationCoordinator';
import type { GenerationContext } from './WorkflowGenerationContext';
import {
  POLISH_META_DRAFT_MAX,
  type GenerationRunnerHost,
  type RunWorkflowGenerationParams,
} from './WorkflowGenerationRunner';
import {
  DEBUG_EVENT_CLARIFY_REUSE_STRATEGY,
  DEBUG_EVENT_TASK_TYPE_RESOLVED,
} from './DebugLogEvents';
import { isWorkflowTemplate } from './path-router/WorkflowTemplateTypes';
import { WORKFLOW_LEVEL_STAGE_ID } from './workflow/WorkflowLevelIds';

export function applyGenerationMetadata(
  host: GenerationRunnerHost,
  ctx: GenerationContext,
  params: RunWorkflowGenerationParams,
  wf: WorkflowDefinition,
): WorkflowDefinition {
  const { userInput, taskType, polishContext, clarifyAnswers } = params;
  const { taskWorkspaceAbs } = ctx;

  const modelTaskType = wf.meta?.taskType;
  const effectiveType = resolveGeneratedTaskType(modelTaskType, taskType);
  host.debugLog(WORKFLOW_LEVEL_STAGE_ID, DEBUG_EVENT_TASK_TYPE_RESOLVED, 0, {
    uiTaskType: taskType,
    modelTaskType: modelTaskType ?? '(missing)',
    effectiveType,
  });
  const next = host.normalizeWorkflow(wf, userInput, effectiveType);
  const modelTemplate = wf.meta?.workflowTemplate?.trim();
  const workflowTemplate = isWorkflowTemplate(modelTemplate)
    ? modelTemplate
    : ctx.pathRouter.workflowTemplate;
  const isGreenfield = wf.meta?.isGreenfield ?? ctx.pathRouter.suggestedIsGreenfield;
  const skeletonVersion = wf.meta?.skeletonVersion?.trim();
  next.meta = {
    ...next.meta,
    taskType: effectiveType,
    taskWorkspacePath: taskWorkspaceAbs,
    workflowTemplate,
    isGreenfield,
    ...(skeletonVersion ? { skeletonVersion } : {}),
  };
  if (polishContext?.originalDraft?.trim() && polishContext.polishedAt) {
    next.meta = {
      ...next.meta,
      userInputPolish: {
        originalDraft: polishContext.originalDraft.trim().slice(0, POLISH_META_DRAFT_MAX),
        polishedAt: polishContext.polishedAt,
      },
    };
  }
  const reuseStrategy = resolveReuseStrategyFromClarify(clarifyAnswers?.q_files);
  const stackProfile = ctx.pathRouter.stackProfile;
  if (stackProfile === 'python') {
    next.globalConfig = {
      ...next.globalConfig,
      language: next.globalConfig?.language ?? 'python',
      stackProfile: 'python',
    };
  } else if (stackProfile === 'node') {
    next.globalConfig = { ...next.globalConfig, stackProfile: 'node' };
  }
  if (reuseStrategy !== 'regenerate') {
    const existingFiles = scanExistingTopLevelFiles(taskWorkspaceAbs);
    next.meta = {
      ...next.meta,
      reuseStrategy,
      ...(existingFiles.length > 0 ? { existingFiles } : {}),
    };
    host.debugLog(WORKFLOW_LEVEL_STAGE_ID, DEBUG_EVENT_CLARIFY_REUSE_STRATEGY, 0, {
      reuseStrategy,
      existingFiles: scanExistingTopLevelFiles(taskWorkspaceAbs).length,
    });
  }
  return next;
}

export type LlmLoopResult = {
  workflow: WorkflowDefinition;
  effectiveType: string;
  modelTaskType: string | undefined;
};

export function buildLlmLoopResult(
  wf: WorkflowDefinition,
  params: RunWorkflowGenerationParams,
): LlmLoopResult {
  return {
    workflow: wf,
    effectiveType: wf.meta?.taskType ?? params.taskType,
    modelTaskType: wf.meta?.taskType,
  };
}
