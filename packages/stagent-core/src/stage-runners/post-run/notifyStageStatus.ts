import type { Stage } from '../../WorkflowDefinition';
import type { ExecuteNextStageLoopParams } from '../../WorkflowExecutorTypes';
import { evaluateManualRetryLimit } from '../../ManualRetryLimit';
import { readMaxManualStageRetries } from '../../settings/readers/exec';
import { guardedStageTransition } from '../../WorkflowStateTransitions';
import { postEngineActivity } from '../../engine-activity/postEngineActivity';
import {
  happyPathEngineActivityKind,
  happyPathEngineActivityText,
} from '../../engine-activity/happyPathActivity';
import { logStageEndMeta } from './logStageEndMeta';

export interface StageStatusNotifyInput {
  params: ExecuteNextStageLoopParams;
  stage: Stage;
  runtime: import('../../WorkflowDefinition').StageRuntime;
  outKey: string;
  attempt: number;
  shouldPause: boolean;
}

export function notifyStageStatus(input: StageStatusNotifyInput): void {
  const { params, stage, runtime, outKey, attempt, shouldPause } = input;
  const { postMessage, panel } = params;

  guardedStageTransition(
    runtime,
    shouldPause ? 'paused' : 'done',
    shouldPause ? 'stage-pause-after' : 'stage-complete',
  );
  logStageEndMeta(params, stage, runtime, outKey, attempt, runtime.status);

  postMessage(panel, {
    type: 'stageOutputUpdate',
    stageId: stage.id,
    outputKey: outKey,
    content: runtime.outputs[outKey],
  });
  const retryDisabled =
    runtime.status === 'paused' &&
    !evaluateManualRetryLimit(runtime.retryCount, readMaxManualStageRetries()).allowed;
  postMessage(panel, {
    type: 'stageStatusUpdate',
    stageId: stage.id,
    status: runtime.status,
    isDecisionStage: stage.isDecisionStage,
    retryDisabled,
  });

  if (runtime.status === 'done') {
    postEngineActivity(postMessage, panel, {
      kind: happyPathEngineActivityKind(stage),
      stageId: stage.id,
      text: happyPathEngineActivityText(stage),
    });
  }

  if (runtime.status === 'paused' && stage.questionAfter?.length) {
    postMessage(panel, {
      type: 'stageQuestions',
      stageId: stage.id,
      questions: stage.questionAfter,
    });
  }
}

export function schedulePauseSave(params: ExecuteNextStageLoopParams): void {
  params.scheduleSave();
}
