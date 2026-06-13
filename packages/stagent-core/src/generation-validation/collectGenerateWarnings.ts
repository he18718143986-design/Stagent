import { buildGeneratorWarnings } from '../Rule20RuntimeGate';
import {
  buildTaskTypeOverrideWarning,
  isAutoTaskType,
  isKnownTaskType,
} from '../TaskTypeResolution';
import { dependencyGraphToWarningLines } from '../DependencyGraphAnalyzer';
import { complexityEstimateToWarningLines } from '../WorkflowComplexityEstimator';
import { structuralRepairWarningLines, type StructuralRepairAction } from '../WorkflowStructuralRepair';
import { expressTemplateStageWarnings } from '../path-router/PathRouter';
import type { VerifyResult } from '../Rule20Verify';
import type { PipelineContext } from './types';

/** 生成期 warn 收集（不依赖 QualityGateRunner，波次 A 最小实现）。 */
export async function collectGenerateWarningMessages(
  ctx: PipelineContext & {
    wf: PipelineContext['wf'];
    structuralRepairs: StructuralRepairAction[];
    verifyResult: VerifyResult | undefined;
  },
): Promise<string[]> {
  const warnings = buildGeneratorWarnings({
    stageCount: ctx.wf.stages.length,
    maxStageWarn: ctx.maxStageWarn,
    verifyResult: ctx.verifyResult,
    enableRuntimeRule20Verify: ctx.runtimeRule20On,
  });
  const overrideWarn = buildTaskTypeOverrideWarning(
    ctx.uiTaskType,
    ctx.modelTaskType,
    ctx.effectiveType as import('../TaskTypeResolution').KnownTaskType,
  );
  if (overrideWarn) warnings.push(overrideWarn);
  if (isAutoTaskType(ctx.uiTaskType)) {
    if (!ctx.modelTaskType?.trim()) {
      warnings.push(`taskType:missing-meta:fallback-${ctx.effectiveType}`);
    } else if (!isKnownTaskType(ctx.modelTaskType)) {
      warnings.push(`taskType:invalid-meta:${ctx.modelTaskType}:using-${ctx.effectiveType}`);
    }
  }
  const template = ctx.wf.meta?.workflowTemplate;
  if (template) {
    warnings.push(
      ...expressTemplateStageWarnings(
        template as import('../path-router/WorkflowTemplateTypes').WorkflowTemplate,
        ctx.wf.stages.length,
      ),
    );
  }
  warnings.push(...dependencyGraphToWarningLines(ctx.depGraph));
  warnings.push(...complexityEstimateToWarningLines(ctx.complexity));
  warnings.push(...structuralRepairWarningLines(ctx.structuralRepairs));
  return warnings;
}
