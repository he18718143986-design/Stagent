/**
 * M41：生成后校验编排层 — 从 WorkflowEngine.generateWorkflow 抽出
 * Rule20 / 计划完整性 / warnings 组装链（零 Webview 副作用，可单测）。
 */
import {
  runPostParseValidationPipeline,
  type GenerationGateSettings,
  type GenerationValidationOutcome,
  type OrchestratePostParseValidationParams,
} from './PostParseValidationPipeline';

export type { GenerationGateSettings, GenerationValidationOutcome, OrchestratePostParseValidationParams };

export async function orchestratePostParseValidation(
  params: OrchestratePostParseValidationParams,
): Promise<GenerationValidationOutcome> {
  return runPostParseValidationPipeline(params);
}
