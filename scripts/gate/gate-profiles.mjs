import { LIVE_TASK_TIERS } from '../headless/lib/live-tasks.mjs'

/** @param {string|number|undefined} raw */
export function parseTaskArg(raw) {
  if (raw == null || raw === '') return 4
  const s = String(raw).toLowerCase().replace(/^t/, '')
  const tier = Number(s)
  if (!Number.isFinite(tier) || !LIVE_TASK_TIERS[tier]) {
    throw new Error(`未知 --task：${raw}（支持 t4|t5|t6|t7 或 4–7）`)
  }
  return tier
}

const T4_HYBRID_GATE = {
  requireFixturesOnDisk: true,
  requireDefaultMainExit0: true,
  minSignals: 1,
  forbidCtp: true,
  requireE2eTest: true,
}

const PLATFORM_HYBRID_GATE = {
  forbidCtp: true,
}

/** JSON task.json 中的 pattern → RegExp */
export function hydrateTraceabilityRules(rules) {
  if (!rules) return rules
  return rules.map((r) => {
    if (typeof r.check === 'function') return r
    const out = { ...r }
    if (r.pattern && typeof r.pattern === 'object' && r.pattern.source) {
      out.pattern = new RegExp(r.pattern.source, r.pattern.flags ?? '')
    }
    return out
  })
}

/**
 * 从 live tier / bundle 组装 strict gate 选项（SSOT：live-tasks + mvp-acceptance）。
 * @param {{ tier: number, bundle?: { taskId?: string, tier?: number, mvp?: object } | null }} input
 */
export function resolveStrictGateOpts({ tier, bundle = null }) {
  const spec = LIVE_TASK_TIERS[tier]
  if (!spec) throw new Error(`未知 tier ${tier}`)

  const mvp = bundle?.mvp ?? spec.mvp ?? {}
  const traceability = hydrateTraceabilityRules(mvp.traceability)

  /** @type {Record<string, unknown>} */
  const opts = {
    taskId: bundle?.taskId ?? spec.id,
    outcome: 'workflowCompleted',
    requireTraceability: true,
    moduleDirs: mvp.moduleDirs,
    traceabilityRules: traceability,
    fixtures: mvp.fixtures,
    smoke: mvp.smoke,
    architectureScan: mvp.architectureScan,
  }

  if (tier === 4 || tier === 5) {
    opts.hybridGate = { ...T4_HYBRID_GATE }
  } else if (tier === 6 || tier === 7) {
    opts.hybridGate = { ...PLATFORM_HYBRID_GATE }
  }

  return opts
}
