/**
 * 系统地图与「改了什么」（规格 §4.5、§11、D20、D27；tasks.md M4-2 / M4-3）。
 *
 * - 文件归属在改动到达可合并前由服务端写 change.files_attributed：新功能档默认归属目标功能（source:'target'），
 *   其余由 AI 提出并自动采用（source:'ai'，不请你确认，验收 #10），你随时可以改（source:'user'）；
 * - 影响提示与失败定位只用于展示和给 AI 提供上下文（Invariant 8），不改变回归范围、不参与证据推导。
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChangeView } from '../../changes/changes.js';
import { git, splitNul, UNBORN_COMMIT } from '../../git/git.js';
import type { FileAttribution, LedgerLine } from '../../ledger/types.js';
import { featuresOfFile, filesOfFeature, hotspots, impactOf, normalizePath, possiblyRelatedFiles, projectMap, type MapProjection } from '../../map/map.js';
import type { FeatureView } from '../../projection/projection.js';
import { HttpError, type StagentService } from '../service.js';
import { recordAgentUsage } from './agent-flow.js';

export interface DiffFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  from?: string;
  added: number;
  deleted: number;
  featureIds: string[];
}

/** 基准 → 工作区的文件清单（含已暂存、未暂存与未跟踪文件；不含 .stagent/）。 */
export async function diffFiles(root: string, base: string): Promise<DiffFile[]> {
  const out = new Map<string, DiffFile>();
  const hasBase = base && base !== UNBORN_COMMIT;
  if (hasBase) {
    const parts = splitNul(await git(root, ['diff', '--name-status', '-z', '--find-renames', base, '--', '.', ':(exclude).stagent']));
    for (let i = 0; i < parts.length; ) {
      const code = parts[i++]!;
      if (code.startsWith('R')) {
        const from = parts[i++]!;
        const path = parts[i++]!;
        out.set(path, { path, status: 'renamed', from, added: 0, deleted: 0, featureIds: [] });
      } else {
        const path = parts[i++]!;
        out.set(path, { path, status: code === 'A' ? 'added' : code === 'D' ? 'deleted' : 'modified', added: 0, deleted: 0, featureIds: [] });
      }
    }
    const numstat = (await git(root, ['diff', '--numstat', '--find-renames', base, '--', '.', ':(exclude).stagent'])).split('\n').filter(Boolean);
    for (const line of numstat) {
      const [a, d, ...rest] = line.split('\t');
      const raw = rest.join('\t');
      // 重命名的 numstat 形如 "src/{a => b}.ts" 或 "a => b"
      const path = raw.includes(' => ') ? expandRename(raw) : raw;
      const f = out.get(path);
      if (f) {
        f.added = a === '-' ? 0 : Number(a);
        f.deleted = d === '-' ? 0 : Number(d);
      }
    }
  }
  const untracked = splitNul(await git(root, ['ls-files', '-o', '--exclude-standard', '-z', '--', '.', ':(exclude).stagent']));
  const tracked = hasBase ? [] : splitNul(await git(root, ['ls-files', '-c', '-z', '--', '.', ':(exclude).stagent']));
  for (const path of [...untracked, ...tracked]) {
    if (out.has(path)) continue;
    const text = await readFile(join(root, path), 'utf8').catch(() => '');
    out.set(path, { path, status: 'added', added: text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0, deleted: 0, featureIds: [] });
  }
  return [...out.values()].sort((a, b) => (a.path < b.path ? -1 : 1));
}

function expandRename(raw: string): string {
  const m = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(raw);
  if (m) return `${m[1]}${m[3]}${m[4]}`.replace(/\/\//g, '/');
  return raw.split(' => ')[1] ?? raw;
}

/** 单个文件的统一 diff（截断到 maxBytes）。 */
async function fileDiff(root: string, base: string, f: DiffFile, maxBytes: number): Promise<string> {
  try {
    if (f.status === 'added' && (!base || base === UNBORN_COMMIT || !(await isTracked(root, f.path)))) {
      const text = await readFile(join(root, f.path), 'utf8');
      return truncate(text.split('\n').map((l) => `+${l}`).join('\n'), maxBytes);
    }
    return truncate(await git(root, ['diff', '--find-renames', base, '--', ...(f.from ? [f.from] : []), f.path]), maxBytes);
  } catch {
    return '';
  }
}

async function isTracked(root: string, path: string): Promise<boolean> {
  return git(root, ['ls-files', '--error-unmatch', '--', path]).then(
    () => true,
    () => false,
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\n…（已截断）` : s;
}

export function liveMap(lines: readonly LedgerLine[], features: readonly FeatureView[]): MapProjection {
  return projectMap(lines, new Set(features.map((f) => f.featureId)));
}

/** 本改动最近一次写入的文件归属。 */
function latestAttribution(lines: readonly LedgerLine[], changeId: string): FileAttribution[] | null {
  let out: FileAttribution[] | null = null;
  for (const { event: e } of lines) if (e.type === 'change.files_attributed' && e.changeId === changeId) out = e.attributions;
  return out;
}

/**
 * 确保进行中的改动有覆盖当前 diff 的文件归属（§4.5）。文件集合没变时不重写；你手动改过的归属保留。
 * 新功能档：默认归属目标功能，已归属到其他功能的文件保留原归属并追加目标功能；
 * 其余：AI 根据改动内容、targetFeatureIds 与已有映射提出归属并自动采用；AI 不可用时按已有映射 / 目标功能推断。
 */
export async function ensureAttribution(svc: StagentService, changeId: string): Promise<FileAttribution[] | null> {
  if (svc.ledger.state === 'locked') return null;
  const snap = await svc.state();
  const change = snap.changes.active;
  if (!change || change.changeId !== changeId) return null;
  const files = (await diffFiles(svc.root, change.baseCommit)).filter((f) => f.status !== 'deleted').map((f) => f.path);
  if (files.length === 0) return null;
  const previous = latestAttribution(snap.lines, changeId) ?? [];
  const prevPaths = new Set(previous.map((a) => a.path));
  if (files.every((p) => prevPaths.has(p)) && previous.every((a) => files.includes(a.path))) return previous;

  const map = liveMap(snap.lines, snap.projection.features);
  const kept = previous.filter((a) => a.source === 'user' && files.includes(a.path));
  const todo = files.filter((p) => !kept.some((a) => a.path === p));
  const target = change.targetFeatureIds;
  let fresh: FileAttribution[];
  let by: 'ai' | 'target' = 'ai';
  if (change.track === 'feature' && target.length > 0) {
    by = 'target';
    fresh = todo.map((path) => ({ path, featureIds: [...new Set([...featuresOfFile(map, path), ...target])], source: 'target' }));
  } else {
    fresh = await aiAttribution(svc, change, todo, map, snap.projection.features).catch(() => heuristic(todo, map, target));
  }
  const attributions = [...kept, ...fresh].sort((a, b) => (a.path < b.path ? -1 : 1));
  await svc.write(() => svc.ledger.append({ type: 'change.files_attributed', changeId, attributions, by }));
  return attributions;
}

function heuristic(paths: string[], map: MapProjection, target: string[]): FileAttribution[] {
  return paths.map((path) => {
    const existing = featuresOfFile(map, path);
    return { path, featureIds: existing.length ? existing : target, source: 'ai' };
  });
}

async function aiAttribution(
  svc: StagentService,
  change: ChangeView,
  paths: string[],
  map: MapProjection,
  features: FeatureView[],
): Promise<FileAttribution[]> {
  const avail = await svc.agentAvailability();
  // 归属是只读的小任务，不占用 AI 任务槽（实现循环等回归时也会调用）；不可用时按已有映射推断。
  if (!svc.agent || !avail.available) return heuristic(paths, map, change.targetFeatureIds);
  const existing = Object.fromEntries(paths.map((p) => [p, featuresOfFile(map, p)]).filter(([, f]) => (f as string[]).length));
  const outcome = await svc.agent.attributeFiles(
    {
      files: paths,
      features: featureBriefs(features, map),
      targetFeatureIds: change.targetFeatureIds,
      existing: existing as Record<string, string[]>,
      description: change.description,
    },
    { projectRoot: svc.root },
  );
  await recordAgentUsage(svc, change.changeId, 'attribute', outcome.usage);
  const byPath = new Map(outcome.value.map((a) => [a.path, a]));
  return paths.map((path) => byPath.get(path) ?? { path, featureIds: featuresOfFile(map, path), source: 'ai' as const });
}

/** 给 AI 的功能清单摘要（含系统地图里的主要文件）。 */
export function featureBriefs(features: readonly FeatureView[], map: MapProjection) {
  return features.map((f) => ({
    featureId: f.featureId,
    name: f.name,
    stateLabel: f.stateLabel,
    examples: f.examples.map((x) => x.then),
    files: filesOfFeature(map, f.featureId).slice(0, 8).map((x) => x.path),
  }));
}

/** PUT /api/changes/:id/attributions：你修改本改动的文件归属（source:'user'）。 */
export async function setAttributions(svc: StagentService, changeId: string, body: unknown): Promise<FileAttribution[]> {
  const change = await svc.activeChange(changeId);
  const list = (body as { attributions?: unknown })?.attributions;
  if (!Array.isArray(list)) throw new HttpError(400, '缺少 attributions');
  const live = new Set((await svc.features()).map((f) => f.featureId));
  const edits = new Map<string, string[]>();
  for (const a of list as { path?: unknown; featureIds?: unknown }[]) {
    if (typeof a?.path !== 'string' || !Array.isArray(a.featureIds)) throw new HttpError(400, '每条归属要有 path 与 featureIds');
    const ids = a.featureIds.filter((x): x is string => typeof x === 'string');
    const unknown = ids.filter((id) => !live.has(id));
    if (unknown.length) throw new HttpError(404, `功能不存在：${unknown.join('、')}`);
    edits.set(normalizePath(a.path), ids);
  }
  const previous = latestAttribution(svc.ledger.lines(), changeId) ?? [];
  const merged = new Map(previous.map((a) => [a.path, a]));
  for (const [path, featureIds] of edits) merged.set(path, { path, featureIds, source: 'user' });
  const attributions = [...merged.values()].sort((a, b) => (a.path < b.path ? -1 : 1));
  await svc.write(() => svc.ledger.append({ type: 'change.files_attributed', changeId: change.changeId, attributions, by: 'user' }));
  return attributions;
}

/** POST /api/map/files：在系统地图里手动纠正一个文件的归属（feature.files_reassigned）。 */
export async function reassignFile(svc: StagentService, body: unknown): Promise<{ path: string; featureIds: string[] }> {
  svc.assertWritable();
  const b = (body ?? {}) as { path?: unknown; featureIds?: unknown; note?: unknown };
  if (typeof b.path !== 'string' || !b.path.trim()) throw new HttpError(400, '缺少 path');
  if (!Array.isArray(b.featureIds)) throw new HttpError(400, '缺少 featureIds');
  const featureIds = b.featureIds.filter((x): x is string => typeof x === 'string');
  const live = new Set((await svc.features()).map((f) => f.featureId));
  const unknown = featureIds.filter((id) => !live.has(id));
  if (unknown.length) throw new HttpError(404, `功能不存在：${unknown.join('、')}`);
  const path = normalizePath(b.path.trim());
  const note = typeof b.note === 'string' && b.note.trim() ? b.note.trim() : undefined;
  await svc.write(() => svc.ledger.append({ type: 'feature.files_reassigned', path, featureIds, by: 'user', ...(note ? { note } : {}) }));
  return { path, featureIds };
}

export interface MapView {
  note: string;
  features: {
    featureId: string;
    name: string;
    state: FeatureView['state'];
    stateLabel: string;
    exampleCount: number;
    files: { path: string; count: number; lastChangeId: string | null }[];
    recentChanges: { changeId: string; at: string; description: string }[];
  }[];
  hotspots: { path: string; features: { featureId: string; name: string }[] }[];
  unassigned: string[];
  trackedFileCount: number;
}

export const MAP_NOTE = '此地图来自改动历史，不是代码依赖分析；用于理解和定位，不影响检查范围。';

/** GET /api/map */
export async function mapView(svc: StagentService): Promise<MapView> {
  const snap = await svc.state();
  const map = liveMap(snap.lines, snap.projection.features);
  const names = new Map(snap.projection.features.map((f) => [f.featureId, f.name]));
  const descriptions = new Map(snap.changes.changes.map((c) => [c.changeId, c.description]));
  const tracked = splitNul(await git(svc.root, ['ls-files', '-z', '--', '.', ':(exclude).stagent']).catch(() => '')).map(normalizePath);
  const assigned = new Set(map.files.keys());
  return {
    note: MAP_NOTE,
    features: snap.projection.features.map((f) => ({
      featureId: f.featureId,
      name: f.name,
      state: f.state,
      stateLabel: f.stateLabel,
      exampleCount: f.lockedCount,
      files: filesOfFeature(map, f.featureId),
      recentChanges: (map.recentChanges.get(f.featureId) ?? []).map((c) => ({ ...c, description: descriptions.get(c.changeId) ?? '' })),
    })),
    hotspots: hotspots(map).map((h) => ({ path: h.path, features: h.featureIds.map((id) => ({ featureId: id, name: names.get(id) ?? id })) })),
    unassigned: tracked.filter((p) => !assigned.has(p)),
    trackedFileCount: tracked.length,
  };
}

/** GET /api/map/files?path= */
export async function fileQuery(svc: StagentService, path: string): Promise<{ path: string; features: { featureId: string; name: string }[] }> {
  if (!path) throw new HttpError(400, '缺少 path');
  const snap = await svc.state();
  const map = liveMap(snap.lines, snap.projection.features);
  const names = new Map(snap.projection.features.map((f) => [f.featureId, f.name]));
  const p = normalizePath(path);
  return { path: p, features: featuresOfFile(map, p).map((id) => ({ featureId: id, name: names.get(id) ?? id })) };
}

/** 每个文件的大小上限：抽屉里展开 diff 用，太大的截断。 */
const DIFF_MAX_BYTES = 20_000;

export interface ChangeDiffView {
  changeId: string;
  base: string;
  source: ChangeView['source'];
  totals: { files: number; added: number; deleted: number };
  files: (DiffFile & { diff: string })[];
  touchedFeatures: { featureId: string; name: string }[];
  /** null：没有目标功能（外部改动），不显示「超出本功能的改动」区块。 */
  outsideScope: { path: string; reason: 'other_feature' | 'hotspot'; features: { featureId: string; name: string }[] }[] | null;
  targetFeatures: { featureId: string; name: string }[];
  /** 按功能的大白话说明：AI 回报（仅声称）里「改了什么」+ 本功能被改的文件。 */
  byFeature: { featureId: string | null; name: string; files: string[] }[];
  summary: string;
  /** 外观例子的改前 / 改后截图。 */
  screenshots: { exampleId: string; featureName: string; then: string; before?: string; after?: string }[];
  /** 被破坏功能的「可能相关的改动文件」（失败定位）。 */
  failureLocations: { featureId: string; name: string; files: string[] }[];
  attributions: FileAttribution[];
}

/** GET /api/changes/:id/diff：「改了什么」（基准 → 工作区）。 */
export async function changeDiff(svc: StagentService, changeId: string): Promise<ChangeDiffView> {
  const snap = await svc.state();
  const change = snap.changes.changes.find((c) => c.changeId === changeId);
  if (!change) throw new HttpError(404, `改动 ${changeId} 不存在`);
  const ended = change.phase === 'merged' || change.phase === 'abandoned';
  const map = liveMap(snap.lines, snap.projection.features);
  const names = new Map(snap.projection.features.map((f) => [f.featureId, f.name]));
  const named = (ids: string[]) => ids.map((featureId) => ({ featureId, name: names.get(featureId) ?? featureId }));

  let files: DiffFile[] = [];
  if (!ended) files = await diffFiles(svc.root, change.baseCommit);
  else {
    const merged = snap.lines.map((l) => l.event).find((e) => e.type === 'change.merged' && e.changeId === changeId);
    if (merged?.type === 'change.merged') files = (merged.files ?? []).map((f) => ({ path: f.path, status: f.status, ...(f.from ? { from: f.from } : {}), added: 0, deleted: 0, featureIds: [] }));
  }
  const attributions = latestAttribution(snap.lines, changeId) ?? [];
  const attrByPath = new Map(attributions.map((a) => [a.path, a.featureIds]));
  for (const f of files) f.featureIds = attrByPath.get(f.path) ?? featuresOfFile(map, f.path);

  const paths = files.map((f) => f.path);
  const impact = impactOf(map, paths, change.targetFeatureIds);
  const touched = new Set([...impact.touchedFeatureIds, ...files.flatMap((f) => f.featureIds)]);
  const byFeature = new Map<string | null, string[]>();
  for (const f of files) for (const id of f.featureIds.length ? f.featureIds : [null]) byFeature.set(id, [...(byFeature.get(id) ?? []), f.path]);

  const withDiff = await Promise.all(files.map(async (f) => ({ ...f, diff: ended ? '' : await fileDiff(svc.root, change.baseCommit, f, DIFF_MAX_BYTES) })));
  const lastClaim = change.claims.at(-1);
  const summary = lastClaim ? (/## 改了什么\s*\n([\s\S]*?)(\n##|$)/.exec(lastClaim.text)?.[1]?.trim() ?? lastClaim.text.slice(0, 600)) : '';

  // 截图：本改动涉及的功能里的外观例子；改前 = 改动开始前最近一次运行的截图，改后 = 之后最近一次。
  const startedAt = change.startedAt;
  const screenshots: ChangeDiffView['screenshots'] = [];
  for (const f of snap.projection.features) {
    if (!touched.has(f.featureId) && !change.targetFeatureIds.includes(f.featureId)) continue;
    for (const x of f.examples.filter((e) => e.kind === 'visual')) {
      let before: string | undefined;
      let after: string | undefined;
      for (const { event: e, at } of snap.lines) {
        if (e.type !== 'run.completed' || e.purpose === 'red_check') continue;
        const shot = e.results.find((r) => r.exampleId === x.exampleId)?.screenshot;
        if (!shot) continue;
        if (at < startedAt) before = shot;
        else after = shot;
      }
      if (before || after) screenshots.push({ exampleId: x.exampleId, featureName: f.name, then: x.then, ...(before ? { before } : {}), ...(after ? { after } : {}) });
    }
  }

  const failureLocations = snap.projection.features
    .filter((f) => f.state === 'broken')
    .map((f) => ({ featureId: f.featureId, name: f.name, files: possiblyRelatedFiles(map, f.featureId, paths) }));

  return {
    changeId,
    base: change.baseCommit,
    source: change.source,
    totals: { files: files.length, added: files.reduce((s, f) => s + f.added, 0), deleted: files.reduce((s, f) => s + f.deleted, 0) },
    files: withDiff,
    touchedFeatures: named([...touched]),
    outsideScope:
      change.targetFeatureIds.length === 0
        ? null
        : impact.outsideScope.map((o) => ({ path: o.path, reason: o.reason, features: named(o.featureIds) })),
    targetFeatures: named(change.targetFeatureIds),
    byFeature: [...byFeature.entries()].map(([featureId, fs]) => ({ featureId, name: featureId ? (names.get(featureId) ?? featureId) : '未归属', files: fs })),
    summary,
    screenshots,
    failureLocations,
    attributions,
  };
}

/** 失败定位：被破坏功能的文件 ∩ 本改动 diff（给修复提示用）。 */
export async function failureContext(svc: StagentService, change: ChangeView): Promise<string[]> {
  const snap = await svc.state();
  const map = liveMap(snap.lines, snap.projection.features);
  const paths = (await diffFiles(svc.root, change.baseCommit)).map((f) => f.path);
  const out = new Set<string>();
  for (const f of snap.projection.features.filter((x) => x.state === 'broken')) for (const p of possiblyRelatedFiles(map, f.featureId, paths)) out.add(p);
  return [...out];
}
