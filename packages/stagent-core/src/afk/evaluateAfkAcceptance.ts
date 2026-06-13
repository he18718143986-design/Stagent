import { computeCharterCoverageMetrics } from '../charter/CharterCoverageMetrics';
import { isVerificationStage } from '../quality-gates/verificationConfidence';
import {
  summarizeVerificationRuns,
  type VerificationRunRecord,
} from '../quality-gates/verificationFlaky';
import { SMOKE_RUN_STAGE_ID } from '../disk-bootstrap/smokeStage';
import { evaluateDefinitionOfDone } from '../dod/DefinitionOfDone';
import type { WorkflowInstance } from '../WorkflowDefinition';
import { RUNTIME_REPLAN_OUTPUT_KEY } from '../runtime-replan/constants';
import { readReplanLedger } from '../runtime-replan/types';
import { VERIFICATION_RUNS_OUTPUT_KEY } from '../WorkflowOutputKeys';

export interface AfkAcceptanceReport {
  passed: boolean;
  reasons: string[];
  verificationStages: number;
  stableVerificationPasses: number;
  flakyStages: string[];
  humanInterventions: number;
  /** 实例内自动 runtime-replan 插入次数（fix/gate/preflight 触发，非人工）。 */
  runtimeReplanCount: number;
  charterCoverageRate: number;
  dodConfigured: boolean;
  dodDeliverablesSatisfied: number;
  dodDeliverablesTotal: number;
}

function readVerificationRuns(outputs: Record<string, unknown>): VerificationRunRecord[] {
  const raw = outputs[VERIFICATION_RUNS_OUTPUT_KEY];
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(
    (r): r is VerificationRunRecord =>
      !!r &&
      typeof r === 'object' &&
      typeof (r as VerificationRunRecord).attempt === 'number' &&
      typeof (r as VerificationRunRecord).exitCode === 'number',
  );
}

export type AfkAcceptanceOptions = {
  workspaceRoot?: string;
};

/** B-R4：工作流完成后评估是否满足 AFK 端到端验收。 */
export function evaluateAfkAcceptance(
  instance: WorkflowInstance,
  options?: AfkAcceptanceOptions,
): AfkAcceptanceReport {
  const reasons: string[] = [];
  let verificationStages = 0;
  let stableVerificationPasses = 0;
  const flakyStages: string[] = [];

  for (let i = 0; i < instance.definition.stages.length; i++) {
    const stage = instance.definition.stages[i];
    const rt = instance.stageRuntimes[i];
    if (!stage || !rt || rt.status !== 'done' || !isVerificationStage(stage)) {
      continue;
    }
    verificationStages += 1;
    const runs = readVerificationRuns(rt.outputs);
    const summary = summarizeVerificationRuns(runs);
    if (summary.flaky) {
      flakyStages.push(stage.id);
      reasons.push(`验证阶段 ${stage.id} 检出 flaky（${summary.passCount}/${summary.totalRuns} 通过）`);
    } else if (summary.stable && summary.passCount > 0) {
      stableVerificationPasses += 1;
    } else if (runs.length === 0) {
      reasons.push(`验证阶段 ${stage.id} 缺少多跑记录（请开启 verification.flakyRerunCount）`);
    }
  }

  const coverage = computeCharterCoverageMetrics(instance);
  let humanInterventions = 0;
  let runtimeReplanCount = 0;
  for (const rt of instance.stageRuntimes) {
    if (!rt) {
      continue;
    }
    humanInterventions += rt.retryCount ?? 0;
    if (rt.decisionProvenance === 'human' || rt.decisionProvenance === 'escalated') {
      humanInterventions += 1;
    }
    const qa = rt.questionAnswers ?? rt.questionBeforeAnswers;
    if (qa && Object.keys(qa).length > 0) {
      humanInterventions += 1;
    }
    runtimeReplanCount += readReplanLedger(rt.outputs).attempts;
  }

  if (instance.status !== 'completed') {
    reasons.push('工作流未 completed');
  }
  if (verificationStages === 0) {
    reasons.push('无 test_run / smoke 验证阶段');
  }
  if (stableVerificationPasses < verificationStages) {
    reasons.push(
      `稳定验证 ${stableVerificationPasses}/${verificationStages}（须全部稳定通过且无 flaky）`,
    );
  }
  if (humanInterventions > 0) {
    reasons.push(`存在 ${humanInterventions} 次人工介入（重试/拍板/追问）`);
  }

  const smokeIdx = instance.definition.stages.findIndex((s) => s.id === SMOKE_RUN_STAGE_ID);
  const smokeDone =
    smokeIdx >= 0 && instance.stageRuntimes[smokeIdx]?.status === 'done';
  const dodEval = evaluateDefinitionOfDone({
    workspaceRoot: options?.workspaceRoot,
    smokeStageDone: smokeDone,
  });
  if (dodEval.configured) {
    reasons.push(...dodEval.reasons);
  }

  const dodOk =
    !dodEval.configured ||
    (dodEval.deliverablesSatisfied === dodEval.deliverablesTotal &&
      (!dodEval.smokeRequired || smokeDone));

  const passed =
    instance.status === 'completed' &&
    verificationStages > 0 &&
    stableVerificationPasses === verificationStages &&
    flakyStages.length === 0 &&
    humanInterventions === 0 &&
    dodOk;

  return {
    passed,
    reasons: passed ? ['AFK 端到端验收通过'] : reasons,
    verificationStages,
    stableVerificationPasses,
    flakyStages,
    humanInterventions,
    runtimeReplanCount,
    charterCoverageRate: coverage.coverageRate,
    dodConfigured: dodEval.configured,
    dodDeliverablesSatisfied: dodEval.deliverablesSatisfied,
    dodDeliverablesTotal: dodEval.deliverablesTotal,
  };
}
