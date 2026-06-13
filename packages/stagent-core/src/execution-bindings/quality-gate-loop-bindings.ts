import type { ExecuteNextStageLoopParams } from './executor-loop-types';
import { getStagentConfiguration } from '../settings/getStagentConfiguration';
import { readEngineMemoryExperienceEnabled } from '../WorkflowEngineSettingsReaders';
import type { WorkflowEngineExecutionHost } from './types';
import { qualityGateSettingsReaders } from './quality-gate-settings';
import { DEBUG_EVENT_EXPERIENCE_READ_WARN } from '../DebugLogEvents';
import { WORKFLOW_LEVEL_STAGE_ID } from '../workflow/WorkflowLevelIds';

export function buildQualityGateLoopBindings(
  engine: WorkflowEngineExecutionHost,
): Pick<
  ExecuteNextStageLoopParams,
  | 'architectureDepthScoringEnabled'
  | 'testRunFailurePlaybookEnabled'
  | 'getWorkspaceRoot'
  | 'memoryExperienceEnabled'
  | 'warnOnExperienceReadFailure'
> {
  const cfg = getStagentConfiguration();
  const readers = qualityGateSettingsReaders;
  const e = engine;
  return {
    architectureDepthScoringEnabled: readers.readArchitectureDepthScoringEnabled(cfg),
    testRunFailurePlaybookEnabled: readers.readTestRunFailurePlaybookEnabled(cfg),
    getWorkspaceRoot: () => e.getWorkspaceRootAbsolute(),
    memoryExperienceEnabled: readEngineMemoryExperienceEnabled(),
    warnOnExperienceReadFailure: (message) =>
      e.debugLog(WORKFLOW_LEVEL_STAGE_ID, DEBUG_EVENT_EXPERIENCE_READ_WARN, 0, { message }),
  };
}
