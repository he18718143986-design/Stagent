/**
 * 结论卡之外的首页信息：计划进度行（§11）、规则提案卡与偏离提示（§10）、记录卡数量、扫描进度（§9）。
 */
import type { ChangeView } from '../../changes/changes.js';
import type { LedgerLine } from '../../ledger/types.js';
import type { Overview, PlanLine } from '../../projection/overview.js';
import { projectPlans } from '../../plans/plans.js';
import { projectRecords } from '../../records/records.js';
import type { StagentService } from '../service.js';
import { currentDrift } from './records-flow.js';

export async function overviewExtras(
  svc: StagentService,
  input: { lines: readonly LedgerLine[]; changes: ChangeView[] },
): Promise<Pick<Overview, 'planLine' | 'ruleProposals' | 'recordDraftCount' | 'rulesDrift' | 'scan'>> {
  const plans = projectPlans(input.lines, input.changes);
  const p = plans.active;
  let planLine: PlanLine | null = null;
  if (p) {
    const current = p.steps.find((s) => s.status === 'in_progress') ?? p.steps.find((s) => s.status === 'ready' || s.status === 'redo');
    planLine = {
      planId: p.planId,
      title: p.requirement,
      current: current ? current.index + 1 : p.progress.done,
      total: p.progress.total,
      statusLabel: current ? current.statusLabel : '全部完成',
      allDone: p.progress.done === p.progress.total,
    };
  }
  const records = projectRecords(input.lines);
  return {
    planLine,
    ruleProposals: records.rules
      .filter((r) => r.status === 'proposed')
      .map((r) => ({ ruleId: r.ruleId, text: r.text, appliesWhen: r.appliesWhen, expiresWhen: r.expiresWhen, tags: r.tags })),
    recordDraftCount: svc.recordDrafts.length,
    rulesDrift: await currentDrift(svc, records),
    scan: svc.scan ? { running: svc.scan.running, found: svc.scan.found, error: svc.scan.error } : null,
  };
}
