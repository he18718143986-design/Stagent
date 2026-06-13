export function shouldHideOutput(
  currentPausedStageId: string | null,
  stageStatus: Record<string, string>,
  isDecisionStage: (stageId: string) => boolean,
): boolean {
  if (!currentPausedStageId) {
    return false;
  }
  return isDecisionStage(currentPausedStageId) && stageStatus[currentPausedStageId] === 'paused';
}
