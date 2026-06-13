import type { WebviewPanel, ExtensionContext, WorkspaceConfiguration } from './platform/HostTypes';
import type { WorkflowDefinition } from './WorkflowDefinition';
import type { GenerationValidationOutcome } from './WorkflowGenerationOrchestrator';
import {
  postBlockedConfirmIfRenderable,
  type GenerationRunnerHost,
} from './WorkflowGenerationRunner';
import { ERROR_TYPE_INVARIANT_VIOLATION } from './errors/stageErrorBuilders';
import type { DecisionBoardPayload } from './decision-frontload/DecisionFrontloadTypes';
import type { HITLDecisionMode } from './AdaptiveHITLPolicy';
import type { TaskTypeClassificationInfo } from './TaskTypeResolution';

export function routeBlockedValidationOutcome(
  host: GenerationRunnerHost,
  panel: WebviewPanel,
  validation: Exclude<GenerationValidationOutcome, { kind: 'superseded' } | { kind: 'success' }>,
): boolean {
  if (validation.kind === 'validation-errors') {
    if (postBlockedConfirmIfRenderable(host, panel, validation.workflow, validation.errors)) {
      return true;
    }
    host.postMessage(panel, {
      type: 'workflowFailed',
      reason: validation.errors.join('; '),
      errorType: ERROR_TYPE_INVARIANT_VIOLATION,
    });
    return true;
  }
  if (validation.kind === 'rule20-blocked') {
    if (postBlockedConfirmIfRenderable(host, panel, validation.workflow, validation.blockReasons)) {
      return true;
    }
    host.postMessage(panel, {
      type: 'workflowFailed',
      reason: validation.blockReasons.join('; '),
      errorType: ERROR_TYPE_INVARIANT_VIOLATION,
    });
    return true;
  }
  if (validation.kind === 'plan-blocked') {
    if (
      postBlockedConfirmIfRenderable(
        host,
        panel,
        validation.workflow,
        validation.blockReasons,
        validation.structuralRepairs,
      )
    ) {
      return true;
    }
    host.postMessage(panel, {
      type: 'workflowFailed',
      reason: validation.blockReasons.join(' '),
      errorType: ERROR_TYPE_INVARIANT_VIOLATION,
    });
    return true;
  }
  return false;
}

export function emitSuccessfulWorkflowGenerated(
  host: GenerationRunnerHost,
  panel: WebviewPanel,
  finalWf: WorkflowDefinition,
  validation: Extract<GenerationValidationOutcome, { kind: 'success' }>,
  experienceReferencesUsed: number,
  profileFields: { settingsProfile: string; profileGateDiff: string[] },
  withSessionFields: (draftKey: string) => Record<string, unknown>,
  decisionFields?: {
    decisionBoard?: DecisionBoardPayload;
    decisionMode?: HITLDecisionMode;
    taskTypeClassification?: TaskTypeClassificationInfo;
  },
): void {
  const draftKey = host.finalizeDraftDefinition(finalWf);

  host.postMessage(panel, {
    type: 'workflowGenerated',
    workflow: finalWf,
    warnings: validation.warnings,
    warningsDisplay: validation.warningsDisplay,
    planSummary: validation.planSummary,
    stageSourceSummary: validation.stageSourceSummary,
    ...profileFields,
    ...(experienceReferencesUsed > 0 ? { experienceReferencesUsed } : {}),
    ...(validation.structuralRepairs.length > 0
      ? { structuralRepairs: validation.structuralRepairs }
      : {}),
    ...(draftKey ? withSessionFields(draftKey) : {}),
    ...(decisionFields?.decisionBoard ? { decisionBoard: decisionFields.decisionBoard } : {}),
    ...(decisionFields?.decisionMode ? { decisionMode: decisionFields.decisionMode } : {}),
    ...(decisionFields?.taskTypeClassification
      ? { taskTypeClassification: decisionFields.taskTypeClassification }
      : {}),
  });
}
