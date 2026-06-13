import type { ManagedPromptSlotName } from './WorkflowPrompts';
import { loadManagedPromptSlots, resolveDefaultPromptVersionStorePath } from './PromptVersionManager';
import { DEBUG_EVENT_PROMPT_VERSIONS_LOADED } from './DebugLogEvents';
import { WORKFLOW_LEVEL_STAGE_ID } from './workflow/WorkflowLevelIds';

export function loadPromptSlotsForGeneration(
  taskWorkspaceAbs: string,
  enabled: boolean,
  debugLog: (stageId: string, event: string, attempt: number, payload?: unknown) => void,
): Partial<Record<ManagedPromptSlotName, string>> | undefined {
  if (!enabled) {
    return undefined;
  }
  const loaded = loadManagedPromptSlots(resolveDefaultPromptVersionStorePath(taskWorkspaceAbs));
  debugLog(WORKFLOW_LEVEL_STAGE_ID, DEBUG_EVENT_PROMPT_VERSIONS_LOADED, 0, {
    slots: Object.keys(loaded),
  });
  return loaded as Partial<Record<ManagedPromptSlotName, string>>;
}
