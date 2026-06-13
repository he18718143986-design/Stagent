/**
 * Writes a sites.json fixture into a temp userData directory so the app
 * launches with pre-populated site records (skipping the onboarding flow).
 *
 * Pass the mock server URL returned by startMockServer().
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export interface SeedToolToggle {
  id: string
  label: string
  selector: string
  menuTriggerSelector?: string
}

export interface SeedModelOption {
  id: string
  label: string
  selector?: string
}

export interface SeedEffortLevel {
  id: string
  label: string
  selector?: string
}

export interface SeedSiteOptions {
  siteId?: string
  hostname?: string
  label?: string
  /** Whether to mark the site as quota-exhausted */
  quotaExhausted?: boolean
  /** Runtime quota indicator (e.g. 'text=QUOTA_LIMIT_HIT') matched on the page. */
  quotaExhaustedIndicator?: string
  /** M12: one-click tools to seed onto the site. */
  toolToggles?: SeedToolToggle[]
  /** M12: tool ids that should be ON (re-applied before task-execution sends). */
  activeTools?: string[]
  /** M13: model switcher button selector. */
  modelSwitcherSelector?: string
  /** M13: switchable models for the site. */
  availableModels?: SeedModelOption[]
  /** M13: reasoning-effort tiers (e.g. Claude Effort Low/Medium/High/Max). */
  effortLevels?: SeedEffortLevel[]
  /** M13: submenu trigger (inside the model picker) that reveals the effort tiers. */
  effortMenuTriggerSelector?: string
}

const selector = (sel: string, priority = 5): { selector: string; method: 'css'; priority: number; failCount: number } => ({
  selector: sel,
  method: 'css',
  priority,
  failCount: 0,
})

/** Build one site record (matches the HTML served by mock-site.ts). */
function buildMockSite(siteUrl: string, opts: SeedSiteOptions, index = 0): Record<string, unknown> {
  const siteId = opts.siteId ?? `aaaaaaaa-0000-0000-0000-00000000000${index + 1}`
  const hostname = opts.hostname ?? '127.0.0.1'
  const label = opts.label ?? 'Mock AI'
  return {
    siteId,
    hostname,
    label,
    url: siteUrl,
    outputType: 'text',
    inputSelectors: [selector('#ai-input')],
    sendSelectors: [selector('#ai-send')],
    responseSelectors: [selector('.ai-message')],
    calibrated: false,
    addedAt: Date.now() + index, // keep a stable, distinct order across accounts
    ...(opts.quotaExhausted ? { quotaExhausted: true } : {}),
    ...(opts.quotaExhaustedIndicator
      ? { quotaExhaustedIndicator: opts.quotaExhaustedIndicator }
      : {}),
    ...(opts.toolToggles?.length ? { toolToggles: opts.toolToggles } : {}),
    ...(opts.activeTools?.length ? { activeTools: opts.activeTools } : {}),
    ...(opts.modelSwitcherSelector ? { modelSwitcherSelector: opts.modelSwitcherSelector } : {}),
    ...(opts.availableModels?.length ? { availableModels: opts.availableModels } : {}),
    ...(opts.effortLevels?.length ? { effortLevels: opts.effortLevels } : {}),
    ...(opts.effortMenuTriggerSelector
      ? { effortMenuTriggerSelector: opts.effortMenuTriggerSelector }
      : {}),
  }
}

/**
 * Seeds the userData dir with a single mock-site entry.
 * Uses selector names that match the HTML served by mock-site.ts.
 */
export function seedMockSite(
  userDataDir: string,
  siteUrl: string,
  opts: SeedSiteOptions = {},
): string {
  const site = buildMockSite(siteUrl, opts)
  mkdirSync(userDataDir, { recursive: true })
  writeFileSync(join(userDataDir, 'sites.json'), JSON.stringify([site], null, 2))
  return site['siteId'] as string
}

/**
 * Seeds the userData dir with multiple mock-site accounts (e.g. several accounts
 * on the same hostname to exercise cross-account pool rotation).
 */
export function seedMockSites(
  userDataDir: string,
  entries: Array<{ url: string; opts: SeedSiteOptions }>,
): string[] {
  const sites = entries.map((e, i) => buildMockSite(e.url, e.opts, i))
  mkdirSync(userDataDir, { recursive: true })
  writeFileSync(join(userDataDir, 'sites.json'), JSON.stringify(sites, null, 2))
  return sites.map((s) => s['siteId'] as string)
}

/**
 * Seeds the userData dir with an empty sites.json (forces onboarding mode).
 */
export function seedEmpty(userDataDir: string): void {
  mkdirSync(userDataDir, { recursive: true })
  writeFileSync(join(userDataDir, 'sites.json'), JSON.stringify([]))
}
