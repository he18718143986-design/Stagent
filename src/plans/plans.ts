/**
 * 需求计划投影（规格 §4.4、§5.5、D28）。计划本身不产生任何证据，只负责组织和展示。
 *
 * 计划状态：草稿（plan.drafted）→ 进行中（plan.confirmed）→ 已完成 / 已取消（plan.closed）。
 * 步骤状态由关联的改动推导（change.started.planId / stepId）：
 *
 * | 条件                                        | 步骤状态 |
 * |---------------------------------------------|----------|
 * | 无关联改动，dependsOn 中有未完成步骤          | 等待前置 |
 * | 无关联改动，前置均已完成                      | 可开始   |
 * | 最近一个关联改动进行中                        | 进行中   |
 * | 最近一个关联改动已合并                        | 已完成   |
 * | 最近一个关联改动已放弃                        | 待重做   |
 */
import type { ChangeView } from '../changes/changes.js';
import type { IsoTime, LedgerLine, PlanStep } from '../ledger/types.js';

export type PlanStatus = 'draft' | 'active' | 'completed' | 'cancelled';
export type StepStatus = 'waiting' | 'ready' | 'in_progress' | 'done' | 'redo';

export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = { draft: '草稿', active: '进行中', completed: '已完成', cancelled: '已取消' };
export const STEP_STATUS_LABELS: Record<StepStatus, string> = {
  waiting: '等待前置',
  ready: '可开始',
  in_progress: '进行中',
  done: '已完成',
  redo: '待重做',
};

export interface StepView extends PlanStep {
  index: number;
  status: StepStatus;
  statusLabel: string;
  changeId: string | null;
  changePhaseLabel: string | null;
}

export interface PlanView {
  planId: string;
  requirement: string;
  rationale: string;
  status: PlanStatus;
  statusLabel: string;
  steps: StepView[];
  progress: { done: number; total: number };
  createdAt: IsoTime;
  closedReason?: string;
  revisions: { reason: string; at: IsoTime }[];
}

export interface PlansProjection {
  plans: PlanView[];
  /** 进行中的计划（同一时间最多一个）。 */
  active: PlanView | null;
}

export function projectPlans(lines: readonly LedgerLine[], changes: readonly ChangeView[]): PlansProjection {
  const plans = new Map<
    string,
    { requirement: string; rationale: string; steps: PlanStep[]; status: PlanStatus; at: IsoTime; closedReason?: string; revisions: { reason: string; at: IsoTime }[] }
  >();
  for (const { event: e, at } of lines) {
    if (e.type === 'plan.drafted') {
      plans.set(e.planId, { requirement: e.requirement, rationale: e.rationale ?? '', steps: e.steps, status: 'draft', at, revisions: [] });
    } else if (e.type === 'plan.confirmed') {
      const p = plans.get(e.planId);
      if (p) Object.assign(p, { steps: e.steps, status: 'active' as const });
    } else if (e.type === 'plan.revised') {
      const p = plans.get(e.planId);
      if (p) {
        p.steps = e.steps;
        p.revisions.push({ reason: e.reason, at });
      }
    } else if (e.type === 'plan.closed') {
      const p = plans.get(e.planId);
      if (p) {
        p.status = e.outcome;
        if (e.reason) p.closedReason = e.reason;
      }
    }
  }

  const views: PlanView[] = [];
  for (const [planId, p] of plans) {
    const linked = changes.filter((c) => c.planId === planId);
    const latest = new Map<string, ChangeView>();
    for (const c of linked) if (c.stepId) latest.set(c.stepId, c); // changes 按开始顺序排列，后者覆盖前者
    const doneIds = new Set([...latest.entries()].filter(([, c]) => c.phase === 'merged').map(([id]) => id));
    const steps = p.steps.map((s, index): StepView => {
      const c = latest.get(s.stepId) ?? null;
      const status: StepStatus = c
        ? c.phase === 'merged'
          ? 'done'
          : c.phase === 'abandoned'
            ? 'redo'
            : 'in_progress'
        : (s.dependsOn ?? []).some((d) => !doneIds.has(d))
          ? 'waiting'
          : 'ready';
      return { ...s, index, status, statusLabel: STEP_STATUS_LABELS[status], changeId: c?.changeId ?? null, changePhaseLabel: c?.phaseLabel ?? null };
    });
    views.push({
      planId,
      requirement: p.requirement,
      rationale: p.rationale,
      status: p.status,
      statusLabel: PLAN_STATUS_LABELS[p.status],
      steps,
      progress: { done: steps.filter((s) => s.status === 'done').length, total: steps.length },
      createdAt: p.at,
      ...(p.closedReason ? { closedReason: p.closedReason } : {}),
      revisions: p.revisions,
    });
  }
  return { plans: views, active: views.find((v) => v.status === 'active') ?? null };
}

/** 校验一组步骤：stepId 唯一、依赖指向存在的步骤、无环、1–12 步。返回问题列表（空为合法）。 */
export function validateSteps(steps: readonly PlanStep[]): string[] {
  const problems: string[] = [];
  if (steps.length === 0) problems.push('计划至少要有一步');
  if (steps.length > 12) problems.push('计划最多 12 步');
  const ids = new Set<string>();
  for (const s of steps) {
    if (!s.stepId || !s.title?.trim()) problems.push('每一步都要有 stepId 和标题');
    if (ids.has(s.stepId)) problems.push(`步骤 id 重复：${s.stepId}`);
    ids.add(s.stepId);
  }
  for (const s of steps) for (const d of s.dependsOn ?? []) if (!ids.has(d)) problems.push(`「${s.title}」依赖的步骤 ${d} 不存在`);
  const visiting = new Set<string>();
  const done = new Set<string>();
  const byId = new Map(steps.map((s) => [s.stepId, s]));
  const visit = (id: string): boolean => {
    if (done.has(id)) return false;
    if (visiting.has(id)) return true;
    visiting.add(id);
    const cyc = (byId.get(id)?.dependsOn ?? []).some(visit);
    visiting.delete(id);
    done.add(id);
    return cyc;
  };
  if (steps.some((s) => visit(s.stepId))) problems.push('步骤依赖有环');
  return problems;
}
