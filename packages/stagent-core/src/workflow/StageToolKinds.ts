export const STAGE_TOOL_LLM_TEXT = 'llm-text';
export const STAGE_TOOL_FILE_WRITE = 'file-write';
export const STAGE_TOOL_FILE_READ = 'file-read';
export const STAGE_TOOL_CODE_RUNNER = 'code-runner';

export function isLlmTextTool(tool: string): boolean {
  return tool === STAGE_TOOL_LLM_TEXT;
}

export function isFileWriteTool(tool: string): boolean {
  return tool === STAGE_TOOL_FILE_WRITE;
}

export function isFileReadTool(tool: string): boolean {
  return tool === STAGE_TOOL_FILE_READ;
}

export function isCodeRunnerTool(tool: string): boolean {
  return tool === STAGE_TOOL_CODE_RUNNER;
}

export function isDecisionLlmTextStage(stage: {
  isDecisionStage?: boolean;
  tool: string;
}): boolean {
  return stage.isDecisionStage === true && isLlmTextTool(stage.tool);
}

export function isNonDecisionLlmTextStage(stage: {
  isDecisionStage?: boolean;
  tool: string;
}): boolean {
  return stage.isDecisionStage !== true && isLlmTextTool(stage.tool);
}
