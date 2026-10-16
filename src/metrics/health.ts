/**
 * 产品健康指标（规格 §14）：防止 Stagent 退化成"AI 帮你填表"。
 *
 * 只在本机计算，来源是账本（谁起草、谁改过、先失败检查、运行）与 ~/.stagent/metrics.jsonl（界面停留时间等）。
 * 最重要的一条是「防盖章」：AI 起草的例子你几乎不改、每条只看不到 5 秒就确认，说明确认已经退化成点按钮——
 * 此时"已验证"给你的是虚假的安全感，结论卡会提示。
 */
import type { LedgerLine } from '../ledger/types.js';

/** 每条例子平均停留少于这个时间算"没细看"（§14：少于 5 秒）。 */
export const RUBBER_STAMP_DWELL_MS = 5_000;
/** 至少确认过这么多条 AI 起草的例子才下结论。 */
export const RUBBER_STAMP_MIN_EXAMPLES = 3;

export interface HealthReport {
  confirmations: {
    /** 确认（锁定）过的 AI 起草例子数。 */
    aiDrafted: number;
    /** 其中锁定前被你改过的。 */
    edited: number;
    editRate: number | null;
    /** 最近 10 次确认中，每条例子的停留时间中位数（毫秒）。 */
    medianDwellPerExampleMs: number | null;
    dwellSamples: number;
  };
  rubberStamp: { suspected: boolean; text: string | null };
  redCheck: { results: number; unqualified: number; unqualifiedRate: number | null; locked: number; waived: number; waiveRate: number | null };
  runs: { total: number; invalid: number };
  flakyResults: number;
  claimsRefuted: number;
  regressionsCaught: number;
  ui: { drawerOpened: number; mapOpened: number; plansOpened: number };
}

export function computeHealth(lines: readonly LedgerLine[], metrics: readonly Record<string, unknown>[]): HealthReport {
  const draftedBy = new Map<string, ('ai' | 'user')[]>();
  let lockedNew = 0;
  let waived = 0;
  let redResults = 0;
  let redUnqualified = 0;
  let runs = 0;
  let invalid = 0;
  let flaky = 0;
  const confirmed = new Set<string>();
  for (const { event: e } of lines) {
    if (e.type === 'example.drafted') draftedBy.set(e.exampleId, [...(draftedBy.get(e.exampleId) ?? []), e.by ?? 'user']);
    else if (e.type === 'example.locked') {
      if (draftedBy.has(e.exampleId)) confirmed.add(e.exampleId);
      if (e.redCheck && !('baseline' in e.redCheck)) {
        lockedNew += 1;
        if ('waived' in e.redCheck) waived += 1;
      }
    } else if (e.type === 'run.completed') {
      if (e.purpose === 'red_check') {
        redResults += e.results.length;
        redUnqualified += e.results.filter((r) => r.status !== 'failed').length;
      } else {
        runs += 1;
        if (!e.valid) invalid += 1;
        flaky += e.results.filter((r) => r.status === 'flaky').length;
      }
    }
  }
  let aiDrafted = 0;
  let edited = 0;
  for (const id of confirmed) {
    const by = draftedBy.get(id) ?? [];
    const firstAi = by.indexOf('ai');
    if (firstAi === -1) continue; // 你手写的例子不算进修改率
    aiDrafted += 1;
    if (by.slice(firstAi + 1).includes('user')) edited += 1;
  }

  const sum = (name: string, field = 'count') =>
    metrics.filter((m) => m.name === name).reduce((s, m) => s + (typeof m[field] === 'number' ? (m[field] as number) : 1), 0);
  const dwell = metrics
    .filter((m) => m.name === 'ui.examples.reviewed' && typeof m.ms === 'number' && typeof m.count === 'number' && (m.count as number) > 0)
    .slice(-10)
    .map((m) => (m.ms as number) / (m.count as number))
    .sort((a, b) => a - b);
  const median = dwell.length ? dwell[Math.floor(dwell.length / 2)]! : null;
  const editRate = aiDrafted ? edited / aiDrafted : null;

  let rubber: HealthReport['rubberStamp'] = { suspected: false, text: null };
  if (aiDrafted >= RUBBER_STAMP_MIN_EXAMPLES && edited === 0 && (median === null || median < RUBBER_STAMP_DWELL_MS)) {
    rubber = {
      suspected: true,
      text:
        median === null
          ? `你确认的 ${aiDrafted} 条 AI 起草的例子一条都没改过——请确认每条例子真的是你要的行为，否则"已验证"只是 AI 自己给自己打分`
          : `你确认的 ${aiDrafted} 条 AI 起草的例子一条都没改过，每条平均只看了 ${(median / 1000).toFixed(1)} 秒——小心确认变成盖章`,
    };
  }

  return {
    confirmations: { aiDrafted, edited, editRate, medianDwellPerExampleMs: median, dwellSamples: dwell.length },
    rubberStamp: rubber,
    redCheck: {
      results: redResults,
      unqualified: redUnqualified,
      unqualifiedRate: redResults ? redUnqualified / redResults : null,
      locked: lockedNew,
      waived,
      waiveRate: lockedNew ? waived / lockedNew : null,
    },
    runs: { total: runs, invalid },
    flakyResults: flaky,
    claimsRefuted: sum('claim.refuted'),
    regressionsCaught: sum('regression.caught', 'features'),
    ui: { drawerOpened: sum('ui.drawer.opened', '_'), mapOpened: sum('ui.map.opened', '_'), plansOpened: sum('ui.plans.opened', '_') },
  };
}
