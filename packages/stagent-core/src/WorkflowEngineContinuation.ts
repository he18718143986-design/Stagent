import type { BackendMessage } from './WorkflowDefinition';

/**
 * 用户从暂停态「放行」当前阶段后的共有衔接：通知 UI → 推进索引 → 持久化。
 * `decisionUiFlag === 'omit'` 与历史 `approve()` 一致：消息不带 `isDecisionStage` 字段。
 */
export function emitStageDoneAdvancePersist(params: {
  emit: (msg: BackendMessage) => void;
  stageId: string;
  decisionUiFlag: boolean | 'omit';
  bumpStageIndex: () => void;
  scheduleSave: () => void;
}): void {
  const msg: BackendMessage =
    params.decisionUiFlag === 'omit'
      ? { type: 'stageStatusUpdate', stageId: params.stageId, status: 'done' }
      : {
          type: 'stageStatusUpdate',
          stageId: params.stageId,
          status: 'done',
          isDecisionStage: params.decisionUiFlag,
        };
  params.emit(msg);
  params.bumpStageIndex();
  params.scheduleSave();
}
