/**
 * Stagent cockpit Tailwind class tokens —「简约·科技」暗色主题。
 * 多数屏经这些 token 取色,改这里即整店变暗;强调色沿用 stagent-orange。
 */
export const simpleTheme = {
  page: 'min-h-full bg-stagent-ink',
  card: 'bg-stagent-surface rounded-2xl border border-white/10 p-6 shadow-lg shadow-black/30',
  heading: 'text-2xl font-bold text-slate-100',
  subheading: 'text-sm text-slate-400',
  primaryBtn:
    'w-full py-3 px-6 rounded-full bg-stagent-orange text-white font-semibold hover:bg-orange-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors',
  secondaryBtn:
    'py-2.5 px-5 rounded-full border-2 border-stagent-orange text-stagent-orange font-medium hover:bg-orange-500/10 transition-colors',
  pillSelected: 'border-2 border-stagent-orange bg-orange-500/15 text-slate-100',
  pillDefault: 'border border-white/15 bg-white/5 text-slate-200 hover:border-orange-400',
  /** 英雄区主标题（统一驾驶舱白话大标题）。 */
  hero: 'text-3xl font-bold text-slate-100 tracking-tight',
  /** 次要 / 折叠技术视图的低饱和底板。 */
  mutedPanel: 'rounded-xl bg-white/5 border border-white/10',
  /** 建议项 / 标签胶囊。 */
  chip: 'text-sm px-3 py-1.5 rounded-full border border-white/15 bg-white/5 text-slate-200 hover:border-stagent-orange hover:bg-orange-500/10 transition-colors',
} as const
