import type { Question, Stage, WorkflowDefinition } from './WorkflowDefinition';
import { getMissingRequiredQuestionIds } from './QuestionBeforeFlow';
import { isContractNode } from './HITLContractNodePolicy';
import { estimateWorkflowComplexity } from './WorkflowComplexityEstimator';
import {
  DEFAULT_MAX_GRILL_ROUNDS,
  nextGrillAction,
  type GrillAction,
} from './GrillLoopPolicy';
import type { WorkspaceConfiguration } from './platform/HostTypes';

/**
 * M23-F1：自适应 grill 引擎接线辅助（`stagent.grill.adaptiveMode`）。
 * 与批量 questionBefore 并存：开启时逐题推进，关闭时保持 M7 批量表单。
 */

export interface AdaptiveGrillState {
  round: number;
  action: GrillAction;
  /** 当前轮应向 Webview 展示的问题（单题）；explore-code 失败回落时也仅展示该题 */
  questionToAsk?: Question;
  done: boolean;
}

export function shouldUseAdaptiveGrill(adaptiveEnabled: boolean, questions: Question[] | undefined): boolean {
  return adaptiveEnabled && (questions?.length ?? 0) > 0;
}

export function resolveAdaptiveGrillState(input: {
  questions: Question[] | undefined;
  answers: Record<string, string> | undefined;
  round: number;
  maxRounds?: number;
}): AdaptiveGrillState {
  const action = nextGrillAction(input);
  if (action.kind === 'done' || action.kind === 'max-rounds-reached') {
    return { round: input.round, action, done: true };
  }
  if (action.kind === 'ask') {
    return { round: input.round, action, questionToAsk: action.question, done: false };
  }
  return { round: input.round, action, questionToAsk: action.question, done: false };
}

/** adaptive 模式下是否仍需进入 waiting-questions（单题） */
export function shouldEnterAdaptiveWaitingQuestions(state: AdaptiveGrillState): boolean {
  return !state.done && !!state.questionToAsk;
}

/** 非 adaptive：沿用 M7 批量必答检测 */
export function shouldEnterBatchWaitingQuestions(
  questions: Question[] | undefined,
  answers: Record<string, string> | undefined,
): boolean {
  return getMissingRequiredQuestionIds(questions, answers).length > 0;
}

export function defaultGrillMaxRounds(): number {
  return DEFAULT_MAX_GRILL_ROUNDS;
}

/** M23：按阶段决定是否 adaptive grill（显式 adaptiveMode 优先；否则决策+启发式） */
export function readGrillAdaptiveModeForStage(input: {
  cfg: WorkspaceConfiguration;
  isDecisionStage: boolean;
  questionBefore: Question[] | undefined;
  workflow: WorkflowDefinition;
  stage: Stage;
}): boolean {
  try {
    const c = input.cfg;
    const explicit = c.get<boolean | undefined>('grill.adaptiveMode');
    if (explicit === true) {
      return true;
    }
    if (explicit === false) {
      return false;
    }
    if (c.get<boolean>('grill.autoOnDecisionStages') === false) {
      return false;
    }
    if (!input.isDecisionStage || !(input.questionBefore?.length ?? 0)) {
      return false;
    }
    if (isContractNode(input.workflow, input.stage)) {
      return true;
    }
    const userInput = input.workflow.meta?.userInput ?? '';
    const est = estimateWorkflowComplexity(userInput);
    return (
      est.requiresGlobalArchitectureDecision ||
      est.estimatedImplModules >= 3 ||
      est.highHitlLikely
    );
  } catch {
    return false;
  }
}
