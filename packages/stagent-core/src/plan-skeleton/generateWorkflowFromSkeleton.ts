import type { WorkflowDefinition } from '../WorkflowDefinition';
import type { GenerationContext } from '../WorkflowGenerationContext';
import type { GenerationRunnerHost, RunWorkflowGenerationParams } from '../WorkflowGenerationRunner';
import { getStagentConfiguration } from '../settings/getStagentConfiguration';
import { DEBUG_EVENT_SKELETON_COMPILER_EXPAND } from '../DebugLogEvents';
import { WORKFLOW_LEVEL_STAGE_ID } from '../workflow/WorkflowLevelIds';
import { GENERATION_OPERATION_WORKFLOW } from '../generation/GenerationOperationIds';
import { detectMultiModuleLayout } from '../path-router/multiModuleLayoutDetect';
import { settingExplicitlyConfigured } from '../settings/readers/afk';
import { readConfigBoolean } from '../settings/readers/readConfigHelpers';
import { applySemanticFillToSkeleton } from './applySemanticFillToSkeleton';
import { sanitizeSemanticFillWorkflow } from './sanitizeSemanticFillPrompts';
import { expandGreenfieldPythonSkeleton } from './expandGreenfieldPythonSkeleton';
import { fillSkeletonStagePrompts } from './fillSkeletonStagePrompts';
import { shouldUseGreenfieldPythonSkeleton } from './shouldUseGreenfieldPythonSkeleton';

/** M5：未显式配置时 greenfield Python multi-module 默认开启 skeletonCompiler。 */
export function resolveSkeletonCompilerEnabledForGate(
  ctx: GenerationContext,
  params: RunWorkflowGenerationParams,
  cfg = getStagentConfiguration(),
): boolean {
  if (settingExplicitlyConfigured(cfg, 'contract.skeletonCompiler')) {
    return readConfigBoolean(cfg, 'contract.skeletonCompiler', false) === true;
  }
  const taskType = (params.taskType ?? '').trim().toLowerCase();
  if (taskType !== 'software' || ctx.pathRouter.workflowTemplate !== 'greenfield_full') {
    return false;
  }
  const lang = (ctx.pathRouter.stackProfile ?? '').toLowerCase();
  if (lang && lang !== 'python') {
    return false;
  }
  return detectMultiModuleLayout({ taskType, userInput: params.userInput });
}

export function resolveSkeletonCompilerGate(
  ctx: GenerationContext,
  params: RunWorkflowGenerationParams,
  cfg = getStagentConfiguration(),
): boolean {
  return shouldUseGreenfieldPythonSkeleton({
    workflowTemplate: ctx.pathRouter.workflowTemplate,
    taskType: params.taskType,
    userInput: params.userInput,
    skeletonCompilerEnabled: resolveSkeletonCompilerEnabledForGate(ctx, params, cfg),
    stackProfile: ctx.pathRouter.stackProfile,
    language: ctx.pathRouter.stackProfile,
  });
}

/**
 * 展开绿场 Python 骨架 DAG，跳过全量 LLM JSON 解析（PRD §8.4 / M4）。
 * 结构归一化与 plan preflight 仍在 {@link applyGenerationMetadata} / finalize 中完成。
 */
export async function generateWorkflowFromSkeleton(
  host: GenerationRunnerHost,
  ctx: GenerationContext,
  params: RunWorkflowGenerationParams,
): Promise<WorkflowDefinition> {
  const { panel, userInput, taskType } = params;

  host.postGenerationProgress(
    panel,
    GENERATION_OPERATION_WORKFLOW,
    'preparing',
    '骨架模板',
    '展开标准 multi-module DAG（跳过全量 JSON 生成）…',
  );

  const title =
    userInput
      .trim()
      .split(/\n/)[0]
      ?.slice(0, 80)
      .trim() || '生成的工作流';

  const expanded = expandGreenfieldPythonSkeleton({
    userInput,
    taskType,
    title,
    isGreenfield: ctx.pathRouter.suggestedIsGreenfield,
  });
  const { modules, skeletonVersion } = expanded;
  let workflow = expanded.workflow;

  const fill = await fillSkeletonStagePrompts(host, panel, {
    userInput,
    modules,
    stages: workflow.stages ?? [],
  });
  if (fill?.stagePrompts) {
    workflow = applySemanticFillToSkeleton(workflow, fill.stagePrompts);
    workflow = sanitizeSemanticFillWorkflow(workflow);
  }

  host.debugLog(WORKFLOW_LEVEL_STAGE_ID, DEBUG_EVENT_SKELETON_COMPILER_EXPAND, 0, {
    skeletonVersion,
    modules,
    workflowTemplate: ctx.pathRouter.workflowTemplate,
    stageCount: workflow.stages.length,
  });

  return workflow;
}
