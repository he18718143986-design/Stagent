import type { ExecuteNextStageLoopParams } from './WorkflowExecutorTypes';
import { resolveFirstExistingReadablePath } from './workflow/resolveReadablePath';
import { executeNextStageLoopDag } from './executor-loop/DagWaveScheduler';
import { executeNextStageLoopLinear } from './executor-loop/StageStepDriver';

export function resolveWorkspaceFirstReadablePath(
  instanceKey: string,
  relativePath: string,
  workspacePath: string | undefined,
  resolveTaskFilePath: (instanceKey: string, relativePath: string) => string,
): string {
  const roots = workspacePath ? [workspacePath] : [];
  return resolveFirstExistingReadablePath({
    relativePath,
    searchRoots: roots,
    fallbackAbsolute: resolveTaskFilePath(instanceKey, relativePath),
  });
}

export async function executeNextStageLoop(params: ExecuteNextStageLoopParams): Promise<void> {
  if (params.enableDagScheduler) {
    await executeNextStageLoopDag(params);
    return;
  }
  await executeNextStageLoopLinear(params);
}
