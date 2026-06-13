/* ------------------------------------------------------------------ */
/*  model-grouping.ts — 渲染层把扁平模型列表折叠成「站点 → 档位/工具」分组 */
/*                                                                     */
/*  M13 把资源池细化为「站点 × 模型档位 × 工具组合」，导致 getControls   */
/*  返回的 models 会随站点数线性变长。AI 控制面板用本助手按站点聚合，    */
/*  渲染为 <optgroup>，使同一站点的 base/档位/工具收拢到一个分组标题下。  */
/*                                                                     */
/*  纯函数、无 React / Node 依赖，便于单测。分组键完全来自 name 文案：    */
/*  本地适配器模型名形如「🌐 <站点> · <档位>（本地浏览器）」，站点前缀即  */
/*  稳定分组键（不依赖 family 里的 siteId/activeModel 差异）。           */
/* ------------------------------------------------------------------ */

export interface FlatModelOption {
  id: string
  name: string
}

export interface GroupedModelOption {
  id: string
  /** 组内显示文案：默认档显示「默认」，其余显示档位/工具名。 */
  text: string
}

export interface ModelGroup {
  /** 去重用的稳定键。 */
  key: string
  /** 分组标题（站点名，或通用组标题）。 */
  label: string
  options: GroupedModelOption[]
}

const LOCAL_PREFIX = '🌐 '
const LOCAL_SUFFIX = '（本地浏览器）'
const VARIANT_SEP = ' · '
/** 真实 API / chain 自动等非本地 family 归入通用组。 */
const GENERIC_KEY = '__generic__'
const GENERIC_LABEL = '默认 · 真实 API / 自动'

/** 从本地模型显示名里剥离装饰，拆出「站点 · 档位」两段。 */
function parseLocalName(name: string): { siteLabel: string; variant: string } {
  let core = name
  if (core.startsWith(LOCAL_PREFIX)) core = core.slice(LOCAL_PREFIX.length)
  if (core.endsWith(LOCAL_SUFFIX)) core = core.slice(0, core.length - LOCAL_SUFFIX.length)
  core = core.trim()
  const sep = core.indexOf(VARIANT_SEP)
  if (sep < 0) return { siteLabel: core, variant: '' }
  return { siteLabel: core.slice(0, sep).trim(), variant: core.slice(sep + VARIANT_SEP.length).trim() }
}

/**
 * 把扁平模型列表按站点折叠成分组。
 * - 非本地 family（chain:* / direct:* 等）收进单一「通用」组并置顶。
 * - 本地 family（local:*）按显示名里的站点前缀聚合，组内 base 显示为「默认」。
 * 组顺序：通用组（若有）在前，其余站点按首次出现顺序保持稳定。
 */
export function groupModels(models: FlatModelOption[]): ModelGroup[] {
  const groups = new Map<string, ModelGroup>()
  const order: string[] = []
  const ensure = (key: string, label: string): ModelGroup => {
    let g = groups.get(key)
    if (!g) {
      g = { key, label, options: [] }
      groups.set(key, g)
      order.push(key)
    }
    return g
  }

  for (const m of models) {
    if (m.id.startsWith('local:')) {
      // 缺口2: `local:pool:*` 是「任一账号·自动轮转」档位组，用 🔁 与「指定账号」
      // 分开展示；其余 local:* 是某个具体账号。
      const isPool = m.id.startsWith('local:pool:')
      const { siteLabel, variant } = parseLocalName(m.name)
      const key = isPool ? `pool:${siteLabel}` : `site:${siteLabel}`
      const label = isPool ? `🔁 ${siteLabel}` : `${LOCAL_PREFIX}${siteLabel}`
      const g = ensure(key, label)
      g.options.push({ id: m.id, text: variant || '默认' })
    } else {
      const g = ensure(GENERIC_KEY, GENERIC_LABEL)
      g.options.push({ id: m.id, text: m.name })
    }
  }

  // 通用组（默认/真实 API）始终置顶，其余保持出现顺序。
  return order
    .slice()
    .sort((a, b) => (a === GENERIC_KEY ? -1 : b === GENERIC_KEY ? 1 : 0))
    .map((k) => groups.get(k) as ModelGroup)
}
