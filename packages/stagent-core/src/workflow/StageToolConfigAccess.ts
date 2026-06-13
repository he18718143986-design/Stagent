import type { Stage } from '../WorkflowDefinition';
import { isCodeRunnerTool } from './StageToolKinds';

export function writeOutputToFileOf(stage: Stage): string {
  return String((stage.toolConfig as { writeOutputToFile?: string })?.writeOutputToFile ?? '').trim();
}

export function codeRunnerCommandOf(stage: Stage): string {
  if (!isCodeRunnerTool(stage.tool)) {
    return '';
  }
  return String((stage.toolConfig as { command?: string })?.command ?? '').trim();
}
