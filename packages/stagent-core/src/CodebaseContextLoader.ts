import type { CodebaseSnapshot } from './CodebaseContextProvider';
import { buildGeneratorCodebaseContextBlock } from './WorkflowGeneration';
import { HOST_INPUT_PAGE_BUSY_TITLES as INPUT_PAGE_BUSY_TITLES } from './WebviewInputGenerationUiHost';
import type { GenerationRunnerHost, RunWorkflowGenerationParams } from './WorkflowGenerationRunner';
import { ERROR_TYPE_INVARIANT_VIOLATION } from './errors/stageErrorBuilders';
import { DEBUG_EVENT_CODEBASE_SNAPSHOT } from './DebugLogEvents';
import { WORKFLOW_LEVEL_STAGE_ID } from './workflow/WorkflowLevelIds';
import { GENERATION_OPERATION_WORKFLOW } from './generation/GenerationOperationIds';

export type CodebaseContextLoadResult = {
  taskWorkspaceAbs: string;
  codebaseContext: string;
  codebaseSnapshot?: CodebaseSnapshot;
  complexity: ReturnType<typeof buildGeneratorCodebaseContextBlock>['complexity'];
  depGraph: ReturnType<typeof buildGeneratorCodebaseContextBlock>['depGraph'];
};

export function loadCodebaseContext(
  host: GenerationRunnerHost,
  params: RunWorkflowGenerationParams,
): CodebaseContextLoadResult | null {
  const { userInput, taskType, panel, taskWorkspacePathRaw, readCodebaseContextEnabled, readCodebaseContextMaxTokens } =
    params;

  const wsRes = host.resolveExistingDirectoryPath(taskWorkspacePathRaw);
  if (!wsRes.ok) {
    host.postMessage(panel, {
      type: 'workflowFailed',
      reason: wsRes.reason,
      errorType: ERROR_TYPE_INVARIANT_VIOLATION,
    });
    return null;
  }
  const taskWorkspaceAbs = wsRes.abs;

  host.ensurePreExecDraftShell({
    phase: 'generate',
    userInput,
    taskType,
    taskWorkspacePathRaw,
  });

  host.postGenerationProgress(
    panel,
    GENERATION_OPERATION_WORKFLOW,
    'preparing',
    INPUT_PAGE_BUSY_TITLES.workflowPreparing,
    '扫描代码库快照、依赖图、复杂度与经验库…',
  );

  const { codebaseContext, codebaseSnapshot, complexity, depGraph } = buildGeneratorCodebaseContextBlock({
    taskWorkspaceAbs,
    userInput,
    codebaseSnapshotEnabled: readCodebaseContextEnabled,
    codebaseContextMaxTokens: readCodebaseContextMaxTokens,
    onSnapshotDegraded: (info) => {
      host.debugLog(WORKFLOW_LEVEL_STAGE_ID, DEBUG_EVENT_CODEBASE_SNAPSHOT, 0, info);
    },
    onDegraded: (reason, context) => host.degraded(reason, context),
  });

  return { taskWorkspaceAbs, codebaseContext, codebaseSnapshot, complexity, depGraph };
}
