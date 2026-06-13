import { evaluateAfkAcceptance } from '../afk/evaluateAfkAcceptance';
import { isVerificationStage } from '../quality-gates/verificationConfidence';
import {
  summarizeVerificationRuns,
  type VerificationRunRecord,
} from '../quality-gates/verificationFlaky';
import { readFixChainLedger } from '../runtime-replan/FixExhaustedRouter';
import { readReplanLedger } from '../runtime-replan/types';
import type { WorkflowInstance } from '../WorkflowDefinition';
import { VERIFICATION_RUNS_OUTPUT_KEY } from '../WorkflowOutputKeys';
import type { DiagnosticRoute } from '../diagnostic-router';
import type { QualityReportPayload, QualityReportVerificationRow } from './QualityReportTypes';

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

function buildEngineSummary(instance: WorkflowInstance): string {
  let replanCount = 0;
  let gateRepairCount = 0;
  let fixChainLoops = 0;
  for (const rt of instance.stageRuntimes) {
    if (!rt) {
      continue;
    }
    const ledger = readReplanLedger(rt.outputs);
    replanCount += ledger.attempts;
    if (ledger.lastTrigger === 'gate-repair-exhausted') {
      gateRepairCount += 1;
    }
    const fixAttempts = readFixChainLedger(rt.outputs).attempts;
    if (fixAttempts > 0) {
      fixChainLoops += fixAttempts;
    }
  }
  const parts: string[] = [];
  if (replanCount > 0) {
    parts.push(`runtime replan ${replanCount} 次`);
  }
  if (gateRepairCount > 0) {
    parts.push(`gate-repair 触发 replan ${gateRepairCount} 次`);
  }
  if (fixChainLoops > 0) {
    parts.push(`fix 链回绕 ${fixChainLoops} 次`);
  }
  return parts.length > 0 ? parts.join(' · ') : '无引擎自愈事件';
}

function collectDiagnosticRoutes(instance: WorkflowInstance): DiagnosticRoute[] {
  const routes: DiagnosticRoute[] = [];
  for (const rt of instance.stageRuntimes) {
    const raw = rt.outputs._diagnosticRoute;
    if (raw && typeof raw === 'object' && 'category' in raw && 'action' in raw) {
      routes.push(raw as DiagnosticRoute);
    }
  }
  return routes;
}

/** 从已完成实例构建屏 5 质量报告载荷。 */
export function buildQualityReportPayload(instance: WorkflowInstance): QualityReportPayload {
  const afk = evaluateAfkAcceptance(instance, { workspaceRoot: instance.taskDir });
  const verificationRows: QualityReportVerificationRow[] = [];

  for (let i = 0; i < instance.definition.stages.length; i++) {
    const stage = instance.definition.stages[i];
    const rt = instance.stageRuntimes[i];
    if (!stage || !rt || rt.status !== 'done' || !isVerificationStage(stage)) {
      continue;
    }
    const runs = readVerificationRuns(rt.outputs);
    const summary = summarizeVerificationRuns(runs);
    verificationRows.push({
      stageId: stage.id,
      passCount: summary.passCount,
      totalRuns: summary.totalRuns,
      stable: summary.stable,
      flaky: summary.flaky,
    });
  }

  const diagnosticRoutes = collectDiagnosticRoutes(instance);
  return {
    afk,
    verificationRows,
    engineSummary: buildEngineSummary(instance),
    ...(diagnosticRoutes.length > 0 ? { diagnosticRoutes } : {}),
  };
}
