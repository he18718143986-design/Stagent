import type { ToolPathBase } from '../../WorkflowDefinition';
import type { StageStepContext } from '../StageStepContext';
import { applyLlmPatchMode, writeLlmOutputToFile, type WriteLlmOutputOptions } from './writeOutput';

export async function persistLlmTextOutputs(
  ctx: StageStepContext,
  attempt: number,
  outKey: string,
  instanceKey: string,
  text: string,
  options?: WriteLlmOutputOptions,
): Promise<void> {
  const { stage } = ctx;
  const tc = stage.toolConfig as {
    type: 'llm-text';
    writeOutputToFile?: string;
    writePathBase?: ToolPathBase;
  };

  if (!stage.patchMode && tc.writeOutputToFile) {
    await writeLlmOutputToFile(ctx, attempt, outKey, instanceKey, tc, text, options);
  }
  if (stage.patchMode) {
    await applyLlmPatchMode(ctx, outKey, instanceKey, text);
  }
}
