import type { PanelHandlerMap } from './types';

export const artifactsHandlers: PanelHandlerMap = {
  copyDebugLog: async ({ engine }) => {
    await engine.artifacts.copyRecentDebugLog();
  },
  copySessionLog: async ({ engine }) => {
    await engine.artifacts.copyRecentSessionLog();
  },
  editOutput: ({ engine }, msg) => {
    if (msg.type !== 'editOutput') {
      return;
    }
    engine.hitl.editOutput(msg.stageId, msg.outputKey, msg.newContent);
  },
  openArtifactFile: async ({ engine }, msg) => {
    if (msg.type !== 'openArtifactFile') {
      return;
    }
    await engine.artifacts.openArtifactFile(msg.stageId, msg.filePath);
  },
  openArtifactDiff: async ({ engine }, msg) => {
    if (msg.type !== 'openArtifactDiff') {
      return;
    }
    await engine.artifacts.openArtifactDiff(msg.stageId, msg.filePath);
  },
};
