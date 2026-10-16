/**
 * 需求计划（规格 §4.4、§5.5、D28；tasks.md M4-4）。计划只决定下一个改动做什么，不改变"同一时间最多一个进行中改动"。
 *
 * - AI 只读分析需求、功能清单与系统地图，起草 2–8 个有序步骤（plan.drafted）；
 * - 你可以改标题、合并 / 拆分 / 删除 / 调整顺序，确认后写 plan.confirmed（确认动作，不需授权）；
 * - 你点「开始这一步」才以该步的 intent 创建改动（change.started.planId/stepId），之后走普通单改动流程；
 * - plan.revised 必填原因，已完成的步骤不能删除或改写；
 * - 同一时间最多一个进行中的计划。
 */
import { assertReason } from '../../ledger/ledger.js';
import type { PlanStep, Track } from '../../ledger/types.js';
import { recordMetric } from '../../metrics/metrics.js';
import { projectPlans, validateSteps, type PlanView, type PlansProjection } from '../../plans/plans.js';
import { renderSystemMap } from '../../docs/docs.js';
import { HttpError, newId, type StagentService } from '../service.js';
import { autoStart, callAgent, withAgentTask } from './agent-flow.js';
import { featureBriefs, liveMap, mapView } from './map-flow.js';

export async function plans(svc: StagentService): Promise<PlansProjection> {
  const snap = await svc.state();
  return projectPlans(snap.lines, snap.changes.changes);
}

export async function plan(svc: StagentService, planId: string): Promise<PlanView> {
  const p = (await plans(svc)).plans.find((x) => x.planId === planId);
  if (!p) throw new HttpError(404, `计划 ${planId} 不存在`);
  return p;
}

/** POST /api/plans：AI 起草计划。已有进行中计划时 409。 */
export async function draftPlan(svc: StagentService, body: { requirement?: unknown }): Promise<PlanView> {
  svc.assertWritable();
  const requirement = typeof body.requirement === 'string' ? body.requirement.trim() : '';
  if (!requirement) throw new HttpError(400, '请描述这个需求');
  const current = await plans(svc);
  if (current.active) throw new HttpError(409, `已有进行中的计划「${current.active.requirement}」，请先完成或取消`);
  const snap = await svc.state();
  const map = liveMap(snap.lines, snap.projection.features);
  const systemMap = renderSystemMap(await mapView(svc), snap.projection.features);
  const { result } = await withAgentTask(svc, { kind: 'plan', label: '起草需求计划', changeId: null }, (ctx) =>
    callAgent(svc, null, 'plan', ctx, (c) => svc.agent!.draftPlan({ requirement, features: featureBriefs(snap.projection.features, map), systemMap }, c)),
  );
  if (!result) throw new HttpError(502, 'Claude Code 没有给出计划');
  const live = new Set(snap.projection.features.map((f) => f.featureId));
  const steps = normalizeSteps(result.steps, live);
  const problems = validateSteps(steps);
  if (problems.length) throw new HttpError(502, `AI 起草的计划不合法：${problems.join('；')}`);
  const planId = newId('p');
  await svc.write(() => svc.ledger.append({ type: 'plan.drafted', planId, requirement, steps, rationale: result.rationale }));
  await recordMetric(svc.ledger.projectId, 'plan.created', { steps: steps.length });
  return plan(svc, planId);
}

/** POST /api/plans/:id/confirm：确认计划（可附修改后的步骤）。 */
export async function confirmPlan(svc: StagentService, planId: string, body: { steps?: unknown }): Promise<PlanView> {
  svc.assertWritable();
  const p = await plan(svc, planId);
  if (p.status !== 'draft') throw new HttpError(409, `计划已${p.statusLabel}`);
  const all = await plans(svc);
  if (all.active) throw new HttpError(409, `已有进行中的计划「${all.active.requirement}」`);
  const live = new Set((await svc.features()).map((f) => f.featureId));
  const steps = body.steps === undefined ? p.steps.map(stripView) : normalizeSteps(parseSteps(body.steps), live);
  const problems = validateSteps(steps);
  if (problems.length) throw new HttpError(400, problems.join('；'));
  await svc.write(() => svc.ledger.append({ type: 'plan.confirmed', planId, steps, by: 'user' }));
  return plan(svc, planId);
}

/** POST /api/plans/:id/revise：修订（必填原因）。已完成的步骤不能被删除或改写，只能追加或修改未开始的步骤。 */
export async function revisePlan(svc: StagentService, planId: string, body: { steps?: unknown; reason?: unknown }): Promise<PlanView> {
  svc.assertWritable();
  const p = await plan(svc, planId);
  if (p.status !== 'active') throw new HttpError(409, '只能修订进行中的计划');
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  try {
    assertReason(reason);
  } catch (err) {
    throw new HttpError(400, (err as Error).message);
  }
  const live = new Set((await svc.features()).map((f) => f.featureId));
  const steps = normalizeSteps(parseSteps(body.steps), live);
  const problems = validateSteps(steps);
  const byId = new Map(steps.map((s) => [s.stepId, s]));
  for (const s of p.steps) {
    if (s.status === 'waiting' || s.status === 'ready') continue;
    const next = byId.get(s.stepId);
    if (!next) problems.push(`「${s.title}」已经开始或完成，不能删除`);
    else if (s.status === 'done' && (next.title !== s.title || next.intent !== s.intent || next.track !== s.track)) {
      problems.push(`「${s.title}」已完成，不能改写`);
    }
  }
  if (problems.length) throw new HttpError(409, problems.join('；'));
  await svc.write(() => svc.ledger.append({ type: 'plan.revised', planId, steps, reason, by: 'user' }));
  return plan(svc, planId);
}

/** POST /api/plans/:id/close：关闭（completed：全部步骤已完成；cancelled：随时可以取消，不影响已合并的改动）。 */
export async function closePlan(svc: StagentService, planId: string, body: { outcome?: unknown; reason?: unknown }): Promise<PlanView> {
  svc.assertWritable();
  const p = await plan(svc, planId);
  if (p.status === 'completed' || p.status === 'cancelled') throw new HttpError(409, `计划已${p.statusLabel}`);
  const outcome = body.outcome === 'completed' ? 'completed' : body.outcome === 'cancelled' ? 'cancelled' : null;
  if (!outcome) throw new HttpError(400, 'outcome 必须是 completed 或 cancelled');
  if (outcome === 'completed' && p.steps.some((s) => s.status !== 'done')) throw new HttpError(409, '还有未完成的步骤，不能标为已完成（可以取消计划）');
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : undefined;
  await svc.write(() => svc.ledger.append({ type: 'plan.closed', planId, outcome, ...(reason ? { reason } : {}), by: 'user' }));
  return plan(svc, planId);
}

/** POST /api/plans/:id/steps/:stepId/start：开始这一步 → 以该步的 intent 创建改动。互斥规则不变（已有进行中改动时 409）。 */
export async function startStep(svc: StagentService, planId: string, stepId: string) {
  const p = await plan(svc, planId);
  if (p.status !== 'active') throw new HttpError(409, '计划还没有确认，或已经关闭');
  const s = p.steps.find((x) => x.stepId === stepId);
  if (!s) throw new HttpError(404, `步骤 ${stepId} 不存在`);
  if (s.status === 'waiting') throw new HttpError(409, `「${s.title}」还在等待前置步骤`);
  if (s.status === 'in_progress') throw new HttpError(409, `「${s.title}」已经在进行中`);
  if (s.status === 'done') throw new HttpError(409, `「${s.title}」已经完成`);
  const change = await svc.createChange({
    description: `${s.title}：${s.intent}`.slice(0, 400),
    track: s.track,
    planId,
    stepId,
    targetFeatureIds: s.featureIds ?? [],
  });
  await autoStart(svc, change);
  return svc.change(change.changeId);
}

function stripView(s: PlanView['steps'][number]): PlanStep {
  return { stepId: s.stepId, title: s.title, intent: s.intent, track: s.track, ...(s.featureIds ? { featureIds: s.featureIds } : {}), ...(s.dependsOn ? { dependsOn: s.dependsOn } : {}) };
}

function parseSteps(v: unknown): PlanStep[] {
  if (!Array.isArray(v)) throw new HttpError(400, '缺少 steps');
  return v.map((raw, i) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    return {
      stepId: typeof o.stepId === 'string' && o.stepId ? o.stepId : `s${i + 1}`,
      title: typeof o.title === 'string' ? o.title.trim() : '',
      intent: typeof o.intent === 'string' ? o.intent.trim() : '',
      track: (o.track === 'small' ? 'small' : 'feature') as Track,
      featureIds: Array.isArray(o.featureIds) ? o.featureIds.filter((x): x is string => typeof x === 'string') : [],
      dependsOn: Array.isArray(o.dependsOn) ? o.dependsOn.filter((x): x is string => typeof x === 'string') : [],
    };
  });
}

function normalizeSteps(steps: PlanStep[], live: ReadonlySet<string>): PlanStep[] {
  return steps.map((s) => ({ ...s, featureIds: (s.featureIds ?? []).filter((id) => live.has(id)), dependsOn: s.dependsOn ?? [] }));
}
