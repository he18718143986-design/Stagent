export type PauseMode = 'decision' | 'normal' | null;

export interface PauseUiState {
  showPauseBar: boolean;
  mode: PauseMode;
  enableRetry: boolean;
  enableApprove: boolean;
  enableApproveDecision: boolean;
}

export function getPauseUiState(
  currentPausedStageId: string | null,
  stageStatus: Record<string, string>,
  isDecisionStage: (stageId: string) => boolean,
): PauseUiState {
  if (!currentPausedStageId) {
    return {
      showPauseBar: false,
      mode: null,
      enableRetry: false,
      enableApprove: false,
      enableApproveDecision: false,
    };
  }

  const status = stageStatus[currentPausedStageId];
  if (status !== 'paused') {
    return {
      showPauseBar: false,
      mode: null,
      enableRetry: false,
      enableApprove: false,
      enableApproveDecision: false,
    };
  }

  if (isDecisionStage(currentPausedStageId)) {
    return {
      showPauseBar: true,
      mode: 'decision',
      enableRetry: true,
      enableApprove: false,
      enableApproveDecision: true,
    };
  }

  return {
    showPauseBar: true,
    mode: 'normal',
    enableRetry: true,
    enableApprove: true,
    enableApproveDecision: false,
  };
}
