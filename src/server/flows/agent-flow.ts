/**
 * 驱动 Claude Code（规格 §5.1、§5.2、§8，tasks.md M3-1）。
 *
 * - 同一时间最多一个 AI 任务；Claude Code 未安装 / 未登录、费用达到上限时拒绝并写明原因；
 * - 实现 → 回报（claim.reported，仅声称）→ 系统全量回归 → 被阻止时自动修复，最多 3 轮，之后停下等你；
 * - 每次调用的用量写入 ~/.stagent/projects/<id>/usage.jsonl，达到 config.budget 上限时暂停，等你授权 budget_raise；
 * - 实现 / 修复进行中会在 .stagent/runs/agent-task.json 留一个标记：服务重启时据此写 change.interrupted，
 *   你可以续接会话（SDK 支持 resume）、重新发起或放弃。
 *
 * Invariant 1：本模块只写 claim.reported，所有"已验证"都只能来自执行器的 run.completed。
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { remainingBudget } from '../../agent/usage.js';
import type { AgentContext, AgentOutcome, AgentUsage, ClaimReport, LockedExampleBrief } from '../../agent/types.js';
import { AgentRunError } from '../../agent/claude-code.js';
import type { ChangeView } from '../../changes/changes.js';
import { RUNS_RELATIVE_DIR } from '../../executor/executor.js';
import { filesOfFeature } from '../../map/map.js';
import { recordMetric } from '../../metrics/metrics.js';
import { projectRecords } from '../../records/records.js';
import { HttpError, type AgentTaskView, type StagentService } from '../service.js';
import { failureContext, featureBriefs, liveMap } from './map-flow.js';

export const MAX_AUTO_FIX_ROUNDS = 3;
const MARKER = join(RUNS_RELATIVE_DIR, 'agent-task.json');

export async function recordAgentUsage(svc: StagentService, changeId: string | null, task: string, usage: AgentUsage | null): Promise<void> {
  if (!usage) return;
  await svc
    .usageStore()
    .record({ ...usage, at: new Date().toISOString(), changeId, task })
    .catch(() => undefined);
}

/** 开始 AI 任务前的检查：可用、空闲、未超预算。 */
async function assertCanStart(svc: StagentService, changeId: string | null): Promise<void> {
  svc.assertWritable();
  if (!svc.agent) throw new HttpError(503, '没有接入 AI 执行器');
  const avail = await svc.agentAvailability();
  if (!avail.available) throw new HttpError(503, `${avail.reason ?? 'Claude Code 不可用'}${avail.hint ? `（${avail.hint}）` : ''}`);
  if (svc.agentTask) throw new HttpError(409, `Claude Code 正在${svc.agentTask.label}，结束后再试`);
  const budget = await svc.budget(changeId);
  if (budget.exceeded) {
    throw new HttpError(402, `费用达到上限（$${budget.exceeded.spent.toFixed(2)} / $${budget.exceeded.limit.toFixed(2)}），请先授权提高上限`);
  }
}

function makeContext(svc: StagentService, task: AgentTaskView & { controller: AbortController }, extra: Partial<AgentContext> = {}): AgentContext {
  let lastPublish = 0;
  return {
    projectRoot: svc.root,
    signal: task.controller.signal,
    onProgress: (p) => {
      task.line = p.line;
      if (p.log) task.log.push(p.log.slice(0, 2000));
      if (task.log.length > 400) task.log.splice(0, task.log.length - 400);
      const now = Date.now();
      if (now - lastPublish > 250) {
        lastPublish = now;
        svc.bus.publish('agent.progress', { kind: task.kind, line: task.line, changeId: task.changeId });
      }
    },
    onSession: (sessionId) => {
      task.sessionId = sessionId;
      if (task.kind === 'draft' || task.kind === 'rewrite' || task.kind === 'baseline') svc.draftingSessions.add(sessionId);
      if (task.kind === 'implement' || task.kind === 'fix') void writeMarker(svc, task);
    },
    ...extra,
  };
}

/**
 * 占用 AI 任务槽执行 fn（可同步等待，也可在后台跑）。用量、错误、SSE 通知统一在这里处理。
 */
export async function withAgentTask<T>(
  svc: StagentService,
  spec: { kind: AgentTaskView['kind']; label: string; changeId: string | null },
  fn: (ctx: AgentContext, task: AgentTaskView & { controller: AbortController }) => Promise<T>,
  opts: { background?: boolean; skipChecks?: boolean } = {},
): Promise<{ promise: Promise<T | undefined>; result?: T }> {
  if (!opts.skipChecks) await assertCanStart(svc, spec.changeId);
  else if (svc.agentTask) throw new HttpError(409, `Claude Code 正在${svc.agentTask.label}，结束后再试`);
  const controller = new AbortController();
  const task = {
    ...spec,
    line: `准备${spec.label}…`,
    log: [] as string[],
    startedAt: new Date().toISOString(),
    sessionId: null as string | null,
    controller,
    promise: Promise.resolve(),
  };
  svc.agentTask = task;
  svc.agentError = null;
  svc.bus.publish('agent.started', { kind: spec.kind, changeId: spec.changeId });
  const run = (async () => {
    try {
      return await fn(makeContext(svc, task), task);
    } catch (err) {
      if (err instanceof AgentRunError) await recordAgentUsage(svc, spec.changeId, spec.kind, err.usage);
      const msg = controller.signal.aborted ? `已停止 Claude Code（${spec.label}）` : (err as Error).message;
      svc.agentError = msg;
      svc.bus.publish('agent.failed', { kind: spec.kind, message: msg });
      if (!opts.background) throw err instanceof HttpError ? err : new HttpError(502, msg);
      return undefined;
    } finally {
      if (task.sessionId) svc.draftingSessions.delete(task.sessionId);
      if (svc.agentTask === task) svc.agentTask = null;
      await clearMarker(svc);
      svc.bus.publish('agent.finished', { kind: spec.kind, changeId: spec.changeId });
    }
  })();
  task.promise = run.then(
    () => undefined,
    () => undefined,
  );
  if (opts.background) return { promise: run };
  const result = await run;
  return { promise: Promise.resolve(result), ...(result !== undefined ? { result } : {}) };
}

/** 单次调用 + 记用量 + 预算剩余额度。 */
export async function callAgent<T>(
  svc: StagentService,
  changeId: string | null,
  kind: string,
  ctx: AgentContext,
  fn: (ctx: AgentContext) => Promise<AgentOutcome<T>>,
): Promise<T> {
  const budget = await svc.budget(changeId);
  if (budget.exceeded) throw new HttpError(402, '费用达到上限，Claude Code 已暂停');
  const max = remainingBudget(budget);
  const outcome = await fn({ ...ctx, ...(max !== undefined ? { maxBudgetUsd: max } : {}) });
  await recordAgentUsage(svc, changeId, kind, outcome.usage);
  return outcome.value;
}

export function cancelAgent(svc: StagentService): void {
  if (!svc.agentTask) throw new HttpError(409, 'Claude Code 当前没有在运行');
  svc.agentTask.controller.abort();
}

// ---- 实现与修复循环 ----

/** 锁定例子的原文（给实现 / 修复提示）。新功能档只给本改动的例子，小改动给全部（全量回归）。 */
async function implementInput(svc: StagentService, change: ChangeView) {
  const snap = await svc.state();
  const map = liveMap(snap.lines, snap.projection.features);
  const examples: LockedExampleBrief[] = snap.projection.features.flatMap((f) =>
    f.examples
      .filter((x) => change.track === 'small' || change.lockedExampleIds.includes(x.exampleId))
      .map((x) => ({ exampleId: x.exampleId, featureName: f.name, given: x.given, when: x.when, then: x.then, checkPath: x.checkPath })),
  );
  const rules = projectRecords(snap.lines)
    .rules.filter((r) => r.status === 'accepted')
    .map((r) => `${r.text}（适用：${r.appliesWhen}）`);
  const knownFiles = change.targetFeatureIds.flatMap((id) => filesOfFeature(map, id).slice(0, 10).map((f) => f.path));
  return { changeId: change.changeId, description: change.description, examples, rules, knownFiles: [...new Set(knownFiles)] };
}

async function writeClaims(svc: StagentService, changeId: string, report: ClaimReport, round: number): Promise<void> {
  await svc.write(() =>
    svc.ledger.transaction(async (tx) => {
      await tx.append({ type: 'claim.reported', changeId, text: report.text || '（空回报）', round, ...(report.malformed ? { malformed: true } : {}) });
      for (const exampleId of report.claimedExampleIds) {
        await tx.append({ type: 'claim.reported', changeId, exampleId, text: report.text, round, ...(report.malformed ? { malformed: true } : {}) });
      }
    }),
  );
}

async function failuresOf(svc: StagentService) {
  const snap = await svc.state();
  const out: { exampleId: string; featureName: string; then: string; status: string; log: string }[] = [];
  for (const f of snap.projection.features) {
    for (const x of f.examples) {
      if (x.state === 'verified') continue;
      const log = x.lastResult?.logPath ? await readFile(join(svc.root, x.lastResult.logPath), 'utf8').catch(() => '') : '';
      out.push({ exampleId: x.exampleId, featureName: f.name, then: x.then, status: x.reason ? `${x.state}/${x.reason}` : x.state, log });
    }
  }
  return out;
}

export interface ChainOptions {
  /** 续接中断的会话。 */
  resume?: string;
  /** 外观不满意（附说明）：回到实现，不计入自动修复 3 轮上限（§5.1）。 */
  visualNote?: string;
}

/**
 * 实现 / 修复循环（后台执行）：AI 改代码 → 回报写成 claim → 系统全量回归 → 被阻止则自动修复，最多 3 轮。
 */
export async function startAgentChain(svc: StagentService, changeId: string, kind: 'implement' | 'fix', opts: ChainOptions = {}): Promise<{ started: true }> {
  const change = await svc.activeChange(changeId);
  if (change.track === 'feature' && (change.phase === 'confirm_examples' || change.phase === 'red_check')) {
    throw new HttpError(409, '新功能档要先确认并锁定例子，再开始实现');
  }
  if (svc.running) throw new HttpError(409, '检查进行中，结束后再交给 Claude Code');
  await withAgentTask(
    svc,
    { kind, label: kind === 'implement' ? '实现' : '修复', changeId },
    async (ctx, task) => {
      let mode = kind;
      let round = kind === 'implement' ? 0 : change.fixRounds + (opts.visualNote ? 0 : 1);
      let auto = 0;
      let resume = opts.resume;
      for (;;) {
        const current = await svc.activeChange(changeId);
        const input = await implementInput(svc, current);
        task.kind = mode;
        task.label = mode === 'implement' ? '实现' : `修复（第 ${round} 轮）`;
        const report =
          mode === 'implement'
            ? await callAgent(svc, changeId, mode, { ...ctx, ...(resume ? { resume } : {}) }, (c) => svc.agent!.implement(input, c))
            : await callAgent(svc, changeId, mode, { ...ctx, ...(resume ? { resume } : {}) }, async (c) =>
                svc.agent!.fix(
                  {
                    ...input,
                    round,
                    failures: opts.visualNote && auto === 0
                      ? [{ exampleId: '', featureName: '外观', then: '外观确认', status: '你确认为不满意', log: opts.visualNote }]
                      : await failuresOf(svc),
                    possiblyRelatedFiles: await failureContext(svc, current),
                  },
                  c,
                ),
              );
        resume = undefined;
        if (ctx.signal?.aborted) return;
        await writeClaims(svc, changeId, report, round);
        const snap = await svc.state();
        if (snap.projection.features.every((f) => f.lockedCount === 0)) return; // 没有锁定例子：无法回归，停在实现中
        task.line = '系统运行全量回归…';
        svc.bus.publish('agent.progress', { kind: mode, line: task.line, changeId });
        await svc.startRegression();
        await svc.waitForRun();
        const after = await svc.activeChange(changeId).catch(() => null);
        if (!after || after.phase !== 'blocked') {
          // 声称已实现、但系统没验证通过的例子：埋点「仅 AI 声称被系统证伪」。
          if (report.claimedExampleIds.length) {
            const refuted = snap.projection.features.flatMap((f) => f.examples).filter((x) => report.claimedExampleIds.includes(x.exampleId) && x.state !== 'verified');
            if (refuted.length) await recordMetric(svc.ledger.projectId, 'claim.refuted', { count: refuted.length });
          }
          return;
        }
        if (auto >= MAX_AUTO_FIX_ROUNDS) {
          task.line = `已自动修复 ${MAX_AUTO_FIX_ROUNDS} 轮，停下等你决定`;
          return;
        }
        if ((await svc.budget(changeId)).exceeded) return;
        auto += 1;
        mode = 'fix';
        round += 1;
      }
    },
    { background: true },
  );
  return { started: true };
}

// ---- 中断标记（§11：服务重启时有进行中的改动） ----

async function writeMarker(svc: StagentService, task: AgentTaskView): Promise<void> {
  const path = join(svc.root, MARKER);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ changeId: task.changeId, kind: task.kind, sessionId: task.sessionId, startedAt: task.startedAt })).catch(() => undefined);
}

async function clearMarker(svc: StagentService): Promise<void> {
  await rm(join(svc.root, MARKER), { force: true }).catch(() => undefined);
}

/** 服务启动时调用：上次关闭时 Claude Code 正在实现 / 修复 → 写 change.interrupted，记住会话 id 供续接。 */
export async function detectInterruption(svc: StagentService): Promise<void> {
  const path = join(svc.root, MARKER);
  let marker: { changeId?: string; kind?: string; sessionId?: string | null };
  try {
    marker = JSON.parse(await readFile(path, 'utf8')) as typeof marker;
  } catch {
    return;
  }
  await rm(path, { force: true }).catch(() => undefined);
  if (svc.ledger.state === 'locked' || !marker.changeId) return;
  const active = (await svc.changes()).active;
  if (active?.changeId !== marker.changeId) return;
  if (marker.sessionId) svc.interruptedSessions.set(marker.changeId, marker.sessionId);
  await svc.write(() =>
    svc.ledger.append({
      type: 'change.interrupted',
      changeId: marker.changeId!,
      reason: `Stagent 重启时 Claude Code 正在${marker.kind === 'fix' ? '修复' : '实现'}${marker.sessionId ? `（会话 ${marker.sessionId.slice(0, 8)}）` : ''}`,
    }),
  );
}

/** 续接中断的会话（SDK 支持 resume）；没有会话 id 时等同于重新发起。 */
export async function resumeAgent(svc: StagentService, changeId: string): Promise<{ started: true }> {
  const sessionId = svc.interruptedSessions.get(changeId);
  svc.interruptedSessions.delete(changeId);
  return startAgentChain(svc, changeId, 'implement', sessionId ? { resume: sessionId } : {});
}

// ---- 建改动时的档位判断（§5.2）与需求计划建议（§5.5） ----

export interface CreateChangeBody {
  description?: unknown;
  track?: unknown;
  force?: unknown;
  planId?: string;
  stepId?: string;
  targetFeatureIds?: string[];
}

export type CreateChangeResult =
  | { kind: 'created'; change: ChangeView }
  | { kind: 'suggest_plan'; suggestPlan: true; rationale: string; targetFeatureIds: string[] };

export async function createChangeFlow(svc: StagentService, body: CreateChangeBody): Promise<CreateChangeResult> {
  svc.assertWritable();
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (!description) throw new HttpError(400, '请描述这次改动');
  const active = (await svc.changes()).active;
  if (active) throw new HttpError(409, `已有进行中的改动「${active.description}」，请先合并或放弃`);

  let track = body.track === 'feature' || body.track === 'small' ? body.track : undefined;
  let targetFeatureIds = body.targetFeatureIds ?? [];
  const avail = await svc.agentAvailability();
  if (svc.agent && avail.available && !svc.agentTask && !body.planId) {
    // AI 判断档位、目标功能，以及是否应该先拆成计划。判断失败不阻止建改动。
    const snap = await svc.state();
    const map = liveMap(snap.lines, snap.projection.features);
    const { result } = await withAgentTask(svc, { kind: 'classify', label: '判断档位', changeId: null }, (ctx) =>
      callAgent(svc, null, 'classify', ctx, (c) =>
        svc.agent!.classifyChange({ description, features: featureBriefs(snap.projection.features, map), systemMap: '' }, c),
      ),
    ).catch(() => ({ result: undefined }));
    if (result) {
      if (result.suggestPlan && body.force !== true) {
        return { kind: 'suggest_plan', suggestPlan: true, rationale: result.rationale, targetFeatureIds: result.targetFeatureIds };
      }
      track ??= result.track;
      if (!targetFeatureIds.length) targetFeatureIds = result.targetFeatureIds;
    }
  }
  const change = await svc.createChange({
    description,
    track: track ?? 'small',
    ...(body.planId ? { planId: body.planId } : {}),
    ...(body.stepId ? { stepId: body.stepId } : {}),
    targetFeatureIds,
  });
  await autoStart(svc, change);
  return { kind: 'created', change: await svc.change(change.changeId) };
}

/** 建改动后自动开始：小改动 → 实现，新功能 → 起草例子（Claude Code 可用时）。 */
export async function autoStart(svc: StagentService, change: ChangeView): Promise<void> {
  if (svc.options.autoAgent === false || !svc.agent || change.source !== 'claude-code') return;
  if (!(await svc.agentAvailability()).available || svc.agentTask) return;
  const { startDraftExamples } = await import('./examples-flow.js');
  if (change.track === 'feature') await startDraftExamples(svc, change.changeId).catch(() => undefined);
  else await startAgentChain(svc, change.changeId, 'implement').catch(() => undefined);
}
