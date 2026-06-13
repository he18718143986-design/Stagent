export interface ConfirmPlanStage {
  id: string;
  title: string;
  tool: string;
  toolConfig?: Record<string, unknown>;
  pauseAfter?: boolean;
  isDecisionStage?: boolean;
  aiTip?: string;
}

export interface ConfirmStatsInput {
  taskType?: string;
  stageCount: number;
  decisionCount: number;
  implCount: number;
  testRunCount: number;
  pauseCount: number;
}
