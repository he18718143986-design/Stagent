import {
  recordCharterQuestionProvenance,
  syncDecisionProvenanceFromGrill,
} from './charter/CharterGrillAutoAnswer';
import { buildStageQuestionsBeforePayload } from './charter/enrichQuestionsWithCharterSuggest';
import {
  hasCharterSuggestionsPendingConfirm,
  prefillQuestionBeforeFromCharter,
} from './charter/CharterGrillRuntime';
import {
  resolveAdaptiveGrillState,
  shouldEnterAdaptiveWaitingQuestions,
  shouldEnterBatchWaitingQuestions,
  shouldUseAdaptiveGrill,
} from './GrillAdaptiveFlow';
import type { Question, Stage, StageRuntime } from './WorkflowDefinition';
import type { ExecuteNextStageLoopParams, PanelLike, StageStepOutcome } from './WorkflowExecutorTypes';
import { DEBUG_EVENT_CHARTER_GRILL_AUTO_ANSWER } from './DebugLogEvents';
import { guardedStageTransition } from './WorkflowStateTransitions';

/** M23：questionBefore 批量或自适应单题 + code-explore 自答循环 */
export async function handleQuestionBeforeGate(
  params: ExecuteNextStageLoopParams,
  stage: Stage,
  runtime: StageRuntime,
  panel: PanelLike,
  postMessage: ExecuteNextStageLoopParams['postMessage'],
  scheduleSave: () => void,
): Promise<StageStepOutcome | null> {
  const questions = stage.questionBefore;
  if (!questions?.length) {
    return null;
  }

  prefillQuestionBeforeFromCharter({
    questions,
    answers: runtime.questionBeforeAnswers,
    runtime,
    workspaceRoot: params.getWorkspaceRoot?.(),
  });

  if (shouldUseAdaptiveGrill(params.isAdaptiveGrillForStage?.(stage) === true, questions)) {
    let round = runtime.grillRound ?? 0;
    for (let guard = 0; guard < 12; guard += 1) {
      const state = resolveAdaptiveGrillState({
        questions,
        answers: runtime.questionBeforeAnswers,
        round,
      });
      if (state.done) {
        runtime.grillRound = round;
        syncDecisionProvenanceFromGrill(runtime);
        return null;
      }
      if (state.action.kind === 'explore-code' && params.tryGrillCodeExplore) {
        const auto = await params.tryGrillCodeExplore(state.action.question);
        round += 1;
        runtime.grillRound = round;
        if (auto?.trim()) {
          runtime.questionBeforeAnswers = {
            ...(runtime.questionBeforeAnswers ?? {}),
            [state.action.question.id]: auto.trim(),
          };
          continue;
        }
      }
      if (
        state.questionToAsk &&
        tryApplyCharterGrillAnswer(params, stage, runtime, state.questionToAsk)
      ) {
        round += 1;
        runtime.grillRound = round;
        continue;
      }
      if (shouldEnterAdaptiveWaitingQuestions(state) && state.questionToAsk) {
        guardedStageTransition(runtime, 'waiting-questions', 'question-before-adaptive');
        runtime.grillRound = round;
        postMessage(panel, {
          type: 'stageStatusUpdate',
          stageId: stage.id,
          status: 'waiting-questions',
          isDecisionStage: stage.isDecisionStage,
        });
        postMessage(panel, {
          type: 'stageQuestionsBefore',
          ...buildStageQuestionsBeforePayload(
            stage,
            [state.questionToAsk],
            params.getWorkspaceRoot?.(),
          ),
        });
        scheduleSave();
        return 'halt';
      }
      round += 1;
      runtime.grillRound = round;
    }
    return null;
  }

  syncDecisionProvenanceFromGrill(runtime);

  const workspaceRoot = params.getWorkspaceRoot?.();
  const needsBatchQuestions =
    shouldEnterBatchWaitingQuestions(questions, runtime.questionBeforeAnswers) ||
    hasCharterSuggestionsPendingConfirm(questions, runtime.questionBeforeAnswers, workspaceRoot);

  if (needsBatchQuestions) {
    guardedStageTransition(runtime, 'waiting-questions', 'question-before-batch');
    postMessage(panel, {
      type: 'stageStatusUpdate',
      stageId: stage.id,
      status: 'waiting-questions',
      isDecisionStage: stage.isDecisionStage,
    });
    postMessage(panel, {
      type: 'stageQuestionsBefore',
      ...buildStageQuestionsBeforePayload(stage, stage.questionBefore ?? [], workspaceRoot),
    });
    scheduleSave();
    return 'halt';
  }
  return null;
}

function tryApplyCharterGrillAnswer(
  params: ExecuteNextStageLoopParams,
  stage: Stage,
  runtime: StageRuntime,
  question: Question,
): boolean {
  const tryCharter = params.tryCharterGrillAutoAnswer;
  if (!tryCharter) {
    return false;
  }
  const attempt = tryCharter(question);
  if (!attempt?.filled || !attempt.answer?.trim()) {
    if (attempt?.match) {
      params.debugLog(stage.id, DEBUG_EVENT_CHARTER_GRILL_AUTO_ANSWER, runtime.retryCount + 1, {
        questionId: question.id,
        filled: false,
        kind: attempt.match.kind,
        provenance: attempt.match.provenance,
      });
    }
    return false;
  }
  runtime.questionBeforeAnswers = {
    ...(runtime.questionBeforeAnswers ?? {}),
    [question.id]: attempt.answer.trim(),
  };
  recordCharterQuestionProvenance(runtime, question.id, attempt.match.provenance);
  syncDecisionProvenanceFromGrill(runtime);
  params.debugLog(stage.id, DEBUG_EVENT_CHARTER_GRILL_AUTO_ANSWER, runtime.retryCount + 1, {
    questionId: question.id,
    filled: true,
    provenance: attempt.match.provenance,
    ruleRefs: attempt.match.ruleRefs,
  });
  return true;
}

export const runStageQuestionBeforeGate = handleQuestionBeforeGate;
