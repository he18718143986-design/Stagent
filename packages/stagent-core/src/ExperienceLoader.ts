import { buildExperienceFewShotForGenerator } from './ExperienceGeneratorContext';
import { resolveExperienceStorePath, WorkflowExperienceStore } from './WorkflowExperienceStore';
import { DEBUG_EVENT_EXPERIENCE_FEW_SHOT } from './DebugLogEvents';
import { WORKFLOW_LEVEL_STAGE_ID } from './workflow/WorkflowLevelIds';
import { EXPERIENCE_GEN_PICKED_MAX } from './UiListLimits';

export type ExperienceLoadResult = {
  experienceFewShot: string;
  experienceReferencesUsed: number;
};

export function loadExperienceForGeneration(
  taskWorkspaceAbs: string,
  taskType: string,
  enabled: boolean,
  debugLog: (stageId: string, event: string, attempt: number, payload?: unknown) => void,
): ExperienceLoadResult {
  if (!enabled) {
    return { experienceFewShot: '', experienceReferencesUsed: 0 };
  }
  const store = new WorkflowExperienceStore(resolveExperienceStorePath(taskWorkspaceAbs));
  const all = store.readAll();
  const experienceFewShot = buildExperienceFewShotForGenerator(all, {
    taskType,
    maxEntries: EXPERIENCE_GEN_PICKED_MAX,
  });
  let experienceReferencesUsed = 0;
  if (experienceFewShot) {
    experienceReferencesUsed = Math.min(all.length, EXPERIENCE_GEN_PICKED_MAX);
    debugLog(WORKFLOW_LEVEL_STAGE_ID, DEBUG_EVENT_EXPERIENCE_FEW_SHOT, 0, {
      chars: experienceFewShot.length,
      references: experienceReferencesUsed,
    });
  }
  return { experienceFewShot, experienceReferencesUsed };
}
