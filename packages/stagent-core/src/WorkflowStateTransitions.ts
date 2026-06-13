import type {
  Stage,
  StageRuntime,
  StageStatus,
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowStatus,
} from './WorkflowDefinition';
import {
  appendDecisionProvenanceToRecord,
  formatDecisionProvenanceSection,
} from './charter/formatDecisionProvenanceSection';
import { collectTransitiveConsumerStageIds } from './WorkflowDag';
import { resetOutputsForNonDecisionRetry } from './RetryOutputPolicy';

export function markApproved(runtime: StageRuntime, nowIso: string): void {
  runtime.status = 'done';
  runtime.completedAt = nowIso;
}

export function markDecisionApproved(
  stage: Stage,
  runtime: StageRuntime,
  decisionRecord: string,
  primaryOutputValue: string,
  nowIso: string,
): string {
  const base = decisionRecord.trim() || primaryOutputValue;
  const provenance = runtime.decisionProvenance ?? 'human';
  const record = appendDecisionProvenanceToRecord(
    base,
    formatDecisionProvenanceSection({
      stageId: stage.id,
      provenance,
      perQuestion: runtime.charterQuestionProvenance,
    }),
  );
  runtime.outputs.decisionRecord = record;
  runtime.approvedDecisionRecord = record;
  runtime.status = 'done';
  runtime.completedAt = nowIso;
  return record;
}

export function applyQuestionBeforeAnswers(
  runtime: StageRuntime,
  answers: Record<string, string>,
): void {
  runtime.questionBeforeAnswers = { ...runtime.questionBeforeAnswers, ...answers };
  if (runtime.status === 'waiting-questions') {
    runtime.status = 'pending';
  }
}

export function applyRetryBase(runtime: StageRuntime, comment: string): void {
  runtime.retryComment = comment;
  runtime.retryCount += 1;
  runtime.startedAt = undefined;
  runtime.completedAt = undefined;
}

export function applyRetryForNonDecision(runtime: StageRuntime): void {
  runtime.outputs = resetOutputsForNonDecisionRetry(runtime.outputs);
  runtime.status = 'pending';
}

export function listDecisionRetryResetStageIds(
  definition: WorkflowDefinition,
  decisionStageId: string,
  decisionStageIndex: number,
): string[] {
  const resetStageIds: string[] = [];
  const useDagConsumers = definition.globalConfig?.enableDagScheduler === true;
  const dagConsumers = useDagConsumers ? new Set(collectTransitiveConsumerStageIds(definition, decisionStageId)) : null;

  definition.stages.forEach((s, i) => {
    if (i <= decisionStageIndex) {
      return;
    }
    const dependsRecord = s.input.sources.some(
      (src) =>
        src.type === 'stage-output' && src.stageId === decisionStageId && (src.outputKey ?? '') === 'decisionRecord',
    );
    const shouldReset = useDagConsumers ? dagConsumers!.has(s.id) : dependsRecord;
    if (shouldReset) {
      resetStageIds.push(s.id);
    }
  });

  return resetStageIds;
}

export function collectDecisionRetryResets(
  definition: WorkflowDefinition,
  instance: WorkflowInstance,
  decisionStageId: string,
  decisionStageIndex: number,
): { resetStageIds: string[]; resetStageTitles: string[] } {
  const resetStageIds: string[] = [];
  const resetStageTitles: string[] = [];

  const ids = listDecisionRetryResetStageIds(definition, decisionStageId, decisionStageIndex);
  for (const sid of ids) {
    const i = definition.stages.findIndex((s) => s.id === sid);
    if (i < 0) {
      continue;
    }
    instance.stageRuntimes[i].status = 'pending';
    instance.stageRuntimes[i].outputs = {};
    instance.stageRuntimes[i].startedAt = undefined;
    instance.stageRuntimes[i].completedAt = undefined;
    resetStageIds.push(sid);
    resetStageTitles.push(definition.stages[i].title);
  }

  return { resetStageIds, resetStageTitles };
}

export function applyRetryForDecisionCurrent(runtime: StageRuntime): void {
  runtime.approvedDecisionRecord = undefined;
  runtime.outputs.decisionRecord = undefined;
  runtime.outputs.decisionArtifacts = undefined;
  runtime.outputs.commitmentSnapshot = undefined;
  runtime.outputs._decisionArtifactsWarnings = undefined;
  runtime.status = 'retrying';
}

const LEGAL_STAGE_TRANSITIONS = new Map<StageStatus, ReadonlySet<StageStatus>>([
  ['pending', new Set<StageStatus>(['running', 'waiting-questions', 'skipped', 'done'])],
  ['running', new Set<StageStatus>(['paused', 'done', 'waiting-questions', 'error', 'pending'])],
  ['waiting-questions', new Set<StageStatus>(['pending', 'running'])],
  ['paused', new Set<StageStatus>(['done', 'retrying', 'pending', 'running'])],
  ['retrying', new Set<StageStatus>(['running', 'pending', 'error', 'paused'])],
  ['done', new Set<StageStatus>(['pending', 'retrying', 'paused', 'running'])],
  ['error', new Set<StageStatus>(['pending', 'running', 'retrying'])],
  ['skipped', new Set<StageStatus>(['pending'])],
]);

const LEGAL_INSTANCE_TRANSITIONS = new Map<WorkflowStatus, ReadonlySet<WorkflowStatus>>([
  ['idle', new Set<WorkflowStatus>(['running'])],
  ['running', new Set<WorkflowStatus>(['paused', 'completed', 'failed', 'idle'])],
  ['paused', new Set<WorkflowStatus>(['running', 'failed', 'idle'])],
  ['completed', new Set<WorkflowStatus>(['running', 'failed', 'idle'])],
  ['failed', new Set<WorkflowStatus>(['running', 'idle'])],
]);

function isLegalStageTransition(from: StageStatus, to: StageStatus): boolean {
  if (from === to) {
    return true;
  }
  return LEGAL_STAGE_TRANSITIONS.get(from)?.has(to) ?? false;
}

function isLegalInstanceTransition(from: WorkflowStatus, to: WorkflowStatus): boolean {
  if (from === to) {
    return true;
  }
  return LEGAL_INSTANCE_TRANSITIONS.get(from)?.has(to) ?? false;
}

export function guardedStageTransition(runtime: StageRuntime, to: StageStatus, _reason: string): void {
  runtime.status = to;
  if (to === 'done' || to === 'skipped') {
    delete runtime.lastError;
    delete runtime.lastFailureSnapshot;
  }
}

export function guardedInstanceTransition(instance: WorkflowInstance, to: WorkflowStatus, _reason: string): void {
  instance.status = to;
}

export function isAllowedStageTransition(from: StageStatus, to: StageStatus): boolean {
  return isLegalStageTransition(from, to);
}

export function isAllowedInstanceTransition(from: WorkflowStatus, to: WorkflowStatus): boolean {
  return isLegalInstanceTransition(from, to);
}
