/** Stagent cockpit Tailwind class tokens */
export const simpleTheme = {
  page: 'min-h-full bg-stagent-cream',
  card: 'bg-white rounded-2xl shadow-sm border border-orange-100/60 p-6',
  heading: 'text-2xl font-bold text-stone-800',
  subheading: 'text-sm text-stone-500',
  primaryBtn:
    'w-full py-3 px-6 rounded-full bg-stagent-orange text-white font-semibold hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors',
  secondaryBtn:
    'py-2.5 px-5 rounded-full border-2 border-stagent-orange text-stagent-orange font-medium hover:bg-orange-50 transition-colors',
  pillSelected: 'border-2 border-stagent-orange bg-orange-50 text-stone-800',
  pillDefault: 'border border-stone-200 bg-white text-stone-700 hover:border-orange-300',
  /** 英雄区主标题（统一驾驶舱白话大标题）。 */
  hero: 'text-3xl font-bold text-stone-800 tracking-tight',
  /** 次要 / 折叠技术视图的低饱和底板。 */
  mutedPanel: 'rounded-xl bg-stone-50 border border-stone-100',
  /** 建议项 / 标签胶囊。 */
  chip: 'text-sm px-3 py-1.5 rounded-full border border-stone-200 bg-white hover:border-stagent-orange hover:bg-orange-50 transition-colors',
} as const

export const proTheme = {
  page: 'flex h-full min-h-0',
  card: 'border border-gray-200 rounded-lg p-4 bg-white',
} as const
