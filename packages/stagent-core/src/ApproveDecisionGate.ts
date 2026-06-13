import type { StageStatus } from './WorkflowDefinition';

export interface ApproveDecisionGateInput {
  hasInstance: boolean;
  stageFound: boolean;
  stageIndex: number;
  currentStageIndex: number;
  isDecisionStage: boolean;
  status: StageStatus;
}

/** 返回 null 表示可以继续批准；否则为应展示给用户的中文原因。 */
export function describeApproveDecisionRejection(input: ApproveDecisionGateInput): string | null {
  if (!input.hasInstance) {
    return '未绑定任务实例，请从侧栏重新打开该任务后再批准决策。';
  }
  if (!input.stageFound || input.stageIndex !== input.currentStageIndex) {
    return '当前阶段状态已变化，请从侧栏重新打开任务后再试。';
  }
  if (input.isDecisionStage !== true) {
    return '该阶段不是决策阶段，无法使用「批准此决策」。';
  }
  if (input.status === 'paused') {
    return null;
  }
  if (input.status === 'running' || input.status === 'retrying') {
    return '决策内容仍在生成中，请等待 AI 完成后再批准。';
  }
  if (input.status === 'done') {
    return '该决策已批准，无需重复操作。';
  }
  if (input.status === 'waiting-questions') {
    return '请先回答阶段追问后再批准决策。';
  }
  return `当前阶段状态为「${input.status}」，无法批准决策。`;
}
