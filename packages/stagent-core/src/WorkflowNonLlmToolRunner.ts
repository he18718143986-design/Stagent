import type { NonLlmToolExecutionParams } from './WorkflowExecutorTypes';
import { executeNonLlmToolFromRegistry } from './non-llm-runners/registry';

export {
  findFileWriteSourceRuntime,
  findStageRuntimeByOutputKey,
} from './non-llm-runners/helpers';

export async function executeNonLlmTool(params: NonLlmToolExecutionParams): Promise<boolean> {
  return executeNonLlmToolFromRegistry(params);
}
