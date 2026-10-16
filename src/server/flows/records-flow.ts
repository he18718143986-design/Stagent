/**
 * 记录卡、规则提案与个人通用库（规格 §10、D5–D9；tasks.md M5-1）。
 *
 * - change.merged 之后 AI 根据回报、失败日志、授权原因起草 0–2 条记录卡（只存在本地，不进账本），你保存才写 record.saved；
 * - 同一标签的 pitfall 达到 2 条时 AI 起草一条规则（rule.proposed，带适用条件和失效条件）；
 * - 你接受后写 rule.accepted，并重写 CLAUDE.md 与 .cursor/rules/stagent.mdc 的 `<!-- stagent:rules -->` 区块；
 * - 勾选「同步到个人通用库」的记录或规则复制到 ~/.stagent/library/。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { RUNS_RELATIVE_DIR } from '../../executor/executor.js';
import { detectStack } from '../../init/init.js';
import type { RecordKind, RecordScope } from '../../ledger/types.js';
import { listLibrary, saveToLibrary, type LibraryItem } from '../../records/library.js';
import { projectRecords, rulesDrift, writeRulesBlocks, type RecordsProjection, type RulesDrift } from '../../records/records.js';
import { HttpError, newId, type StagentService } from '../service.js';
import { callAgent, withAgentTask } from './agent-flow.js';

export interface RecordDraft {
  draftId: string;
  changeId: string;
  kind: RecordKind;
  title: string;
  body: string;
  tags: string[];
  at: string;
}

const DRAFTS_FILE = join(RUNS_RELATIVE_DIR, 'record-drafts.json');

export async function loadRecordDrafts(svc: StagentService): Promise<void> {
  try {
    svc.recordDrafts = JSON.parse(await readFile(join(svc.root, DRAFTS_FILE), 'utf8')) as RecordDraft[];
  } catch {
    svc.recordDrafts = [];
  }
}

async function persistDrafts(svc: StagentService): Promise<void> {
  const path = join(svc.root, DRAFTS_FILE);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(svc.recordDrafts, null, 2));
}

/** 合并之后：AI 起草 0–2 条记录卡（后台，失败不影响合并）。 */
export async function draftRecordsAfterMerge(svc: StagentService, changeId: string): Promise<void> {
  if (!svc.agent || !(await svc.agentAvailability()).available) return;
  const snap = await svc.state();
  const change = snap.changes.changes.find((c) => c.changeId === changeId);
  if (!change) return;
  const failures: string[] = [];
  const authReasons: string[] = [];
  for (const { event: e } of snap.lines) {
    if (e.type === 'run.completed' && e.changeId === changeId && e.purpose !== 'red_check') {
      for (const r of e.results) if (r.status !== 'passed') failures.push(`${r.exampleId}: ${r.status}${r.detail ? `（${r.detail}）` : ''}`);
    } else if (e.type === 'auth.granted' && e.changeId === changeId && e.reason) authReasons.push(`${e.action}：${e.reason}`);
  }
  // 记录卡不占用 AI 任务槽（不该挡住你接下来描述的改动），在后台起草。
  const work = callAgent(svc, changeId, 'records', { projectRoot: svc.root }, (c) =>
    svc.agent!.draftRecords(
      { change: { description: change.description, track: change.track }, claims: change.claims.map((x) => x.text), failures: failures.slice(-20), authReasons },
      c,
    ),
  )
    .then(async (drafted) => {
      const at = new Date().toISOString();
      svc.recordDrafts.push(...drafted.slice(0, 2).map((d) => ({ draftId: newId('rd'), changeId, ...d, at })));
      await persistDrafts(svc);
      svc.bus.publish('records.drafted', { count: drafted.length });
    })
    .catch(() => undefined);
  svc.trackBackground(work);
}

export interface RecordsResponse extends RecordsProjection {
  drafts: RecordDraft[];
  drift: RulesDrift[];
}

export async function recordsView(svc: StagentService): Promise<RecordsResponse> {
  const snap = await svc.state();
  const projection = projectRecords(snap.lines);
  return { ...projection, drafts: svc.recordDrafts, drift: await currentDrift(svc, projection) };
}

export async function currentDrift(svc: StagentService, projection?: RecordsProjection): Promise<RulesDrift[]> {
  const p = projection ?? projectRecords(svc.ledger.lines());
  return (await rulesDrift(svc.root, p.rules)).filter((d) => !svc.rulesDriftAck.has(d.fingerprint));
}

/** POST /api/records：保存记录（可来自记录卡，也可手写）。保存 pitfall 后检查是否该提出规则。 */
export async function saveRecord(svc: StagentService, body: Record<string, unknown>): Promise<{ recordId: string }> {
  svc.assertWritable();
  const draft = typeof body.draftId === 'string' ? svc.recordDrafts.find((d) => d.draftId === body.draftId) : undefined;
  const kind: RecordKind = (body.kind ?? draft?.kind) === 'decision' ? 'decision' : 'pitfall';
  const title = (typeof body.title === 'string' ? body.title.trim() : '') || draft?.title || '';
  const text = (typeof body.body === 'string' ? body.body.trim() : '') || draft?.body || '';
  const tags = Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === 'string' && t.trim() !== '').map((t) => t.trim()) : (draft?.tags ?? []);
  const scope: RecordScope = body.scope === 'personal' ? 'personal' : 'project';
  if (!title && !text) throw new HttpError(400, '记录内容不能为空');
  if (!tags.length) throw new HttpError(400, '至少要有一个标签（联调、接口、数据、部署、环境等）');
  const recordId = newId('r');
  await svc.write(() =>
    svc.ledger.append({ type: 'record.saved', recordId, kind, tags, scope, title, body: text, ...(draft ? { changeId: draft.changeId } : {}) }),
  );
  if (draft) {
    svc.recordDrafts = svc.recordDrafts.filter((d) => d !== draft);
    await persistDrafts(svc);
  }
  if (body.library === true || scope === 'personal') {
    const stack = await detectStack(svc.root);
    await saveToLibrary({ id: recordId, kind, title, body: text, tags, stack: [stack.framework, stack.testRunner].filter((s) => s !== 'unknown') }).catch(() => undefined);
  }
  if (kind === 'pitfall') await proposeRulesIfNeeded(svc);
  return { recordId };
}

/** 不记录：丢掉一张记录卡。 */
export async function dismissRecordDraft(svc: StagentService, draftId: string): Promise<{ ok: true }> {
  const before = svc.recordDrafts.length;
  svc.recordDrafts = svc.recordDrafts.filter((d) => d.draftId !== draftId);
  if (svc.recordDrafts.length === before) throw new HttpError(404, `记录卡 ${draftId} 不存在`);
  await persistDrafts(svc);
  return { ok: true };
}

/** 同一标签的 pitfall 达到 2 条、且还没有规则时，起草一条规则提案（AI 不可用时用模板起草，同样等你确认）。 */
export async function proposeRulesIfNeeded(svc: StagentService): Promise<string[]> {
  const proposed: string[] = [];
  for (const tag of projectRecords(svc.ledger.lines()).tagsNeedingRule) {
    const pitfalls = projectRecords(svc.ledger.lines())
      .records.filter((r) => r.kind === 'pitfall' && r.tags.includes(tag))
      .map((r) => ({ title: r.title, body: r.body }));
    let rule = {
      text: `涉及「${tag}」的改动，先回顾已记录的 ${pitfalls.length} 次踩坑：${pitfalls.map((p) => p.title || p.body.slice(0, 30)).join('；')}`,
      appliesWhen: `改动涉及「${tag}」时`,
      expiresWhen: `连续 10 次改动没有再出现「${tag}」类踩坑`,
    };
    if (svc.agent && !svc.agentTask && (await svc.agentAvailability()).available) {
      const { result } = await withAgentTask(svc, { kind: 'rule', label: '起草规则提案', changeId: null }, (ctx) =>
        callAgent(svc, null, 'rule', ctx, (c) => svc.agent!.draftRule({ tag, pitfalls }, c)),
      ).catch(() => ({ result: undefined }));
      if (result) rule = result;
    }
    const ruleId = newId('rule');
    await svc.write(() => svc.ledger.append({ type: 'rule.proposed', ruleId, ...rule, tags: [tag] }));
    proposed.push(ruleId);
  }
  return proposed;
}

/** POST /api/rules/:id/accept：确认规则（可先修改），写 rule.accepted 并重写规则区块。 */
export async function acceptRule(svc: StagentService, ruleId: string, body: Record<string, unknown>): Promise<{ ok: true }> {
  svc.assertWritable();
  const r = projectRecords(svc.ledger.lines()).rules.find((x) => x.ruleId === ruleId);
  if (!r) throw new HttpError(404, `规则 ${ruleId} 不存在`);
  if (r.status !== 'proposed') throw new HttpError(409, `规则已${r.status === 'accepted' ? '接受' : '退役'}`);
  const pick = (k: 'text' | 'appliesWhen' | 'expiresWhen') => (typeof body[k] === 'string' && (body[k] as string).trim() ? (body[k] as string).trim() : r[k]);
  await svc.write(() =>
    svc.ledger.append({ type: 'rule.accepted', ruleId, text: pick('text'), appliesWhen: pick('appliesWhen'), expiresWhen: pick('expiresWhen'), tags: r.tags }),
  );
  await regenerateRules(svc);
  if (body.library === true) {
    const stack = await detectStack(svc.root);
    await saveToLibrary({
      id: ruleId,
      kind: 'rule',
      title: pick('text'),
      body: pick('text'),
      tags: r.tags,
      stack: [stack.framework, stack.testRunner].filter((s) => s !== 'unknown'),
      appliesWhen: pick('appliesWhen'),
      expiresWhen: pick('expiresWhen'),
    }).catch(() => undefined);
  }
  return { ok: true };
}

/** 驳回提案或退役已接受的规则：写 rule.retired 并重写规则区块。 */
export async function retireRule(svc: StagentService, ruleId: string): Promise<{ ok: true }> {
  svc.assertWritable();
  const r = projectRecords(svc.ledger.lines()).rules.find((x) => x.ruleId === ruleId);
  if (!r) throw new HttpError(404, `规则 ${ruleId} 不存在`);
  if (r.status === 'retired') throw new HttpError(409, '规则已退役');
  await svc.write(() => svc.ledger.append({ type: 'rule.retired', ruleId, text: r.text, appliesWhen: r.appliesWhen, expiresWhen: r.expiresWhen, tags: r.tags }));
  await regenerateRules(svc);
  return { ok: true };
}

/** POST /api/rules/regenerate：以账本为准重新生成规则区块。 */
export async function regenerateRules(svc: StagentService): Promise<{ ok: true }> {
  await writeRulesBlocks(svc.root, projectRecords(svc.ledger.lines()).rules);
  svc.rulesDriftAck.clear();
  return { ok: true };
}

/** 「保留现状」：规则区块被你手动改过，你选择保留——本次运行期间不再提示同一处偏离。 */
export async function keepRulesDrift(svc: StagentService): Promise<{ ok: true }> {
  for (const d of await rulesDrift(svc.root, projectRecords(svc.ledger.lines()).rules)) svc.rulesDriftAck.add(d.fingerprint);
  return { ok: true };
}

export async function libraryView(svc: StagentService): Promise<{ stack: string[]; items: LibraryItem[] }> {
  const s = await detectStack(svc.root);
  const stack = [s.framework, s.testRunner].filter((x) => x !== 'unknown');
  return { stack, items: await listLibrary(stack) };
}

/** 从个人通用库挑一条规则到本项目：写 rule.proposed，仍然要你确认。 */
export async function importLibraryRule(svc: StagentService, id: string): Promise<{ ruleId: string }> {
  svc.assertWritable();
  const item = (await listLibrary()).find((x) => x.id === id);
  if (!item) throw new HttpError(404, `通用库里没有 ${id}`);
  const ruleId = newId('rule');
  await svc.write(() =>
    svc.ledger.append({
      type: 'rule.proposed',
      ruleId,
      text: item.kind === 'rule' ? item.title : `${item.title}：${item.body}`,
      appliesWhen: item.appliesWhen ?? '—',
      expiresWhen: item.expiresWhen ?? '—',
      tags: item.tags,
    }),
  );
  return { ruleId };
}
