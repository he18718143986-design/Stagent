/**
 * 生成文档（规格 §10）：.stagent/docs/*.md 是给你读、也是给 AI 读的"系统说明书"。
 * 只来自账本投影；不进 git，也不影响证据（§4.1 排除清单）。
 */
import type { PlansProjection } from '../plans/plans.js';
import type { FeatureView } from '../projection/projection.js';
import type { RecordsProjection } from '../records/records.js';

/** 结构上与 server/flows/map-flow.ts 的 MapView 一致（这里只读需要的字段）。 */
export interface MapViewLike {
  note: string;
  features: { featureId: string; name: string; files: { path: string; count: number }[] }[];
  hotspots: { path: string; features: { name: string }[] }[];
  unassigned: string[];
}

const HEADER = '<!-- 由 Stagent 根据账本自动生成，手动修改会被覆盖 -->';

export function renderFeatures(features: readonly FeatureView[]): string {
  const out = [HEADER, '# 功能与验收例子', ''];
  if (!features.length) out.push('还没有任何功能。');
  for (const f of features) {
    out.push(`## ${f.name}`, '', `状态：${f.stateLabel}${f.tags.length > 1 ? ` · ${f.tags.slice(1).join(' · ')}` : ''}`, '');
    if (!f.examples.length) out.push('尚无锁定例子。', '');
    for (const x of f.examples) {
      out.push(`- 情况：${x.given} → 操作：${x.when} → 期望：**${x.then}**${x.kind === 'visual' ? '（外观）' : ''}`);
      out.push(`  - 当前：${x.state === 'verified' ? '已验证' : x.state === 'failed' ? '失败' : `未验证（${x.explanation}）`}`);
      if (x.summary) out.push(`  - 检查实际在看：${x.summary}`);
      out.push(`  - 检查：\`${x.checkPath}\``);
    }
    out.push('');
  }
  return out.join('\n');
}

export function renderSystemMap(map: MapViewLike, features: readonly FeatureView[]): string {
  const byId = new Map(features.map((f) => [f.featureId, f]));
  const out = [HEADER, '# 系统地图', '', `> ${map.note}`, ''];
  for (const m of map.features) {
    const f = byId.get(m.featureId);
    out.push(`## ${m.name}`, '');
    if (f) out.push(`${f.stateLabel}；${f.lockedCount} 个锁定例子${f.examples.length ? `，例如：${f.examples.slice(0, 2).map((x) => x.then).join('；')}` : ''}`, '');
    out.push(m.files.length ? `主要文件：${m.files.slice(0, 10).map((x) => `\`${x.path}\``).join('、')}` : '主要文件：（尚未形成，完成几次改动后会逐步形成）', '');
  }
  if (map.hotspots.length) {
    out.push('## 共享热点（改这里最容易误伤别的功能）', '');
    for (const h of map.hotspots) out.push(`- \`${h.path}\`：${h.features.map((x) => x.name).join('、')}`);
    out.push('');
  }
  out.push(`## 未归属文件（${map.unassigned.length} 个）`, '');
  for (const p of map.unassigned.slice(0, 50)) out.push(`- \`${p}\``);
  if (map.unassigned.length > 50) out.push(`- …还有 ${map.unassigned.length - 50} 个`);
  return out.join('\n') + '\n';
}

export function renderPlan(plans: PlansProjection): string {
  const out = [HEADER, '# 需求计划', ''];
  const p = plans.active ?? plans.plans.find((x) => x.status === 'draft');
  if (!p) return [...out, '当前没有进行中的需求计划。', ''].join('\n');
  out.push(`需求：${p.requirement}`, '', `状态：${p.statusLabel} · 进度 ${p.progress.done}/${p.progress.total}`, '');
  if (p.rationale) out.push(`拆分理由：${p.rationale}`, '');
  for (const s of p.steps) out.push(`${s.index + 1}. **${s.title}**（${s.track === 'feature' ? '新功能' : '小改动'} · ${s.statusLabel}）：${s.intent}`);
  return out.join('\n') + '\n';
}

export function renderRules(records: RecordsProjection): string {
  const out = [HEADER, '# 决策、踩坑与规则', '', '## 规则', ''];
  const active = records.rules.filter((r) => r.status === 'accepted');
  if (!active.length) out.push('暂无已接受的规则。');
  for (const r of active) out.push(`- ${r.text}（适用：${r.appliesWhen}；失效：${r.expiresWhen}；生效后同类踩坑 ${r.pitfallsAfter} 次）`);
  out.push('', '## 记录', '');
  for (const r of records.records.slice(0, 100)) out.push(`- [${r.kind === 'decision' ? '决策' : '踩坑'}] ${r.title || r.body.slice(0, 60)}（${r.tags.join('、')}）`);
  return out.join('\n') + '\n';
}
