/**
 * 功能文件映射与系统地图（规格 §4.5、D27）。纯函数，只来自账本中的历史事件，不做静态分析（D18）。
 *
 * 来源（后者覆盖前者对同一路径的结论）：
 *   1. 扫描接入：feature.created(origin:'scan').entryFiles；
 *   2. 每次合并：change.merged.files 按该改动最近一条 change.files_attributed 归属（并入已有归属）；
 *      deleted 从映射移除，renamed 把旧路径的归属迁到新路径；
 *   3. 手动纠正：feature.files_reassigned（替换该路径的归属）。
 *
 * Invariant 8：映射只用于展示、提示和给 AI 提供上下文，不参与任何证据状态推导，也不缩小回归范围。
 * 本模块不被 projection.ts / changes.ts 引用。
 */
import type { FileAttribution, LedgerLine } from '../ledger/types.js';

export const HOTSPOT_MIN_FEATURES = 3;

export interface FileFeatureLink {
  featureId: string;
  /** 被改次数（为该功能合并改动时 +1；扫描入口为 0）。 */
  count: number;
  lastChangeId: string | null;
}

export interface MapProjection {
  /** path → 归属的功能（只含未退役功能）。 */
  files: Map<string, FileFeatureLink[]>;
  /** changeId → 最近一次写入的归属。 */
  attributionsByChange: Map<string, FileAttribution[]>;
  /** featureId → 最近 5 次改动（合并时间倒序）。 */
  recentChanges: Map<string, { changeId: string; at: string }[]>;
}

export function projectMap(lines: readonly LedgerLine[], liveFeatureIds?: ReadonlySet<string>): MapProjection {
  const files = new Map<string, Map<string, FileFeatureLink>>();
  const attributionsByChange = new Map<string, FileAttribution[]>();
  const recent = new Map<string, { changeId: string; at: string }[]>();

  const link = (path: string, featureId: string, changeId: string | null) => {
    const m = files.get(path) ?? new Map<string, FileFeatureLink>();
    const cur = m.get(featureId) ?? { featureId, count: 0, lastChangeId: null };
    if (changeId) {
      cur.count += 1;
      cur.lastChangeId = changeId;
    }
    m.set(featureId, cur);
    files.set(path, m);
  };

  for (const { event: e, at } of lines) {
    switch (e.type) {
      case 'feature.created':
        for (const p of e.entryFiles ?? []) link(normalizePath(p), e.featureId, null);
        break;
      case 'change.files_attributed':
        attributionsByChange.set(e.changeId, e.attributions.map((a) => ({ ...a, path: normalizePath(a.path) })));
        break;
      case 'change.merged': {
        const attrs = new Map((attributionsByChange.get(e.changeId) ?? []).map((a) => [a.path, a.featureIds]));
        const touched = new Set<string>();
        for (const f of e.files ?? []) {
          const path = normalizePath(f.path);
          if (f.status === 'deleted') {
            files.delete(path);
            continue;
          }
          if (f.status === 'renamed' && f.from) {
            const from = normalizePath(f.from);
            const old = files.get(from);
            files.delete(from);
            if (old) {
              const merged = files.get(path) ?? new Map<string, FileFeatureLink>();
              for (const [fid, l] of old) merged.set(fid, { ...l, count: l.count + (merged.get(fid)?.count ?? 0) });
              files.set(path, merged);
            }
          }
          for (const fid of attrs.get(path) ?? []) {
            link(path, fid, e.changeId);
            touched.add(fid);
          }
        }
        for (const fid of touched) recent.set(fid, [{ changeId: e.changeId, at }, ...(recent.get(fid) ?? [])].slice(0, 5));
        break;
      }
      case 'feature.files_reassigned': {
        const path = normalizePath(e.path);
        const old = files.get(path) ?? new Map<string, FileFeatureLink>();
        const next = new Map<string, FileFeatureLink>();
        for (const fid of e.featureIds) next.set(fid, old.get(fid) ?? { featureId: fid, count: 0, lastChangeId: null });
        if (next.size) files.set(path, next);
        else files.delete(path);
        break;
      }
      default:
        break;
    }
  }

  const out = new Map<string, FileFeatureLink[]>();
  for (const [path, m] of files) {
    const links = [...m.values()].filter((l) => !liveFeatureIds || liveFeatureIds.has(l.featureId));
    if (links.length) out.set(path, links);
  }
  return { files: out, attributionsByChange, recentChanges: recent };
}

/** 功能 → 文件列表（按被改次数排序）。 */
export function filesOfFeature(map: MapProjection, featureId: string): { path: string; count: number; lastChangeId: string | null }[] {
  const out: { path: string; count: number; lastChangeId: string | null }[] = [];
  for (const [path, links] of map.files) {
    const l = links.find((x) => x.featureId === featureId);
    if (l) out.push({ path, count: l.count, lastChangeId: l.lastChangeId });
  }
  return out.sort((a, b) => b.count - a.count || (a.path < b.path ? -1 : 1));
}

/** 文件 → 功能 id。 */
export function featuresOfFile(map: MapProjection, path: string): string[] {
  return (map.files.get(normalizePath(path)) ?? []).map((l) => l.featureId);
}

/** 被 ≥ 3 个功能共享的文件（改它最容易误伤）。 */
export function hotspots(map: MapProjection): { path: string; featureIds: string[] }[] {
  return [...map.files.entries()]
    .filter(([, links]) => links.length >= HOTSPOT_MIN_FEATURES)
    .map(([path, links]) => ({ path, featureIds: links.map((l) => l.featureId) }))
    .sort((a, b) => b.featureIds.length - a.featureIds.length || (a.path < b.path ? -1 : 1));
}

export interface ImpactView {
  /** 本改动 diff 中的文件在映射中归属的功能集合。 */
  touchedFeatureIds: string[];
  /** 超出本功能的改动（D20）：归属与 targetFeatureIds 不相交的文件，以及共享热点。targetFeatureIds 为空时不计算。 */
  outsideScope: { path: string; featureIds: string[]; reason: 'other_feature' | 'hotspot' }[];
}

export function impactOf(map: MapProjection, diffFiles: readonly string[], targetFeatureIds: readonly string[]): ImpactView {
  const touched = new Set<string>();
  const outside: ImpactView['outsideScope'] = [];
  const target = new Set(targetFeatureIds);
  for (const raw of diffFiles) {
    const path = normalizePath(raw);
    const fids = featuresOfFile(map, path);
    fids.forEach((f) => touched.add(f));
    if (target.size === 0) continue;
    if (fids.length >= HOTSPOT_MIN_FEATURES) outside.push({ path, featureIds: fids, reason: 'hotspot' });
    else if (fids.length > 0 && !fids.some((f) => target.has(f))) outside.push({ path, featureIds: fids, reason: 'other_feature' });
  }
  return { touchedFeatureIds: [...touched], outsideScope: outside };
}

/** 失败定位：功能 F 的文件 ∩ 本改动 diff。 */
export function possiblyRelatedFiles(map: MapProjection, featureId: string, diffFiles: readonly string[]): string[] {
  const own = new Set(filesOfFeature(map, featureId).map((f) => f.path));
  return diffFiles.map(normalizePath).filter((p) => own.has(p));
}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}
