import type { ExecuteNextStageLoopParams } from '../WorkflowExecutorTypes';
import { executeNextStageLoop as executeNextStageLoopModular } from '../WorkflowExecutorLoop';

export async function executeNextStageLoopBridged(params: ExecuteNextStageLoopParams): Promise<void> {
  return executeNextStageLoopModular(params);
}

/** 默认导出入口：模块化执行循环。 */
export async function executeNextStageLoop(params: ExecuteNextStageLoopParams): Promise<void> {
  return executeNextStageLoopBridged(params);
}
