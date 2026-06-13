import * as vscode from 'vscode';
import { uiMsg } from '../l10n/uiStrings';
import { AUTO_TASK_TYPE } from '../TaskTypeResolution';
import { ERROR_TYPE_INVARIANT_VIOLATION } from '../WorkflowStageErrorHelpers';
import type { PanelHandlerMap } from './types';

export const generationHandlers: PanelHandlerMap = {
  polishUserTask: async ({ engine, panel }, msg) => {
    if (msg.type !== 'polishUserTask') {
      return;
    }
    const tw = typeof msg.taskWorkspacePath === 'string' ? msg.taskWorkspacePath.trim() : '';
    await engine.generation.polishUserTask(
      msg.draft,
      msg.taskType ?? AUTO_TASK_TYPE,
      panel,
      tw || undefined,
      msg.polishTier,
    );
  },
  clarifyStart: async ({ engine, panel }, msg) => {
    if (msg.type !== 'clarifyStart') {
      return;
    }
    const tw = msg.taskWorkspacePath;
    if (typeof tw !== 'string' || !tw.trim()) {
      void vscode.window.showErrorMessage(uiMsg('stagent.error.workspacePathRequired'));
      engine.postMessage(panel, {
        type: 'workflowFailed',
        reason: uiMsg('stagent.error.workspacePathRequired'),
        errorType: ERROR_TYPE_INVARIANT_VIOLATION,
      });
      return;
    }
    await engine.generation.generateClarifyQuestions(msg.userInput, msg.taskType ?? AUTO_TASK_TYPE, tw.trim(), panel);
  },
  generateWorkflow: async ({ engine, panel }, msg) => {
    if (msg.type !== 'generateWorkflow') {
      return;
    }
    const tw = msg.taskWorkspacePath;
    if (typeof tw !== 'string' || !tw.trim()) {
      void vscode.window.showErrorMessage(uiMsg('stagent.error.workspacePathRequired'));
      engine.postMessage(panel, {
        type: 'workflowFailed',
        reason: uiMsg('stagent.error.workspacePathRequired'),
        errorType: ERROR_TYPE_INVARIANT_VIOLATION,
      });
      return;
    }
    await engine.generation.generateWorkflow(
      msg.userInput,
      msg.taskType ?? AUTO_TASK_TYPE,
      panel,
      tw.trim(),
      msg.polishContext,
      msg.clarifyAnswers,
    );
  },
};
