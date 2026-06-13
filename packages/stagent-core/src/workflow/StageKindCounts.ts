import { isImplStageId, isTestRunStageId } from './StageIdPatterns';

export interface StageKindCountInput {
  id: string;
  isDecisionStage?: boolean;
  pauseAfter?: boolean;
}

export interface StageKindCounts {
  stageCount: number;
  decisionCount: number;
  implCount: number;
  testRunCount: number;
  pauseCount: number;
}

export function countStagesByKind(stages: StageKindCountInput[]): StageKindCounts {
  let decisionCount = 0;
  let implCount = 0;
  let testRunCount = 0;
  let pauseCount = 0;
  for (const s of stages) {
    if (s.isDecisionStage) {
      decisionCount += 1;
    }
    if (isImplStageId(s.id)) {
      implCount += 1;
    }
    if (isTestRunStageId(s.id)) {
      testRunCount += 1;
    }
    if (s.pauseAfter) {
      pauseCount += 1;
    }
  }
  return {
    stageCount: stages.length,
    decisionCount,
    implCount,
    testRunCount,
    pauseCount,
  };
}
