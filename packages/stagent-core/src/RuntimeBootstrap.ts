import * as crypto from 'crypto';
import type { WebviewPanel } from './platform/HostTypes';
import type { BackendMessage, StageRuntime, WorkflowDefinition, WorkflowInstance } from './WorkflowDefinition';
import { canSwitchActiveInstance } from './ActiveInstanceGuard';
import type { StartExecutionHost } from './WorkflowStartCoordinator';
import { ERROR_TYPE_INVARIANT_VIOLATION } from './WorkflowStageErrorHelpers';
import { DEBUG_EVENT_RUN_START } from './DebugLogEvents';
import { WORKFLOW_LEVEL_STAGE_ID } from './workflow/WorkflowLevelIds';
import type { FrontloadDecisionResolution } from './decision-frontload/DecisionFrontloadTypes';
import { applyFrontloadDecisionsToRuntimes } from './decision-frontload/applyFrontloadDecisions';
import { pinTaskWorkspacePathAbsolute } from './WorkflowPathResolver';

export type RuntimeBootstrapResult =
  | { ok: false }
  | {
      ok: true;
      wf: WorkflowDefinition;
      instanceId: string;
      taskDir: string;
      reuse: boolean;
      existing?: WorkflowInstance;
    };

export function bootstrapWorkflowRuntime(
  host: StartExecutionHost,
  panel: WebviewPanel,
  wf: WorkflowDefinition,
  instanceKey?: string,
  frontloadResolutions?: FrontloadDecisionResolution[],
): RuntimeBootstrapResult {
  const { reuse, existing, instanceId } = host.resolveReuseInstance(
    instanceKey ?? host.getCurrentInstanceKey(),
  );

  if (instanceId !== host.getCurrentInstanceKey()) {
    const decision = canSwitchActiveInstance({
      currentKey: host.getCurrentInstanceKey(),
      targetKey: instanceId,
      executionDepth: host.getExecutionDepth(),
    });
    if (!decision.ok) {
      host.postMessage(panel, {
        type: 'instanceSwitchBlocked',
        reason: decision.reason,
        targetInstanceKey: instanceId,
        activeInstanceKey: host.getCurrentInstanceKey(),
      });
      return { ok: false };
    }
    if (host.getCurrentInstanceKey() && host.getInstance()) {
      host.clearSaveTimer();
      host.persistInstanceSnapshot(host.getCurrentInstanceKey()!, host.getInstance()!);
    }
  }

  host.setCurrentInstanceKey(instanceId);

  let taskDir: string;
  if (reuse && existing?.taskDir) {
    taskDir = existing.taskDir;
  } else {
    const taskDirRes = host.resolveInitialTaskDirForStart(instanceId, wf);
    if (!taskDirRes.ok) {
      host.postMessage(panel, {
        type: 'workflowFailed',
        reason: taskDirRes.reason,
        errorType: ERROR_TYPE_INVARIANT_VIOLATION,
      });
      return { ok: false };
    }
    taskDir = taskDirRes.dir;
  }

  const pinnedWorkspace = pinTaskWorkspacePathAbsolute(wf.meta?.taskWorkspacePath, taskDir);
  if (pinnedWorkspace) {
    wf = {
      ...wf,
      meta: { ...wf.meta, taskWorkspacePath: pinnedWorkspace },
    };
  }

  const runtimes: StageRuntime[] = wf.stages.map((s) => ({
    stageId: s.id,
    status: 'pending',
    outputs: {},
    retryCount: 0,
  }));

  const frontloadedStageIds =
    frontloadResolutions && frontloadResolutions.length > 0
      ? applyFrontloadDecisionsToRuntimes(runtimes, frontloadResolutions)
      : [];

  host.setInstance({
    traceId: existing?.traceId ?? `trace_${crypto.randomUUID()}`,
    definition: wf,
    currentStageIndex: 0,
    stageRuntimes: runtimes,
    status: 'running',
    taskDir,
    startedAt: new Date().toISOString(),
    ...(reuse && existing?.artifactRegistry?.length
      ? { artifactRegistry: existing.artifactRegistry }
      : {}),
  });
  host.clearExperiencePersistedFlag();
  host.debugLog(WORKFLOW_LEVEL_STAGE_ID, DEBUG_EVENT_RUN_START, 0, {
    workflowId: wf.id,
    stageCount: wf.stages.length,
    reusedInstance: reuse,
    reusedFromStatus: existing?.status,
    frontloadedDecisionStages: frontloadedStageIds,
  });

  for (const stageId of frontloadedStageIds) {
    host.postMessage(panel, { type: 'stageStatusUpdate', stageId, status: 'done' });
  }

  return { ok: true, wf, instanceId, taskDir, reuse, existing };
}
