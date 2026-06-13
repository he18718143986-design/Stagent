import type * as vscode from '../platform/HostTypes';
import { persistAdrOnDecisionApprove } from '../AdrPersistence';
import { readGlossaryEnabled } from '../StagentSettings';
import { getStagentConfiguration } from '../settings/getStagentConfiguration';
import type { Stage, StageRuntime } from '../WorkflowDefinition';
import { PRIMARY_DECISION_OUTPUT_KEY } from '../WorkflowOutputKeys';
import type { HitlCoordinatorHost } from './HitlCoordinatorHost';
import { DEBUG_EVENT_ADR_PERSISTED, DEBUG_EVENT_ADR_SKIPPED } from '../DebugLogEvents';

export function scheduleDecisionApprovePersistence(
  host: HitlCoordinatorHost,
  stage: Stage,
  rt: StageRuntime,
  decisionRecord: string,
): void {
  if (!readGlossaryEnabled(getStagentConfiguration())) {
    return;
  }
  const ws = host.getWorkspaceRootAbsolute();
  if (!ws) {
    return;
  }
  void persistAdrOnDecisionApprove(ws, {
    stageId: stage.id,
    stageTitle: stage.title,
    decisionRecord,
  })
    .then((result) => {
      if (result.written) {
        host.debugLog(stage.id, DEBUG_EVENT_ADR_PERSISTED, rt.retryCount + 1, { filePath: result.filePath });
      } else {
        host.debugLog(stage.id, DEBUG_EVENT_ADR_SKIPPED, rt.retryCount + 1, { reason: result.skipReason });
      }
    })
    .catch((e) => {
      host.warn(`adr_persist_failed stage=${stage.id} err=${e instanceof Error ? e.message : String(e)}`);
    });
}

export function ensureDecisionRecordOutput(
  host: HitlCoordinatorHost,
  rt: StageRuntime,
  stageId: string,
  decisionRecord: string,
): void {
  if (!Object.prototype.hasOwnProperty.call(rt.outputs, PRIMARY_DECISION_OUTPUT_KEY)) {
    host.warn(
      `I-7 防御性补写：approveDecision 后 outputs.${PRIMARY_DECISION_OUTPUT_KEY} 缺失 stageId=${stageId}`,
    );
    rt.outputs[PRIMARY_DECISION_OUTPUT_KEY] = decisionRecord;
  }
}
