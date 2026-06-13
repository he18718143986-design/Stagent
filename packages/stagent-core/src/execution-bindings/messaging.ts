import type * as vscode from '../platform/HostTypes';
import { isCancellationError } from '../platform/cancellation';
import type { ExecuteNextStageLoopParams } from '../execution-bindings/executor-loop-types';
import { WorkflowParallelMonitor } from '../WorkflowParallelMonitor';
import type { ExecutionMessagingHost } from './types';
import { DEBUG_EVENT_LLM_OUTPUT_PREVIEW } from '../DebugLogEvents';

export function buildMessagingBindings(
  engine: ExecutionMessagingHost,
  targetPanel: vscode.WebviewPanel,
  parallelMonitor: WorkflowParallelMonitor,
): Pick<
  ExecuteNextStageLoopParams,
  | 'currentInstanceKey'
  | 'setCurrentInstanceKey'
  | 'postMessage'
  | 'scheduleSave'
  | 'persistMilestone'
  | 'warn'
  | 'debugLog'
  | 'debugLogLlmPreview'
  | 'logUserAction'
  | 'onDagParallelWaveStart'
  | 'onDagParallelWaveComplete'
  | 'isCancellationError'
> {
  const e = engine;
  return {
    currentInstanceKey: e.currentInstanceKey,
    setCurrentInstanceKey: (instanceKey) => {
      e.currentInstanceKey = instanceKey;
    },
    postMessage: (p, msg) => e.postMessage(p as vscode.WebviewPanel, msg),
    scheduleSave: () => e.scheduleSave(),
    persistMilestone: () => e.persistMilestone(),
    warn: (message) => (e.warn ? e.warn(message) : undefined),
    debugLog: (stageId, event, attempt, payload) => e.debugLog(stageId, event, attempt, payload),
    debugLogLlmPreview: (stageId, attempt, preview) => {
      if (e.isDebugVerbose()) {
        e.debugLog(stageId, DEBUG_EVENT_LLM_OUTPUT_PREVIEW, attempt, preview);
      }
    },
    logUserAction: (kind, detail) => e.logUserAction(kind, detail),
    onDagParallelWaveStart: (stageIds) => {
      const waveIndex = parallelMonitor.recordWaveStart(stageIds);
      e.postMessage(targetPanel, {
        type: 'dagWaveUpdate',
        waveIndex,
        activeStageIds: stageIds,
        phase: 'start',
      });
      return waveIndex;
    },
    onDagParallelWaveComplete: (waveIndex) => {
      parallelMonitor.recordWaveComplete(waveIndex);
      const payload = parallelMonitor.buildWaveDebugPayload(waveIndex);
      e.postMessage(targetPanel, {
        type: 'dagWaveUpdate',
        waveIndex,
        activeStageIds: [],
        phase: 'complete',
      });
      return payload;
    },
    isCancellationError: (error) => isCancellationError(error),
  };
}
