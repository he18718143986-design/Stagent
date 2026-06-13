import type { ExecuteNextStageLoopParams } from './executor-loop-types';
import { readGrillAdaptiveModeForStage } from '../GrillAdaptiveFlow';
import { buildHITLPolicy } from '../AdaptiveHITLPolicy';
import { getStagentConfiguration } from '../settings/getStagentConfiguration';
import { readCharterAutoAnswerMode } from '../settings/readers/charter';
import { readHitlDecisionMode } from '../settings/readers/hitl';
import { tryCharterAnswerForQuestion } from '../charter/CharterGrillRuntime';
import type { WorkflowEngineExecutionHost } from './types';
import { qualityGateSettingsReaders } from './quality-gate-settings';

export function buildQualityGateHitlBindings(
  engine: WorkflowEngineExecutionHost,
): Pick<
  ExecuteNextStageLoopParams,
  | 'confidencePauseThreshold'
  | 'hitlPolicy'
  | 'isAdaptiveGrillForStage'
  | 'tryGrillCodeExplore'
  | 'tryCharterGrillAutoAnswer'
> {
  const cfg = getStagentConfiguration();
  const readers = qualityGateSettingsReaders;
  const e = engine;
  return {
    confidencePauseThreshold: readers.readConfidencePauseThreshold(cfg),
    hitlPolicy: buildHITLPolicy({
      confidencePauseThreshold: readers.readConfidencePauseThreshold(cfg),
      contractNodePauseThreshold: readers.readContractNodePauseThreshold(cfg),
      pauseContractNodesBelowThreshold: readers.readPauseContractNodesEnabled(cfg),
      charterAutoAnswerMode: readCharterAutoAnswerMode(cfg),
      decisionMode: readHitlDecisionMode(cfg),
    }),
    isAdaptiveGrillForStage: (stage) => {
      if (!e.instance) {
        return false;
      }
      return readGrillAdaptiveModeForStage({
        cfg,
        isDecisionStage: !!stage.isDecisionStage,
        questionBefore: stage.questionBefore,
        workflow: e.instance.definition,
        stage,
      });
    },
    tryGrillCodeExplore: async () => undefined,
    tryCharterGrillAutoAnswer: (question) =>
      tryCharterAnswerForQuestion(question, e.getWorkspaceRootAbsolute()),
  };
}
