/* ------------------------------------------------------------------ */
/*  src/main/adapter/model-pool.ts                                     */
/*  M13: resource-pool granularity — site × model variant × tools.     */
/*                                                                      */
/*  A "virtual model id" (spec) encodes which site to use plus an       */
/*  optional in-site model variant and tool toggles:                    */
/*                                                                      */
/*    <base>                                  → site default            */
/*    <base>::model=<modelId>                 → switch to a model       */
/*    <base>::effort=<level>                   → set reasoning effort     */
/*    <base>::tool=<a>+<b>                     → enable tools a and b     */
/*    <base>::model=<m>::effort=<e>::tool=<a>  → all of the above        */
/*                                                                      */
/*  <base> is matched against siteId / activeModel / availableModels.id */
/*  / hostname (same order as before), so existing plain ids keep       */
/*  working unchanged.                                                  */
/* ------------------------------------------------------------------ */

import type { SiteConfig } from '../site-store'

const SEP = '::'

export interface ParsedModelSpec {
  /** The token used to locate the site (siteId / activeModel / model id / hostname). */
  base: string
  /** Requested in-site model variant id, if any. */
  modelId?: string
  /** Requested reasoning-effort level id, if any (e.g. 'high' | 'max'). */
  effort?: string
  /** Requested tool toggle ids (deduped, order-preserving). */
  tools: string[]
}

/** Parse a virtual model id into its base + optional model variant + effort + tools. */
export function parseModelSpec(spec: string): ParsedModelSpec {
  const parts = (spec ?? '').split(SEP)
  const base = parts[0] ?? ''
  let modelId: string | undefined
  let effort: string | undefined
  const tools: string[] = []
  for (const part of parts.slice(1)) {
    if (part.startsWith('model=')) {
      const v = part.slice('model='.length)
      if (v) modelId = v
    } else if (part.startsWith('effort=')) {
      const v = part.slice('effort='.length)
      if (v) effort = v
    } else if (part.startsWith('tool=')) {
      for (const t of part.slice('tool='.length).split('+')) {
        if (t && !tools.includes(t)) tools.push(t)
      }
    }
  }
  return { base, modelId, effort, tools }
}

/** Build a virtual model id from a base and optional variant/effort/tools. */
export function formatModelSpec(
  base: string,
  modelId?: string,
  tools: string[] = [],
  effort?: string,
): string {
  let out = base
  if (modelId) out += `${SEP}model=${modelId}`
  if (effort) out += `${SEP}effort=${effort}`
  if (tools.length) out += `${SEP}tool=${tools.join('+')}`
  return out
}

/** Resolve which site a virtual model id refers to. */
export function pickSiteForModel(sites: SiteConfig[], spec: string): SiteConfig | undefined {
  const { base } = parseModelSpec(spec)
  const needle = (base || '').toLowerCase()
  return (
    sites.find((s) => s.siteId === base) ||
    sites.find((s) => s.activeModel === base) ||
    sites.find((s) => s.availableModels?.some((m) => m.id === base)) ||
    sites.find((s) => s.hostname.includes(needle))
  )
}

export interface PoolModelEntry {
  /** Virtual model id (the spec). */
  id: string
  /** Human-readable label, e.g. "Gemini · 3.1 Pro" or "DeepSeek · 深度思考". */
  label: string
  siteId: string
  hostname: string
  createdAt: number
}

/**
 * Expand a single site into its pool entries:
 *   • the site default (base id = activeModel || siteId),
 *   • one entry per switchable model variant (when a model switcher exists),
 *   • one entry per tool toggle.
 * Combined model+tools specs are still accepted by parseModelSpec even though
 * they are not pre-enumerated here (keeps the catalogue bounded).
 */
export function expandSiteModels(site: SiteConfig): PoolModelEntry[] {
  const out: PoolModelEntry[] = []
  const createdAt = site.addedAt || Date.now()
  const base = site.activeModel || site.siteId

  out.push({ id: base, label: site.label, siteId: site.siteId, hostname: site.hostname, createdAt })

  if (site.modelSwitcherSelector && site.availableModels?.length) {
    for (const m of site.availableModels) {
      out.push({
        id: formatModelSpec(site.siteId, m.id),
        label: `${site.label} · ${m.label}`,
        siteId: site.siteId,
        hostname: site.hostname,
        createdAt,
      })
    }
  }

  for (const e of site.effortLevels ?? []) {
    out.push({
      id: formatModelSpec(site.siteId, undefined, [], e.id),
      label: `${site.label} · 思考强度 ${e.label}`,
      siteId: site.siteId,
      hostname: site.hostname,
      createdAt,
    })
  }

  for (const t of site.toolToggles ?? []) {
    out.push({
      id: formatModelSpec(site.siteId, undefined, [t.id]),
      label: `${site.label} · ${t.label}`,
      siteId: site.siteId,
      hostname: site.hostname,
      createdAt,
    })
  }

  return out
}

// ─── 缺口2: cross-account "pool groups" (任一账号 · 自动轮转) ──────────────────

const POOL_PREFIX = 'pool:'

/** Build a pool-group id that matches ANY account on a hostname, e.g.
 *  `pool:claude.ai::model=claude-sonnet-4-6::effort=max`. */
export function formatPoolGroupSpec(
  hostname: string,
  modelId?: string,
  tools: string[] = [],
  effort?: string,
): string {
  return POOL_PREFIX + formatModelSpec(hostname, modelId, tools, effort)
}

/** True when the spec is a cross-account pool group (vs a concrete account spec). */
export function isPoolGroupSpec(spec: string): boolean {
  return (spec ?? '').startsWith(POOL_PREFIX)
}

export interface ParsedPoolGroupSpec {
  hostname: string
  modelId?: string
  effort?: string
  tools: string[]
}

/** Parse a pool-group id into hostname + optional model/effort/tools. */
export function parsePoolGroupSpec(spec: string): ParsedPoolGroupSpec {
  const inner = (spec ?? '').slice(POOL_PREFIX.length)
  const p = parseModelSpec(inner)
  return { hostname: p.base, modelId: p.modelId, effort: p.effort, tools: p.tools }
}

/**
 * Resolve a pool-group id to the ordered list of accounts that can serve it.
 * Filters by hostname + requested model/effort/tool support, then orders
 * non-exhausted accounts first (then oldest first) so rotation prefers fresh
 * accounts and falls through to others as each hits its quota.
 */
export function resolvePoolGroup(sites: SiteConfig[], spec: string): SiteConfig[] {
  const { hostname, modelId, effort, tools } = parsePoolGroupSpec(spec)
  let cands = sites.filter((s) => s.hostname === hostname)
  if (modelId) {
    cands = cands.filter((s) => s.modelSwitcherSelector && s.availableModels?.some((m) => m.id === modelId))
  }
  if (effort) {
    cands = cands.filter((s) => s.effortLevels?.some((e) => e.id === effort))
  }
  if (tools.length) {
    cands = cands.filter((s) => tools.every((t) => s.toolToggles?.some((tt) => tt.id === t)))
  }
  return cands
    .slice()
    .sort(
      (a, b) =>
        Number(!!a.quotaExhausted) - Number(!!b.quotaExhausted) || a.addedAt - b.addedAt,
    )
}

/** The concrete per-account spec a pool group resolves to for a given site. */
export function poolGroupToConcrete(site: SiteConfig, spec: string): string {
  const { modelId, effort, tools } = parsePoolGroupSpec(spec)
  return formatModelSpec(site.siteId, modelId, tools, effort)
}

/**
 * Expand the accounts that share a hostname into pool-group entries (任一账号·
 * 自动轮转). Same-hostname accounts share a preset, so a representative site's
 * capabilities define the variants. Only emitted when ≥2 accounts exist for the
 * hostname (with one account there is nothing to rotate to).
 */
function expandHostnamePool(hostname: string, sites: SiteConfig[]): PoolModelEntry[] {
  const rep = sites[0]
  if (sites.length < 2 || !rep) return []
  const createdAt = Math.min(...sites.map((s) => s.addedAt || Date.now()))
  const hostnameLabel = rep.label.split(/\s+/)[0] || hostname
  const group = `${hostnameLabel}·任一账号`
  const mk = (id: string, suffix?: string): PoolModelEntry => ({
    id,
    label: suffix ? `${group} · ${suffix}` : group,
    siteId: '',
    hostname,
    createdAt,
  })

  const out: PoolModelEntry[] = [mk(formatPoolGroupSpec(hostname))]
  if (rep.modelSwitcherSelector && rep.availableModels?.length) {
    for (const m of rep.availableModels) {
      out.push(mk(formatPoolGroupSpec(hostname, m.id), m.label))
    }
  }
  for (const e of rep.effortLevels ?? []) {
    out.push(mk(formatPoolGroupSpec(hostname, undefined, [], e.id), `思考强度 ${e.label}`))
  }
  for (const t of rep.toolToggles ?? []) {
    out.push(mk(formatPoolGroupSpec(hostname, undefined, [t.id]), t.label))
  }
  return out
}

/**
 * Expand every site into a flat pool catalogue: concrete per-account entries
 * first, then cross-account pool groups for hostnames with multiple accounts.
 */
export function expandPool(sites: SiteConfig[]): PoolModelEntry[] {
  const concrete = sites.flatMap((s) => expandSiteModels(s))
  const byHost = new Map<string, SiteConfig[]>()
  for (const s of sites) {
    const arr = byHost.get(s.hostname) ?? []
    arr.push(s)
    byHost.set(s.hostname, arr)
  }
  const pools = Array.from(byHost.entries()).flatMap(([host, group]) =>
    expandHostnamePool(host, group),
  )
  return [...concrete, ...pools]
}
