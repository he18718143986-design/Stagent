import { buildAdrContextForWorkspace } from './AdrPersistence';
import { DEBUG_EVENT_ADR_CONTEXT } from './DebugLogEvents';
import { WORKFLOW_LEVEL_STAGE_ID } from './workflow/WorkflowLevelIds';

export async function loadAdrContextForGeneration(
  taskWorkspaceAbs: string,
  enabled: boolean,
  degraded: (reason: string, context?: Record<string, unknown>) => void,
  debugLog: (stageId: string, event: string, attempt: number, payload?: unknown) => void,
): Promise<string> {
  if (!enabled) {
    return '';
  }
  try {
    const adrContext = await buildAdrContextForWorkspace(taskWorkspaceAbs);
    if (adrContext) {
      debugLog(WORKFLOW_LEVEL_STAGE_ID, DEBUG_EVENT_ADR_CONTEXT, 0, { chars: adrContext.length });
    }
    return adrContext;
  } catch (e) {
    degraded('adr_context_load_failed', {
      err: e instanceof Error ? e.message : String(e),
      taskWorkspaceAbs,
    });
    return '';
  }
}
