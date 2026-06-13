import type { PanelHandlerMap } from './types';

export const executionHitlHandlers: PanelHandlerMap = {
  startExecution: async ({ engine, panel }, msg) => {
    if (msg.type !== 'startExecution') {
      return;
    }
    await engine.execution.startExecution(
      panel,
      msg.workflow,
      msg.sessionId ?? msg.instanceKey,
      msg.frontloadResolutions,
    );
  },
  approve: async ({ engine, panel }, msg) => {
    if (msg.type !== 'approve') {
      return;
    }
    await engine.hitl.approve(msg.stageId, panel);
  },
  approveDecision: async ({ engine, panel }, msg) => {
    if (msg.type !== 'approveDecision') {
      return;
    }
    await engine.hitl.approveDecision(
      msg.stageId,
      msg.decisionRecord,
      panel,
      msg.sessionId ?? msg.instanceKey,
    );
  },
  answerQuestionsBefore: async ({ engine, panel }, msg) => {
    if (msg.type !== 'answerQuestionsBefore') {
      return;
    }
    await engine.hitl.answerQuestionsBefore(msg.stageId, msg.answers, panel);
  },
  answerQuestions: async ({ engine, panel }, msg) => {
    if (msg.type !== 'answerQuestions') {
      return;
    }
    await engine.hitl.answerQuestions(msg.stageId, msg.answers, panel);
  },
  retry: async ({ engine, panel }, msg) => {
    if (msg.type !== 'retry') {
      return;
    }
    await engine.hitl.retry(msg.stageId, msg.comment, panel);
  },
};
