import type * as vscode from '../platform/HostTypes';
import { applyQuestionAfterAnswers, shouldAutoAdvanceAfterAnswers } from '../QuestionAfterFlow';
import { emitStageDoneAdvancePersist } from '../WorkflowEngineContinuation';
import type { HitlCoordinatorHost } from './HitlCoordinatorHost';
import { advanceStageAfterHitl } from './advanceAfterHitl';
import { postHitlActionHint } from './postHitlStageError';
import { validateAnswersOrPostError } from './questionAnswerValidation';
import { withHitlStageBinding } from './withHitlStageBinding';

export async function handleAnswerQuestions(
  host: HitlCoordinatorHost,
  stageId: string,
  answers: Record<string, string>,
  panel: vscode.WebviewPanel,
): Promise<void> {
  await withHitlStageBinding(host, stageId, panel, async ({ instance, idx, stage, rt }) => {
    if (!shouldAutoAdvanceAfterAnswers(stage, rt, instance.currentStageIndex, idx)) {
      postHitlActionHint(
        host,
        panel,
        '答案已收到，但当前阶段无法自动推进（可能问题未答全或阶段状态不符）。请刷新任务面板后重试。',
        stageId,
      );
      return;
    }

    if (
      !validateAnswersOrPostError(host, panel, stageId, stage.questionAfter, answers, 'answer_questions_after_rejected')
    ) {
      return;
    }

    host.logUserAction('answer_questions_after', { stageId, answerKeys: Object.keys(answers) });
    applyQuestionAfterAnswers(rt, answers, new Date().toISOString());
    emitStageDoneAdvancePersist({
      emit: (msg) => host.postMessage(panel, msg),
      stageId,
      decisionUiFlag: !!stage.isDecisionStage,
      bumpStageIndex: () => host.bumpCurrentStageIndex(),
      scheduleSave: () => host.scheduleSave(),
    });
    await advanceStageAfterHitl(host, panel);
  });
}
