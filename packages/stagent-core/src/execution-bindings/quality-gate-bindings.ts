import type { ExecuteNextStageLoopParams } from './executor-loop-types';
import type { WorkflowEngineExecutionHost } from './types';
import { buildQualityGateExecutionHost } from './quality-gate-host';
import { buildQualityGateHitlBindings } from './quality-gate-hitl-bindings';
import { buildQualityGateLoopBindings } from './quality-gate-loop-bindings';
import type * as vscode from '../platform/HostTypes';

export function buildQualityGateBindings(
  engine: WorkflowEngineExecutionHost,
  targetPanel: vscode.WebviewPanel,
): Pick<
  ExecuteNextStageLoopParams,
  | 'confidencePauseThreshold'
  | 'hitlPolicy'
  | 'qualityGateExecutionHost'
  | 'isAdaptiveGrillForStage'
  | 'tryGrillCodeExplore'
  | 'architectureDepthScoringEnabled'
  | 'testRunFailurePlaybookEnabled'
  | 'getWorkspaceRoot'
  | 'memoryExperienceEnabled'
  | 'warnOnExperienceReadFailure'
> {
  return {
    ...buildQualityGateHitlBindings(engine),
    ...buildQualityGateLoopBindings(engine),
    qualityGateExecutionHost: buildQualityGateExecutionHost(engine, targetPanel),
  };
}
