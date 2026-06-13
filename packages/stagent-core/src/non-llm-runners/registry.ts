import { invariantViolation } from '../ErrorTypeUtils';
import type { NonLlmToolExecutionParams } from '../WorkflowExecutorTypes';
import { runCodeRunnerTool } from './code-runner';
import { runFileReadTool } from './file-read';
import { runFileWriteTool } from './file-write';

export type NonLlmToolHandler = (params: NonLlmToolExecutionParams) => Promise<boolean>;

const nonLlmToolRunnerRegistry: Record<string, NonLlmToolHandler> = {
  'file-write': runFileWriteTool,
  'file-read': runFileReadTool,
  'code-runner': runCodeRunnerTool,
  'user-prompt': async ({ stage }) => {
    throw invariantViolation(
      `工具 'user-prompt' 未实现（请改用 isDecisionStage / questionBefore / questionAfter 表达人工介入）：阶段 ${stage.id}`,
    );
  },
};

export async function executeNonLlmToolFromRegistry(params: NonLlmToolExecutionParams): Promise<boolean> {
  const handler = nonLlmToolRunnerRegistry[params.stage.tool ?? ''];
  if (!handler) {
    return false;
  }
  return handler(params);
}
