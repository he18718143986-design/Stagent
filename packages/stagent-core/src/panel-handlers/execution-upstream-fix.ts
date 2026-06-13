import type { PanelHandlerMap } from './types';

export const executionUpstreamFixHandlers: PanelHandlerMap = {
  upstreamFix: async ({ engine, panel }, msg) => {
    if (msg.type !== 'upstreamFix') {
      return;
    }
    await engine.hitl.upstreamFix(msg.failedStageId, panel);
  },
};
