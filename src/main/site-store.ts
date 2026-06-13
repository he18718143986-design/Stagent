/* ------------------------------------------------------------------ */
/*  src/main/site-store.ts — Per-site SiteConfig persistence           */
/*  M10: siteId (UUID) replaces hostname as the primary key            */
/* ------------------------------------------------------------------ */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import log from 'electron-log'
import { findPreset } from './presets'

// ─── Types (co-located so main process does not import preload .d.ts) ───────

export type OutputType = 'text' | 'image' | 'video'

export interface SelectorStrategy {
  selector: string
  method: 'css' | 'text' | 'role' | 'testid' | 'xpath'
  priority: number
  lastWorked?: string
  failCount: number
}

export type SelectorChain = SelectorStrategy[]

/** M11: Metadata for a single selectable AI model (see §2.9) */
export interface ModelOption {
  id: string       // e.g. 'gpt-4o'
  label: string    // Display name, e.g. 'GPT-4o'
  selector?: string  // CSS selector for the option element inside the model dropdown
}

/**
 * M12: A one-click composer tool that can be turned on/off, e.g. "深度思考"
 * (extended reasoning) or "联网搜索" (web search). Driven by chat:toggle-tool.
 *
 * Two layouts are supported:
 *   • Direct composer button (e.g. DeepSeek): only `selector` is needed; the
 *     on/off state is read from aria-pressed / aria-checked / an active class.
 *   • Menu item (e.g. ChatGPT "+" menu): set `menuTriggerSelector` to the
 *     button that opens the menu first; the tool item is then matched by
 *     `selector` or by visible text === `label`.
 */
export interface ToolToggle {
  /** Stable id, e.g. 'deepThink' | 'webSearch' | 'deepResearch'. */
  id: string
  /** Display label; also used for text-matching the control in the page. */
  label: string
  /** CSS selector (or `text=<substring>`) for the toggle control. */
  selector: string
  /** Optional: click this first to open the menu containing the tool item. */
  menuTriggerSelector?: string
}

/**
 * M13: A reasoning-effort tier (e.g. Claude's Effort: Low / Medium / High / Max).
 * Unlike a boolean ToolToggle, effort is a single-choice tier; selecting one
 * deselects the others. The level usually lives inside the model picker, so the
 * apply action opens `modelSwitcherSelector` first, optionally opens an "Effort"
 * submenu (`effortMenuTriggerSelector`), then clicks the level by selector/text.
 */
export interface EffortLevel {
  /** Stable id, e.g. 'low' | 'medium' | 'high' | 'max'. */
  id: string
  /** Display/menu label, e.g. 'High'. Also used for text-matching the option. */
  label: string
  /** Optional CSS selector (or `text=<substring>`) for the level option. */
  selector?: string
}

export interface SiteConfig {
  /** Stable unique ID (UUID). Primary key — never changes after creation. */
  siteId: string
  /** The domain, e.g. 'chatgpt.com'. Multiple sites can share the same hostname. */
  hostname: string
  /** Human-readable name, e.g. 'ChatGPT 工作' or 'ChatGPT 个人'. */
  label: string
  url: string
  outputType: OutputType
  inputSelectors: SelectorChain
  sendSelectors: SelectorChain
  responseSelectors: SelectorChain
  quotaExhaustedIndicator?: string
  fileUploadTrigger?: string
  /** M11: Selector for the button that opens the model picker dropdown. Empty = no model switching. */
  modelSwitcherSelector?: string
  /** M11: Known available models for this account (from presets; manual editing TBD). */
  availableModels?: ModelOption[]
  /** M11: Currently selected model ID (e.g. 'gpt-4o'). undefined = use the AI site's default. */
  activeModel?: string
  /** M12: One-click composer tools (深度思考 / 联网搜索 …). Empty = none. */
  toolToggles?: ToolToggle[]
  /** M12: Tool ids the user wants ON; ensured before each task-execution send. */
  activeTools?: string[]
  /** M13: Reasoning-effort tiers (e.g. Claude Effort Low/Medium/High/Max). Empty = none. */
  effortLevels?: EffortLevel[]
  /** M13: Optional submenu trigger (inside the model picker) that reveals the effort levels. */
  effortMenuTriggerSelector?: string
  /** M13: Currently selected effort level id. undefined = use the site default. */
  activeEffort?: string
  /** §2.3-bis: URL pattern (regex string) for the SSE/streaming response.
   *  When set, network-interceptor.ts is used as the primary reply-detection path.
   *  Empty/undefined = fall back to DOM stability watcher (response-watcher.ts). */
  ssePattern?: string
  /** §2.3-bis: JS function body string for extracting incremental text from one SSE data line.
   *  Receives: line (raw SSE data value, without "data: " prefix).
   *  Returns: string chunk | null (null = skip this line).
   *  Compiled via new Function('line', body) in the main process. */
  sseDataExtractor?: string
  calibrated: boolean
  addedAt: number
  /** Persisted. true = quota was exhausted last time the site was used. */
  quotaExhausted?: boolean
  /** Persisted. true = site was connected (loginActive) when the app was last closed.
   *  Used to restore connected state immediately on re-activation without waiting for probe. */
  connected?: boolean
}

export type SiteStatus = 'connected' | 'disconnected' | 'quota-exhausted' | 'loading'

export interface SiteWithStatus extends SiteConfig {
  status: SiteStatus
}

export interface SelectorFields {
  inputSelectors?: SelectorChain
  sendSelectors?: SelectorChain
  responseSelectors?: SelectorChain
  quotaExhaustedIndicator?: string
  fileUploadTrigger?: string
}

// Unified output type for chat:reply (co-located to avoid preload import in main)
export interface AutomationResult {
  outputType: OutputType
  quotaExhausted?: boolean
  text?: string
  imageUrls?: string[]
  videoUrl?: string
}

// ─── SiteStore ───────────────────────────────────────────────────────────────

// ─── Response selector sanitizer ─────────────────────────────────────────────

/**
 * Cleans a responseSelectors chain of over-specific calibration selectors
 * that tend to match author-header elements ("ChatGPT 说：") instead of body
 * text.
 *
 * Rules (applied to each selector string):
 *   REMOVE if:
 *     • Contains ≥ 3 occurrences of :nth-of-type( or :nth-child( (structurally
 *       over-specific — almost certainly a one-time calibration hit)
 *     • Contains ≥ 6 child-combinator › (">") tokens (very deep CSS path)
 *   KEEP if:
 *     • Selector contains "prose" (e.g. div.markdown.prose, [class*="prose"])
 *       — these are always reliable ChatGPT body-text selectors.
 *
 * Additionally:
 *   • Deduplicates by selector string (first occurrence wins, priority preserved).
 *   • Does NOT modify input/send chains.
 *   • Returns an empty chain rather than fabricating selectors when everything
 *     is removed — existing detector/preset logic will back-fill.
 *
 * Exported for unit-testing without a full store instance.
 */
export function sanitizeResponseSelectors(chain: SelectorChain): SelectorChain {
  const seen = new Set<string>()
  const result: SelectorChain = []
  for (const entry of chain) {
    const sel = entry.selector
    // Dedup
    if (seen.has(sel)) continue
    seen.add(sel)
    // Selectors containing "prose" are always kept (high-confidence body selectors)
    if (sel.includes('prose')) { result.push(entry); continue }
    // Count structural specificity markers
    const nthCount = (sel.match(/:nth-(?:of-type|child)\(/g) ?? []).length
    const arrowCount = (sel.match(/>/g) ?? []).length
    if (nthCount >= 3 || arrowCount >= 6) continue  // too specific — drop
    result.push(entry)
  }
  return result
}

export class SiteStore {
  private readonly filePath: string
  /** Primary key: siteId → SiteConfig */
  private data: Map<string, SiteConfig>

  constructor(userDataDir: string) {
    this.filePath = join(userDataDir, 'sites.json')
    this.data = new Map()
    this.load()
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  get(siteId: string): SiteConfig | undefined {
    return this.data.get(siteId)
  }

  list(): SiteConfig[] {
    return Array.from(this.data.values()).sort((a, b) => a.addedAt - b.addedAt)
  }

  has(siteId: string): boolean {
    return this.data.has(siteId)
  }

  // ── Write ─────────────────────────────────────────────────────────────────

  /**
   * Add a new site record. Each call always creates a new entry with a fresh
   * siteId — callers are responsible for dedup UI if desired.
   * Merges preset selectors when available.
   */
  add(url: string, label?: string): SiteConfig {
    const hostname = new URL(url).hostname
    const siteId = randomUUID()

    const preset = findPreset(hostname)
    const config: SiteConfig = {
      siteId,
      hostname,
      label: label ?? preset?.label ?? hostname,
      url: preset?.url ?? url,
      outputType: 'text',
      inputSelectors: preset?.inputSelectors ?? [],
      sendSelectors: preset?.sendSelectors ?? [],
      responseSelectors: preset?.responseSelectors ?? [],
      quotaExhaustedIndicator: preset?.quotaExhaustedIndicator,
      // M11: propagate model-switcher data from preset (user can override via Selector Debugger)
      ...(preset?.modelSwitcherSelector && { modelSwitcherSelector: preset.modelSwitcherSelector }),
      ...(preset?.availableModels?.length && { availableModels: preset.availableModels }),
      // M12: propagate one-click tool toggles from preset
      ...(preset?.toolToggles?.length && { toolToggles: preset.toolToggles }),
      // M13: propagate reasoning-effort tiers from preset
      ...(preset?.effortLevels?.length && { effortLevels: preset.effortLevels }),
      ...(preset?.effortMenuTriggerSelector && {
        effortMenuTriggerSelector: preset.effortMenuTriggerSelector,
      }),
      // §2.3-bis: propagate SSE interception config from preset
      ...(preset?.ssePattern && { ssePattern: preset.ssePattern }),
      ...(preset?.sseDataExtractor && { sseDataExtractor: preset.sseDataExtractor }),
      calibrated: false,
      addedAt: Date.now(),
    }

    this.data.set(siteId, config)
    this.save()
    log.info('site:add', { siteId, hostname })
    return config
  }

  remove(siteId: string): void {
    this.data.delete(siteId)
    this.save()
    log.info('site:remove', { siteId })
  }

  /** Rename the label of a site. */
  rename(siteId: string, label: string): void {
    const config = this.data.get(siteId)
    if (!config) return
    config.label = label.trim() || config.label
    this.save()
    log.info('site-store: renamed', { siteId, label: config.label })
  }

  /** M11: Persist the user's selected model for a site. */
  setActiveModel(siteId: string, modelId: string): void {
    const config = this.data.get(siteId)
    if (!config) return
    config.activeModel = modelId
    this.save()
    log.info('site-store: activeModel', { siteId, modelId })
  }

  /** M13: Persist the user's selected reasoning-effort tier for a site. */
  setActiveEffort(siteId: string, effortId: string): void {
    const config = this.data.get(siteId)
    if (!config) return
    if (!config.effortLevels?.some((e) => e.id === effortId)) return
    config.activeEffort = effortId
    this.save()
    log.info('site-store: activeEffort', { siteId, effortId })
  }

  /**
   * M12: Persist whether a one-click tool (深度思考 / 联网搜索 …) should be ON.
   * Maintains `activeTools` as a deduped set; only ids present in `toolToggles`
   * are accepted. Returns the resulting active-tools array.
   */
  setToolActive(siteId: string, toolId: string, enabled: boolean): string[] {
    const config = this.data.get(siteId)
    if (!config) return []
    const known = config.toolToggles?.some((t) => t.id === toolId)
    if (!known) return config.activeTools ?? []
    const set = new Set(config.activeTools ?? [])
    if (enabled) set.add(toolId)
    else set.delete(toolId)
    config.activeTools = set.size ? Array.from(set) : undefined
    this.save()
    log.info('site-store: toolActive', { siteId, toolId, enabled })
    return config.activeTools ?? []
  }

  /** Set or clear the persistent last-connected flag (used to restore loginActive on re-activation). */
  setConnected(siteId: string, connected: boolean): void {
    const config = this.data.get(siteId)
    if (!config) return
    config.connected = connected || undefined // keep JSON tidy: omit when false
    this.save()
    log.debug('site-store: connected', { siteId, connected })
  }

  /** Set or clear the persistent quota-exhausted flag. */
  setQuotaExhausted(siteId: string, value: boolean): void {
    const config = this.data.get(siteId)
    if (!config) return
    config.quotaExhausted = value || undefined // keep JSON tidy: omit when false
    this.save()
    log.info('site-store: quotaExhausted', { siteId, value })
  }

  /**
   * §P1 selector health: mark one or more selectors as successfully used.
   * Resets failCount to 0 and stamps lastWorked with the current ISO timestamp.
   * Searches all three chains (input/send/response) so callers don't need to
   * know which chain a selector belongs to.
   */
  recordSelectorSuccess(siteId: string, ...usedSelectors: (string | undefined)[]): void {
    const config = this.data.get(siteId)
    if (!config) return
    const now = new Date().toISOString()
    let changed = false
    for (const usedSel of usedSelectors) {
      if (!usedSel) continue
      for (const chain of [config.inputSelectors, config.sendSelectors, config.responseSelectors]) {
        for (const entry of chain) {
          if (entry.selector === usedSel) {
            entry.lastWorked = now
            entry.failCount = 0
            changed = true
          }
        }
      }
    }
    if (changed) this.save()
  }

  /**
   * Merge-update fields from detector (auto-detect) or user (calibration/debugger).
   * Calibration protection: if calibrated === true, detector CANNOT overwrite
   * inputSelectors / sendSelectors / responseSelectors.
   */
  updateSelectors(
    siteId: string,
    fields: SelectorFields,
    source: 'detector' | 'user',
  ): void {
    const config = this.data.get(siteId)
    if (!config) return

    const isProtected = config.calibrated && source === 'detector'

    if (!isProtected) {
      if (fields.inputSelectors !== undefined) config.inputSelectors = fields.inputSelectors
      if (fields.sendSelectors !== undefined) config.sendSelectors = fields.sendSelectors
      if (fields.responseSelectors !== undefined) {
        const cleaned = sanitizeResponseSelectors(fields.responseSelectors)
        if (cleaned.length !== fields.responseSelectors.length) {
          log.info('site-store: sanitized responseSelectors on write', {
            siteId,
            beforeCount: fields.responseSelectors.length,
            afterCount: cleaned.length,
          })
        }
        config.responseSelectors = cleaned
      }
    } else {
      log.info('site-store: skipping calibrated fields (source=detector)', { siteId })
    }

    // These fields are never protected — user or detector can always update
    if (fields.quotaExhaustedIndicator !== undefined)
      config.quotaExhaustedIndicator = fields.quotaExhaustedIndicator
    if (fields.fileUploadTrigger !== undefined)
      config.fileUploadTrigger = fields.fileUploadTrigger

    if (source === 'user') {
      config.calibrated = true
    }

    this.save()
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  private load(): void {
    try {
      if (!existsSync(this.filePath)) return
      const raw = readFileSync(this.filePath, 'utf8')
      const arr = JSON.parse(raw) as SiteConfig[]
      for (const item of arr) {
        // Backward compat: old records without siteId get a stable UUID on upgrade
        if (!item.siteId) {
          (item as SiteConfig).siteId = randomUUID()
        }
        // Backward compat: inject preset selectors for old records that have none
        if (
          item.inputSelectors.length === 0 &&
          item.sendSelectors.length === 0 &&
          item.responseSelectors.length === 0 &&
          !item.calibrated
        ) {
          const preset = findPreset(item.hostname)
          if (preset) {
            item.inputSelectors = preset.inputSelectors
            item.sendSelectors = preset.sendSelectors
            item.responseSelectors = preset.responseSelectors
            if (preset.quotaExhaustedIndicator && !item.quotaExhaustedIndicator) {
              item.quotaExhaustedIndicator = preset.quotaExhaustedIndicator
            }
            log.info('site-store: injected preset selectors for legacy record', {
              siteId: item.siteId,
              hostname: item.hostname,
            })
          }
        }
        // Backward compat: inject modelSwitcherSelector and availableModels from
        // preset for records that pre-date M11.  Only fills in missing fields —
        // never overwrites if the user has already customised them.
        if (!item.modelSwitcherSelector || !item.availableModels?.length) {
          const preset = findPreset(item.hostname)
          if (preset) {
            if (!item.modelSwitcherSelector && preset.modelSwitcherSelector) {
              item.modelSwitcherSelector = preset.modelSwitcherSelector
            }
            if (!item.availableModels?.length && preset.availableModels?.length) {
              item.availableModels = preset.availableModels
            }
          }
        }
        // M12: inject tool toggles from preset for records that pre-date M12.
        if (!item.toolToggles?.length) {
          const preset = findPreset(item.hostname)
          if (preset?.toolToggles?.length) {
            item.toolToggles = preset.toolToggles
          }
        }
        // M13: inject reasoning-effort tiers from preset for pre-M13 records.
        if (!item.effortLevels?.length) {
          const preset = findPreset(item.hostname)
          if (preset?.effortLevels?.length) {
            item.effortLevels = preset.effortLevels
            if (!item.effortMenuTriggerSelector && preset.effortMenuTriggerSelector) {
              item.effortMenuTriggerSelector = preset.effortMenuTriggerSelector
            }
          }
        }
        this.data.set(item.siteId, item)
      }
      // Sanitize responseSelectors across all loaded records — removes over-specific
      // calibration paths that match author-header elements.  Saves once if anything changed.
      let sanitizeChanged = false
      for (const [siteId, config] of this.data) {
        const cleaned = sanitizeResponseSelectors(config.responseSelectors)
        const beforeCount = config.responseSelectors.length
        const afterCount = cleaned.length
        if (beforeCount !== afterCount || cleaned.some((e, i) => e.selector !== config.responseSelectors[i]?.selector)) {
          config.responseSelectors = cleaned
          sanitizeChanged = true
          log.info('site-store: sanitized responseSelectors', { siteId, beforeCount, afterCount })
        }
      }
      if (sanitizeChanged) this.save()
      log.info('site-store: loaded', { count: this.data.size })
    } catch (err) {
      log.warn('site-store: load failed, starting fresh', { err: String(err) })
    }
  }

  private save(): void {
    try {
      const dir = dirname(this.filePath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(this.filePath, JSON.stringify(this.list(), null, 2), 'utf8')
    } catch (err) {
      log.error('site-store: save failed', { err: String(err) })
    }
  }
}
