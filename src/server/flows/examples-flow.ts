/**
 * 例子：起草、先失败检查、锁定、外观确认、决策卡追问；接入扫描与基线例子
 * （规格 §5.1、§7、§9、§11；tasks.md M3-2 / M4-1 / M4-2）。
 *
 * Invariant 7：新功能档的例子，只有在锁定前对同一检查内容记录了一次 failed 的先失败检查（或你填写原因豁免）
 * 才允许锁定；先失败检查的 run 不参与例子状态判定，不产生任何验证证据。
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import type { PendingDraft } from '../../changes/changes.js';
import { writeSnapshot } from '../../evidence/snapshots.js';
import type { CheckSpec } from '../../executor/executor.js';
import { sha256Hex } from '../../ledger/hash.js';
import { assertReason } from '../../ledger/ledger.js';
import type { Event, EventOf, ExampleKind, LedgerLine } from '../../ledger/types.js';
import { recordMetric } from '../../metrics/metrics.js';
import { detectStack } from '../../init/init.js';
import { HttpError, newId, type StagentService } from '../service.js';
import { callAgent, startAgentChain, withAgentTask } from './agent-flow.js';
import { featureBriefs, liveMap } from './map-flow.js';

export const DRAFT_DIR = '.stagent/checks/draft';

// ---- 起草例子（新功能档） ----

/** 让 Claude Code 起草例子与检查（后台；只写 .stagent/checks/draft/<changeId>/）。 */
export async function startDraftExamples(svc: StagentService, changeId: string): Promise<{ started: true }> {
  const change = await svc.activeChange(changeId);
  if (change.track !== 'feature') throw new HttpError(409, '小改动档不新增例子；需要新例子请先升为新功能档');
  if (change.phase === 'checking') throw new HttpError(409, '检查进行中，结束后再起草例子');
  const draftDir = `${DRAFT_DIR}/${changeId}`;
  const config = await svc.config();
  await withAgentTask(
    svc,
    { kind: 'draft', label: '起草例子', changeId },
    async (ctx) => {
      const snap = await svc.state();
      const map = liveMap(snap.lines, snap.projection.features);
      // 例子挂到哪个功能：计划步骤指定了已有功能，或档位判断只指向一个已有功能（真实试用里"给 verify 加一行输出"
      // 被建成了一个新功能）→ 挂到它；否则新建一个以需求命名的功能。
      const targets = snap.projection.features.filter((f) => change.targetFeatureIds.includes(f.featureId));
      const existing = change.planId || targets.length === 1 ? targets[0] : undefined;
      const featureName = existing?.name ?? featureNameOf(change.description);
      const drafted = await callAgent(svc, changeId, 'draft', ctx, (c) =>
        svc.agent!.draftExamples(
          { mode: 'new', requirement: change.description, featureName, features: featureBriefs(snap.projection.features, map), draftDir, checkCommand: config.checkCommand },
          c,
        ),
      );
      const existing2: typeof drafted = [];
      for (const d of drafted) if (d.checkPath.startsWith(`${draftDir}/`) && (await exists(svc.root, d.checkPath))) existing2.push(d);
      const { kept: usable, dropped } = onePerFile(existing2);
      if (usable.length === 0) throw new HttpError(502, 'Claude Code 没有写出可用的检查文件');
      if (dropped.length) svc.agentError = droppedNote(dropped);
      const featureId = existing?.featureId ?? newId('f');
      await svc.write(() =>
        svc.ledger.transaction(async (tx) => {
          if (!existing) await tx.append({ type: 'feature.created', featureId, name: featureName, origin: 'new' });
          for (const d of usable) {
            await tx.append({
              type: 'example.drafted',
              exampleId: newId('e'),
              featureId,
              given: d.given,
              when: d.when,
              then: d.then,
              kind: d.kind,
              checkPath: d.checkPath,
              summary: d.summary,
              changeId,
              by: 'ai',
            });
          }
        }),
      );
    },
    { background: true },
  );
  return { started: true };
}

/**
 * 真实试用发现 Claude 会把几条例子写进同一个检查文件：那样它们同进同退，「已验证（N 个例子）」会虚高。
 * 同一个检查文件只保留第一条例子，其余丢弃并给出说明。
 */
export function onePerFile<T extends { checkPath: string; then: string }>(drafts: T[]): { kept: T[]; dropped: T[] } {
  const seen = new Set<string>();
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const d of drafts) {
    if (seen.has(d.checkPath)) dropped.push(d);
    else {
      seen.add(d.checkPath);
      kept.push(d);
    }
  }
  return { kept, dropped };
}

function droppedNote(dropped: { then: string }[]): string {
  return `Claude Code 把 ${dropped.length} 条例子和别的例子写进了同一个检查文件，已丢弃（同一文件只算一条例子）：${dropped
    .map((d) => d.then.slice(0, 30))
    .join('；')}。需要的话手写或让它重新起草`;
}

function featureNameOf(description: string): string {
  const s = description.replace(/\s+/g, ' ').trim();
  return s.length > 24 ? `${s.slice(0, 24)}…` : s;
}

// ---- 先失败检查（red-first，§5.1） ----

export interface RedCheckResult {
  runId: string;
  results: { exampleId: string; status: string; qualified: boolean; checkHash: string; logPath: string }[];
}

/** POST /api/changes/:id/red-check：对已确认的草稿例子跑先失败检查（只有 failed 合格）。 */
export async function runRedCheck(
  svc: StagentService,
  changeId: string,
  body: { exampleIds?: unknown; acknowledgedExampleIds?: unknown } = {},
): Promise<RedCheckResult> {
  const change = await svc.activeChange(changeId);
  if (change.track !== 'feature') throw new HttpError(409, '先失败检查只用于新功能档的新例子');
  const wanted = Array.isArray(body.exampleIds) ? new Set(body.exampleIds.filter((x): x is string => typeof x === 'string')) : null;
  const drafts = change.pendingDrafts.filter((d) => d.checkPath && (!wanted || wanted.has(d.exampleId)));
  if (drafts.length === 0) throw new HttpError(400, '没有待检查的例子草稿');
  svc.ensureDraftsAcknowledged(
    changeId,
    drafts.map((d) => d.exampleId),
    body,
  );
  for (const d of drafts) if (!(await exists(svc.root, d.checkPath!))) throw new HttpError(400, `检查文件 ${d.checkPath} 不存在`);
  const checks: CheckSpec[] = drafts.map((d) => ({ exampleId: d.exampleId, checkPath: d.checkPath!, source: { kind: 'draft', path: d.checkPath! } }));
  await svc.startRun({ purpose: 'red_check', checks, names: new Map(drafts.map((d) => [d.exampleId, `先失败检查：${d.then}`])), changeId });
  await svc.waitForRun();
  const last = svc.lastRunResults;
  if (!last || last.purpose !== 'red_check') throw new HttpError(500, '先失败检查没有产生结果');
  const results = last.results.map((r) => ({
    exampleId: r.exampleId,
    status: r.status,
    qualified: r.status === 'failed',
    checkHash: r.checkSnapshotId ?? '',
    logPath: r.logPath,
  }));
  for (const r of results) await recordMetric(svc.ledger.projectId, 'red_check.result', { qualified: r.qualified, status: r.status });
  return { runId: last.runId, results };
}

/** POST /api/changes/:id/examples/:exampleId/red-waive：确认行为已存在（必填原因），只对当前内容有效。 */
export async function redWaive(svc: StagentService, changeId: string, exampleId: string, body: { reason?: unknown }): Promise<{ ok: true }> {
  const change = await svc.activeChange(changeId);
  const d = pendingDraft(change.pendingDrafts, exampleId);
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  try {
    assertReason(reason);
  } catch (err) {
    throw new HttpError(400, (err as Error).message);
  }
  const checkHash = sha256Hex(await readCheck(svc.root, d.checkPath));
  await svc.write(() => svc.ledger.append({ type: 'example.red_waived', exampleId, checkHash, reason, by: 'user' }));
  await recordMetric(svc.ledger.projectId, 'red_check.waived', {});
  return { ok: true };
}

/** 让 Claude Code 重写一条不合格的检查，然后对新内容再跑一次先失败检查。 */
export async function rewriteExample(svc: StagentService, changeId: string, exampleId: string): Promise<{ started: true }> {
  const change = await svc.activeChange(changeId);
  const d = pendingDraft(change.pendingDrafts, exampleId);
  const config = await svc.config();
  const log = d.redCheck?.logPath ? await readFile(join(svc.root, d.redCheck.logPath), 'utf8').catch(() => '') : '';
  const draftDir = d.checkPath?.startsWith(`${DRAFT_DIR}/`) ? dirname(d.checkPath) : `${DRAFT_DIR}/${changeId}`;
  await withAgentTask(
    svc,
    { kind: 'rewrite', label: '重写检查', changeId },
    async (ctx) => {
      const snap = await svc.state();
      const map = liveMap(snap.lines, snap.projection.features);
      const feature = snap.projection.features.find((f) => f.featureId === d.featureId);
      const [first] = await callAgent(svc, changeId, 'rewrite', ctx, (c) =>
        svc.agent!.draftExamples(
          {
            mode: 'rewrite',
            requirement: change.description,
            featureName: feature?.name ?? featureNameOf(change.description),
            features: featureBriefs(snap.projection.features, map),
            draftDir,
            checkCommand: config.checkCommand,
            rewrite: { given: d.given, when: d.when, then: d.then, checkPath: d.checkPath ?? '', log },
          },
          c,
        ),
      );
      if (!first || !(await exists(svc.root, first.checkPath))) throw new HttpError(502, 'Claude Code 没有写出新的检查');
      await svc.write(() =>
        svc.ledger.append({
          type: 'example.drafted',
          exampleId,
          featureId: d.featureId,
          given: first.given || d.given,
          when: first.when || d.when,
          then: first.then || d.then,
          kind: first.kind,
          checkPath: first.checkPath,
          summary: first.summary,
          changeId,
          by: 'ai',
        }),
      );
    },
    { background: true },
  ).then(({ promise }) => promise.then(() => runRedCheck(svc, changeId, { exampleIds: [exampleId], acknowledgedExampleIds: [exampleId] }).catch(() => undefined)));
  return { started: true };
}

/** 删掉一条尚未锁定的例子草稿。 */
export async function discardExample(svc: StagentService, changeId: string, exampleId: string, body: { reason?: unknown }): Promise<{ ok: true }> {
  const change = await svc.activeChange(changeId);
  const d = pendingDraft(change.pendingDrafts, exampleId);
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : '删掉这条例子';
  await svc.write(() => svc.ledger.append({ type: 'example.discarded', exampleId, reason, by: 'user' }));
  if (d.checkPath?.startsWith(`${DRAFT_DIR}/`)) await rm(join(svc.root, d.checkPath), { force: true });
  svc.clearDraftAcks(changeId, [exampleId]);
  return { ok: true };
}

function pendingDraft(drafts: PendingDraft[], exampleId: string): PendingDraft & { checkPath: string } {
  const d = drafts.find((x) => x.exampleId === exampleId);
  if (!d || !d.checkPath) throw new HttpError(404, `例子 ${exampleId} 不是本改动的待锁定草稿`);
  return d as PendingDraft & { checkPath: string };
}

// ---- 锁定 ----

/**
 * 锁定一组草稿（§4.1「锁定检查快照」）：先写快照再写 example.locked。
 * 草稿目录里的检查先移到 .stagent/checks/<功能>/ 下（守卫只对起草会话放行草稿目录，锁定后的位置任何会话都不能写）。
 *
 * requireRed：新功能档要求每条例子有合格的先失败检查或豁免，且 checkHash 与之相等（否则 422，Invariant 7）。
 */
export async function lockDrafts(
  svc: StagentService,
  drafts: PendingDraft[],
  opts: { changeId?: string; requireRed: boolean; baseline?: boolean },
): Promise<{ exampleId: string; checkPath: string; checkHash: string }[]> {
  const prepared: { d: PendingDraft; content: Buffer; checkHash: string; redCheck: EventOf<'example.locked'>['redCheck'] }[] = [];
  const problems: string[] = [];
  for (const d of drafts) {
    if (!d.checkPath) throw new HttpError(400, `例子「${d.then}」没有检查文件`);
    const content = await readCheck(svc.root, d.checkPath);
    const checkHash = sha256Hex(content);
    let redCheck: EventOf<'example.locked'>['redCheck'];
    if (opts.baseline) redCheck = { baseline: true };
    else if (d.waiver && d.waiver.checkHash === checkHash) redCheck = { waived: true, reason: d.waiver.reason };
    else if (d.redCheck && d.redCheck.status === 'failed' && d.redCheck.checkHash === checkHash) redCheck = { runId: d.redCheck.runId, status: 'failed' };
    if (opts.requireRed && !redCheck) {
      problems.push(
        !d.redCheck && !d.waiver
          ? `「${d.then}」还没有跑先失败检查`
          : d.redCheck && d.redCheck.checkHash !== checkHash && (!d.waiver || d.waiver.checkHash !== checkHash)
            ? `「${d.then}」的检查在先失败检查之后被改过，需要重跑`
            : `「${d.then}」的检查在实现前没有失败（${d.redCheck?.status ?? '未运行'}），没测到新行为`,
      );
    }
    prepared.push({ d, content, checkHash, redCheck });
  }
  if (problems.length) throw new HttpError(422, `不能锁定：${problems.join('；')}`);

  const out: { exampleId: string; checkPath: string; checkHash: string }[] = [];
  const events: Event[] = [];
  for (const p of prepared) {
    const checkPath = await finalCheckPath(svc.root, p.d, p.content);
    if (checkPath !== p.d.checkPath) {
      await mkdir(dirname(join(svc.root, checkPath)), { recursive: true });
      await writeFile(join(svc.root, checkPath), p.content);
    }
    const snapshot = await writeSnapshot(svc.root, p.content); // 先写快照，再写事件（孤儿快照由启动清理）
    if (snapshot !== p.checkHash) throw new HttpError(500, '快照哈希与检查内容不一致');
    events.push({
      type: 'example.locked',
      exampleId: p.d.exampleId,
      checkPath,
      checkHash: p.checkHash,
      by: 'user',
      ...(opts.changeId ? { changeId: opts.changeId } : {}),
      ...(p.redCheck ? { redCheck: p.redCheck } : {}),
    });
    out.push({ exampleId: p.d.exampleId, checkPath, checkHash: p.checkHash });
  }
  await svc.write(() =>
    svc.ledger.transaction(async (tx) => {
      for (const e of events) await tx.append(e);
    }),
  );
  for (const p of prepared) if (p.d.checkPath?.startsWith(`${DRAFT_DIR}/`)) await rm(join(svc.root, p.d.checkPath), { force: true });
  return out;
}

async function finalCheckPath(root: string, d: PendingDraft, content: Buffer): Promise<string> {
  if (!d.checkPath?.startsWith(`${DRAFT_DIR}/`)) return d.checkPath!;
  const dir = `.stagent/checks/${d.featureId.replace(/[^A-Za-z0-9._-]/g, '_')}`;
  const name = basename(d.checkPath);
  let candidate = `${dir}/${name}`;
  const existing = await readFile(join(root, candidate)).catch(() => null);
  if (existing && sha256Hex(existing) !== sha256Hex(content)) {
    const ext = extname(name);
    candidate = `${dir}/${name.slice(0, name.length - ext.length)}.${d.exampleId}${ext}`;
  }
  return candidate;
}

/** 起草的检查内容就是要锁定、要跑先失败检查的内容。 */
async function readCheck(root: string, checkPath: string): Promise<Buffer> {
  try {
    return await readFile(join(root, checkPath));
  } catch {
    throw new HttpError(400, `检查文件 ${checkPath} 不存在`);
  }
}

// ---- 外观确认（§7 visual） ----

/** POST /api/visual/:exampleId：确认截图 ok / 不满意（附说明）。不满意时回到实现，Claude Code 可用则带说明继续（不计入 3 轮上限）。 */
export async function confirmVisual(svc: StagentService, exampleId: string, body: { ok?: unknown; note?: unknown }): Promise<{ ok: true }> {
  svc.assertWritable();
  const change = (await svc.changes()).active;
  if (!change || change.phase !== 'awaiting_visual') throw new HttpError(409, '当前没有等你确认外观的改动');
  const pending = change.visualPending.find((v) => v.exampleId === exampleId);
  if (!pending) throw new HttpError(404, `例子 ${exampleId} 不在等你确认的外观例子里`);
  const ok = body.ok === true;
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : undefined;
  if (!ok && !note) throw new HttpError(400, '不满意时请写一句说明，交给 Claude Code 继续改');
  await svc.write(() =>
    svc.ledger.append({ type: 'visual.confirmed', exampleId, runId: pending.runId, screenshot: pending.screenshot ?? '', ok, ...(note ? { note } : {}) }),
  );
  if (!ok && svc.agent && (await svc.agentAvailability()).available && !svc.agentTask && svc.options.autoAgent !== false) {
    await startAgentChain(svc, change.changeId, 'fix', { visualNote: note! }).catch(() => undefined);
  }
  return { ok: true };
}

// ---- 决策卡「我有疑问」（D17） ----

export async function askDecision(svc: StagentService, cardId: string, body: unknown): Promise<{ answer: string }> {
  const b = (body ?? {}) as { question?: unknown; card?: { question?: unknown; background?: unknown; options?: unknown } };
  const question = typeof b.question === 'string' ? b.question.trim() : '';
  if (!question) throw new HttpError(400, '请写下你的疑问');
  const card = {
    question: typeof b.card?.question === 'string' ? b.card.question : cardId,
    background: typeof b.card?.background === 'string' ? b.card.background : '',
    options: Array.isArray(b.card?.options)
      ? (b.card.options as { label?: unknown; pros?: unknown; cons?: unknown }[]).map((o) => ({
          label: String(o.label ?? ''),
          ...(typeof o.pros === 'string' ? { pros: o.pros } : {}),
          ...(typeof o.cons === 'string' ? { cons: o.cons } : {}),
        }))
      : [],
  };
  const { result } = await withAgentTask(svc, { kind: 'ask', label: '回答疑问', changeId: null }, (ctx) =>
    callAgent(svc, null, 'ask', ctx, (c) => svc.agent!.answerDecisionQuestion({ card, question }, c)),
  );
  return { answer: result ?? '' };
}

// ---- 扫描接入（§9 第 2 步） ----

/** POST /api/scan：Claude Code 只读扫描路由、页面和接口，每识别一个功能就写 feature.created(origin:'scan')。 */
export async function startScan(svc: StagentService): Promise<{ started: true }> {
  if (svc.scan?.running) throw new HttpError(409, '扫描进行中');
  const stack = await detectStack(svc.root);
  const known = new Set((await svc.features()).map((f) => f.name));
  svc.scan = { running: true, found: [], error: null, startedAt: new Date().toISOString() };
  const scan = svc.scan;
  let writes = Promise.resolve();
  const { promise } = await withAgentTask(
    svc,
    { kind: 'scan', label: '扫描现有代码', changeId: null },
    async (ctx) => {
      await callAgent(svc, null, 'scan', ctx, (c) =>
        svc.agent!.scanFeatures(
          { stackHint: `${stack.framework} / ${stack.testRunner}` },
          {
            ...c,
            onFeature: (f) => {
              if (known.has(f.name)) return;
              known.add(f.name);
              scan.found.push(f.name);
              const entryFiles = f.entryFiles.filter((p) => !p.startsWith('.stagent/'));
              writes = writes.then(() =>
                svc
                  .write(() => svc.ledger.append({ type: 'feature.created', featureId: newId('f'), name: f.name, origin: 'scan', entryFiles }))
                  .then(() => {
                    svc.bus.publish('scan.feature', { name: f.name });
                  })
                  .catch(() => undefined),
              );
            },
          },
        ),
      );
      await writes;
    },
    { background: true },
  ).catch((err: Error) => {
    scan.running = false;
    scan.error = err.message;
    throw err;
  });
  void promise.then(async () => {
    await writes;
    scan.running = false;
    if (svc.agentError && !scan.found.length) scan.error = svc.agentError;
    svc.bus.publish('scan.finished', { found: scan.found.length });
  });
  return { started: true };
}

// ---- 基线例子（§9 第 3 步） ----

export interface BaselineDraftView extends PendingDraft {
  featureName: string;
}

/** 已起草、尚未锁定的基线例子草稿。 */
export function baselineDrafts(lines: readonly LedgerLine[]): Map<string, EventOf<'example.drafted'>> {
  const drafts = new Map<string, EventOf<'example.drafted'>>();
  for (const { event: e } of lines) {
    if (e.type === 'example.drafted' && e.baseline) drafts.set(e.exampleId, e);
    else if ((e.type === 'example.locked' || e.type === 'example.discarded') && drafts.has(e.exampleId)) drafts.delete(e.exampleId);
  }
  return drafts;
}

export async function listBaseline(svc: StagentService): Promise<{ drafts: BaselineDraftView[] }> {
  const snap = await svc.state();
  const names = new Map(snap.projection.features.map((f) => [f.featureId, f.name]));
  return {
    drafts: [...baselineDrafts(snap.lines).values()]
      .filter((d) => names.has(d.featureId))
      .map((d) => ({
        exampleId: d.exampleId,
        featureId: d.featureId,
        featureName: names.get(d.featureId)!,
        given: d.given,
        when: d.when,
        then: d.then,
        kind: d.kind,
        ...(d.checkPath ? { checkPath: d.checkPath } : {}),
        ...(d.summary ? { summary: d.summary } : {}),
        baseline: true,
        redCheck: null,
        waiver: null,
      })),
  };
}

/** POST /api/features/:id/baseline：为核心功能起草基线例子（后台）。 */
export async function startBaselineDraft(svc: StagentService, featureId: string): Promise<{ started: true }> {
  const feature = await svc.feature(featureId);
  const draftDir = `${DRAFT_DIR}/baseline/${featureId}`;
  const config = await svc.config();
  await withAgentTask(
    svc,
    { kind: 'baseline', label: `为「${feature.name}」起草基线例子`, changeId: null },
    async (ctx) => {
      const snap = await svc.state();
      const map = liveMap(snap.lines, snap.projection.features);
      const drafted = await callAgent(svc, null, 'baseline', ctx, (c) =>
        svc.agent!.draftExamples(
          { mode: 'baseline', requirement: `${feature.name} 现有的行为`, featureName: feature.name, features: featureBriefs(snap.projection.features, map), draftDir, checkCommand: config.checkCommand },
          c,
        ),
      );
      const present: typeof drafted = [];
      for (const d of drafted) if (await exists(svc.root, d.checkPath)) present.push(d);
      const { kept: usable, dropped } = onePerFile(present);
      if (!usable.length) throw new HttpError(502, 'Claude Code 没有写出可用的检查文件');
      if (dropped.length) svc.agentError = droppedNote(dropped);
      await svc.write(() =>
        svc.ledger.transaction(async (tx) => {
          for (const d of usable) {
            await tx.append({ type: 'example.drafted', exampleId: newId('e'), featureId, given: d.given, when: d.when, then: d.then, kind: d.kind, checkPath: d.checkPath, summary: d.summary, baseline: true, by: 'ai' });
          }
        }),
      );
    },
    { background: true },
  );
  return { started: true };
}

/** 手写一个基线例子（检查文件已写好，在 .stagent/checks/ 下）。 */
export async function addBaselineDraft(svc: StagentService, featureId: string, body: Record<string, unknown>): Promise<{ exampleId: string }> {
  svc.assertWritable();
  await svc.feature(featureId);
  const text = (k: string) => (typeof body[k] === 'string' ? (body[k] as string).trim() : '');
  const { checkPathInput } = await import('../service.js');
  const checkPath = checkPathInput(text('checkPath'));
  if (!(await exists(svc.root, checkPath))) throw new HttpError(400, `检查文件 ${checkPath} 不存在`);
  if (!text('given') || !text('when') || !text('then')) throw new HttpError(400, '情况、操作、期望都要填写');
  const exampleId = newId('e');
  const kind: ExampleKind = body.kind === 'visual' ? 'visual' : 'behavior';
  await svc.write(() =>
    svc.ledger.append({ type: 'example.drafted', exampleId, featureId, given: text('given'), when: text('when'), then: text('then'), kind, checkPath, baseline: true, by: 'user' }),
  );
  return { exampleId };
}

/**
 * PUT /api/examples/:id/draft：锁定前修改例子草稿（基线草稿，或进行中改动的待锁定草稿），不需要授权。
 * 写一条 by:'user' 的 example.drafted——这就是 §14 的「例子确认时的修改率」的分子。
 * 改了检查内容（checkContent）会让之前的先失败检查失效，需要重跑。
 */
export async function editDraft(svc: StagentService, exampleId: string, body: Record<string, unknown>): Promise<{ ok: true }> {
  svc.assertWritable();
  const d = baselineDrafts(svc.ledger.lines()).get(exampleId) ?? (await activeDraft(svc, exampleId));
  if (!d) throw new HttpError(404, `例子 ${exampleId} 不是未锁定的草稿（已锁定的例子要走授权修改）`);
  const text = (k: 'given' | 'when' | 'then') => (typeof body[k] === 'string' && (body[k] as string).trim() ? (body[k] as string).trim() : d[k]);
  if (typeof body.checkContent === 'string' && d.checkPath) await writeFile(join(svc.root, d.checkPath), body.checkContent);
  await svc.write(() => svc.ledger.append({ ...d, given: text('given'), when: text('when'), then: text('then'), by: 'user' }));
  // 改过文字必须重新勾选「读过」
  const active = (await svc.changes()).active;
  if (active?.pendingDraftIds.includes(exampleId)) svc.clearDraftAcks(active.changeId, [exampleId]);
  return { ok: true };
}

/** 兼容旧名。 */
export const editBaselineDraft = editDraft;

async function activeDraft(svc: StagentService, exampleId: string): Promise<EventOf<'example.drafted'> | undefined> {
  const active = (await svc.changes()).active;
  if (!active?.pendingDraftIds.includes(exampleId)) return undefined;
  let found: EventOf<'example.drafted'> | undefined;
  for (const { event: e } of svc.ledger.lines()) if (e.type === 'example.drafted' && e.exampleId === exampleId) found = e;
  return found;
}

/** POST /api/baseline/lock：确认并锁定基线例子，跑一次基线（purpose:'baseline'，不做先失败检查）。 */
export async function lockBaseline(svc: StagentService, body: { exampleIds?: unknown }): Promise<{ locked: number }> {
  svc.assertWritable();
  if (svc.running) throw new HttpError(409, '已有检查在运行');
  const all = (await listBaseline(svc)).drafts;
  const ids = Array.isArray(body.exampleIds) ? new Set(body.exampleIds.filter((x): x is string => typeof x === 'string')) : null;
  const chosen = all.filter((d) => !ids || ids.has(d.exampleId));
  if (!chosen.length) throw new HttpError(400, '没有待锁定的基线例子');
  const locked = await lockDrafts(svc, chosen, { requireRed: false, baseline: true });
  const names = new Map(chosen.map((d) => [d.exampleId, `${d.featureName}：${d.then}`]));
  await svc.startRun({
    purpose: 'baseline',
    checks: locked.map((l) => ({ exampleId: l.exampleId, checkPath: l.checkPath, source: { kind: 'snapshot', checkSnapshotId: l.checkHash } })),
    names,
    changeId: null,
  });
  return { locked: locked.length };
}

/** 基线失败 →「接受现状」：记录一条 pitfall，例子标「已知不一致」，不阻塞账本，交付报告中显式列出。 */
export async function acceptKnownInconsistent(svc: StagentService, exampleId: string, body: { reason?: unknown }): Promise<{ ok: true }> {
  svc.assertWritable();
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  try {
    assertReason(reason);
  } catch (err) {
    throw new HttpError(400, (err as Error).message);
  }
  const features = await svc.features();
  const f = features.find((x) => x.examples.some((e) => e.exampleId === exampleId));
  const x = f?.examples.find((e) => e.exampleId === exampleId);
  if (!f || !x) throw new HttpError(404, `例子 ${exampleId} 不是锁定例子`);
  if (x.state !== 'failed' || !x.lastResult) throw new HttpError(409, '只有当前失败的例子才能标为已知不一致');
  await svc.write(() =>
    svc.ledger.transaction(async (tx) => {
      await tx.append({ type: 'example.known_inconsistent', exampleId, runId: x.lastResult!.runId, reason, by: 'user' });
      await tx.append({
        type: 'record.saved',
        recordId: newId('r'),
        kind: 'pitfall',
        tags: ['已知不一致'],
        scope: 'project',
        title: `「${f.name}」现有行为与例子不一致：${x.then}`,
        body: reason,
      });
    }),
  );
  return { ok: true };
}

async function exists(root: string, rel: string): Promise<boolean> {
  return readFile(join(root, rel)).then(
    () => true,
    () => false,
  );
}
