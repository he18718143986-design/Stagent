import type { WorkflowDefinition } from './WorkflowDefinition';
import { applyGenerationMetadata, buildLlmLoopResult, type LlmLoopResult } from './ApplyGenerationMetadata';
import type { GenerationContext } from './WorkflowGenerationContext';
import { runLlmParseRetryLoop } from './LlmParseRetryLoop';
import type { GenerationRunnerHost, RunWorkflowGenerationParams } from './WorkflowGenerationRunner';

export async function invokeWorkflowGenerationLlm(
  host: GenerationRunnerHost,
  ctx: GenerationContext,
  params: RunWorkflowGenerationParams,
): Promise<WorkflowDefinition> {
  const parsed = await runLlmParseRetryLoop(host, ctx, params);
  return applyGenerationMetadata(host, ctx, params, parsed);
}

export type { LlmLoopResult };

export async function invokeWorkflowGenerationLlmWithMeta(
  host: GenerationRunnerHost,
  ctx: GenerationContext,
  params: RunWorkflowGenerationParams,
): Promise<LlmLoopResult> {
  const wf = await invokeWorkflowGenerationLlm(host, ctx, params);
  return buildLlmLoopResult(wf, params);
}
