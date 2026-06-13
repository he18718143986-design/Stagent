import {
  flattenGateMessages,
  getDefaultQualityGateRegistry,
  type QualityGateContext,
  type QualityGateRunOptions,
  type QualityGateRunSummary,
  type QualityGateWhen,
} from './QualityGate';

export async function runQualityGates(
  phase: QualityGateContext['phase'],
  ctx: QualityGateContext,
  options?: QualityGateRunOptions,
): Promise<QualityGateRunSummary> {
  return getDefaultQualityGateRegistry().run(phase, ctx, options);
}

/** 生成期：仅收集 warn/info（blocking 由 orchestrator 单独处理时可传 severities）。 */
export async function collectGenerateWarningMessages(
  ctx: QualityGateContext,
): Promise<string[]> {
  const summary = await runQualityGates('generate', ctx, {
    stopOnBlock: false,
    severities: ['warn', 'info'],
  });
  return flattenGateMessages(summary);
}

export type PreStageGateStepOutcome = 'continue' | 'failed' | 'halt';

export interface PreStageGateStepResult {
  outcome: PreStageGateStepOutcome;
  summary: QualityGateRunSummary;
}

export async function runPreStageQualityGates(
  ctx: QualityGateContext,
  when: QualityGateWhen,
): Promise<PreStageGateStepResult> {
  const summary = await runQualityGates('pre-stage', { ...ctx, when }, { when, stopOnBlock: true });
  if (summary.blocks.length > 0) {
    return { outcome: 'failed', summary };
  }
  return { outcome: 'continue', summary };
}

export async function runPostStageQualityGates(
  ctx: QualityGateContext,
): Promise<QualityGateRunSummary> {
  return runQualityGates('post-stage', ctx, { stopOnBlock: false, severities: ['warn', 'info'] });
}

export async function runWorkflowEndQualityGates(
  ctx: QualityGateContext,
): Promise<string[]> {
  const summary = await runQualityGates('workflow-end', ctx, {
    stopOnBlock: false,
    severities: ['warn', 'info'],
  });
  return flattenGateMessages(summary);
}
