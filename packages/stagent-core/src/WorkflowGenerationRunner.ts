/**
 * M41：工作流生成流水线 — generateWorkflow 主体（LLM 获取/解析 + 校验结果分发）。
 */
import type { WebviewPanel, ExtensionContext, WorkspaceConfiguration } from './platform/HostTypes';
import type { WorkflowDefinition } from './WorkflowDefinition';
import { isRenderableWorkflowForConfirm } from './WorkflowEngineHelpers';
import { buildPlanSummary, buildStageSourceSummary } from './WorkflowPlanSummary';
import {
  structuralRepairWarningLines,
  type StructuralRepairAction,
} from './WorkflowStructuralRepair';
import { buildProfileGateDiff } from './StagentProfileDiff';
import { readSettingsProfileId } from './settings/SettingsReaders';
import { getStagentConfiguration } from './settings/getStagentConfiguration';
import { withSessionFields } from './InstanceSession';
import type { GenerationGateSettings } from './WorkflowGenerationOrchestrator';
import type { GenerationOperationId } from './generation/GenerationOperationIds';
import { buildGenerationContext } from './WorkflowGenerationContext';
import { runLlmParseRetryLoop } from './LlmParseRetryLoop';
import {
  generateWorkflowFromSkeleton,
  resolveSkeletonCompilerGate,
} from './plan-skeleton/generateWorkflowFromSkeleton';
import { applyGenerationMetadata, buildLlmLoopResult } from './ApplyGenerationMetadata';
import { finalizeAndEmitWorkflow } from './WorkflowGenerationFinalize';
import { routeBlockedValidationOutcome } from './ValidationResultRouter';
import { formatRule20ViolationsBlockReason, shouldBlockGenerateOnRule20Violations } from './GeneratedWorkflowGate';
import { verifyRule20 } from './Rule20Verify';
import { ERROR_TYPE_LLM_INVALID_OUTPUT } from './errors/stageErrorBuilders';
import { WORKFLOW_LEVEL_STAGE_ID } from './workflow/WorkflowLevelIds';
import type { LlmInvokeOpts } from './core/LlmInvokeOpts';

export const POLISH_META_DRAFT_MAX = 12_000;
export const MAX_WORKFLOW_GEN_ATTEMPTS = 2;

export interface GenerationRunnerHost {
  bindPanel(panel: WebviewPanel): void;
  postMessage(panel: WebviewPanel, msg: import('./WorkflowDefinition').BackendMessage): void;
  postGenerationProgress(
    panel: WebviewPanel,
    operation: GenerationOperationId,
    phase: 'preparing' | 'llm' | 'parsing' | 'validating',
    message: string,
    detail?: string,
  ): void;
  resolveExistingDirectoryPath(
    raw: string,
  ): { ok: true; abs: string } | { ok: false; reason: string };
  ensurePreExecDraftShell(opts: {
    phase: 'polish' | 'clarify' | 'generate';
    userInput?: string;
    taskType: string;
    taskWorkspacePathRaw?: string;
  }): string | undefined;
  finalizeDraftDefinition(wf: WorkflowDefinition): string | undefined;
  debugLog(stageId: string, event: string, attempt: number, payload?: unknown): void;
  warn(message: string): void;
  degraded(reason: string, context?: Record<string, unknown>): void;
  invokeLlmRaw(
    systemPrompt: string,
    userContent: string,
    panel: WebviewPanel,
    traceStageId: string,
    opts?: LlmInvokeOpts,
  ): Promise<string>;
  parseWorkflowJson(
    raw: string,
    panel: WebviewPanel,
    onAuxLlmOutput?: (text: string) => void,
    maxOutputTokens?: number,
  ): Promise<WorkflowDefinition>;
  normalizeWorkflow(wf: WorkflowDefinition, userInput: string, taskType: string): WorkflowDefinition;
  isGenerationSuperseded(myGen: number): boolean;
  isRuntimeRule20VerifyEnabled(): boolean;
  readGenerationGates(): GenerationGateSettings;
  getMaxStageWarn(): number;
}

function profileFieldsForWorkflowGenerated(): {
  settingsProfile: string;
  profileGateDiff: string[];
} {
  const cfg = getStagentConfiguration();
  const profileId = readSettingsProfileId(cfg);
  return {
    settingsProfile: profileId,
    profileGateDiff: buildProfileGateDiff(profileId),
  };
}

export function postBlockedConfirmIfRenderable(
  host: GenerationRunnerHost,
  panel: WebviewPanel,
  wf: WorkflowDefinition,
  blockReasons: string[],
  structuralRepairs?: StructuralRepairAction[],
): boolean {
  if (!isRenderableWorkflowForConfirm(wf)) {
    return false;
  }
  const draftKey = host.finalizeDraftDefinition(wf);
  const repairs = structuralRepairs ?? [];
  host.postMessage(panel, {
    type: 'workflowGenerated',
    workflow: wf,
    blocked: true,
    blockReasons,
    warnings: repairs.length > 0 ? structuralRepairWarningLines(repairs) : [],
    warningsDisplay: [],
    planSummary: buildPlanSummary(wf),
    stageSourceSummary: buildStageSourceSummary(wf),
    ...profileFieldsForWorkflowGenerated(),
    ...(repairs.length > 0 ? { structuralRepairs: repairs } : {}),
    ...withSessionFields(draftKey),
  });
  return true;
}

export interface RunWorkflowGenerationParams {
  myGen: number;
  userInput: string;
  taskType: string;
  panel: WebviewPanel;
  taskWorkspacePathRaw: string;
  polishContext?: { originalDraft: string; polishedAt: string };
  clarifyAnswers?: Record<string, string>;
  readCodebaseContextEnabled: boolean;
  readCodebaseContextMaxTokens: number;
  readPromptVersionsEnabled: boolean;
  readExperienceInjectOnGenerate: boolean;
  readGlossaryEnabled: boolean;
  /** 工作流 JSON 解析重试上限（含首次）；缺省回退 MAX_WORKFLOW_GEN_ATTEMPTS。 */
  maxParseAttempts?: number;
}

export async function runWorkflowGeneration(
  host: GenerationRunnerHost,
  params: RunWorkflowGenerationParams,
): Promise<void> {
  const { myGen, panel } = params;

  host.bindPanel(panel);
  const ctx = await buildGenerationContext(host, params);
  if (!ctx) {
    return;
  }

  try {
    const useSkeletonCompiler = resolveSkeletonCompilerGate(ctx, params);
    const parsed = useSkeletonCompiler
      ? await generateWorkflowFromSkeleton(host, ctx, params)
      : await runLlmParseRetryLoop(host, ctx, params);
    if (!useSkeletonCompiler && host.isRuntimeRule20VerifyEnabled()) {
      const verifyResult = verifyRule20(parsed, {
        horizontalTddFail: host.readGenerationGates().horizontalTddFail,
      });
      if (shouldBlockGenerateOnRule20Violations(verifyResult, true)) {
        routeBlockedValidationOutcome(host, panel, {
          kind: 'rule20-blocked',
          workflow: parsed,
          blockReasons: [formatRule20ViolationsBlockReason(verifyResult.violations)],
        });
        return;
      }
    }
    const workflow = applyGenerationMetadata(host, ctx, params, parsed);
    const { effectiveType, modelTaskType } = buildLlmLoopResult(workflow, params);
    await finalizeAndEmitWorkflow(host, ctx, params, workflow, effectiveType, modelTaskType);
  } catch (e) {
    if (host.isGenerationSuperseded(myGen)) {
      host.degraded('generation_superseded_swallow', {
        myGen,
        err: e instanceof Error ? e.message : String(e),
      });
      return;
    }
    const msg = e instanceof Error ? e.message : String(e);
    host.debugLog(WORKFLOW_LEVEL_STAGE_ID, 'gen_failed', 0, {
      reason: msg.slice(0, 500),
      errorType: ERROR_TYPE_LLM_INVALID_OUTPUT,
    });
    host.postMessage(panel, {
      type: 'workflowFailed',
      reason: msg,
      errorType: ERROR_TYPE_LLM_INVALID_OUTPUT,
    });
  }
}
