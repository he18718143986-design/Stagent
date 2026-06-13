/* ------------------------------------------------------------------ */
/*  src/main/site-store.test.ts                                        */
/* ------------------------------------------------------------------ */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as os from 'node:os'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { SiteStore, sanitizeResponseSelectors } from './site-store'

// ── Mock electron-log (not available in Node.js test environment) ────────────
vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// ── Mock presets so tests are isolated from real preset data ─────────────────
vi.mock('./presets', () => ({
  findPreset: (hostname: string) => {
    if (hostname === 'preset.example.com') {
      return {
        hostname: 'preset.example.com',
        label: 'Preset Site',
        url: 'https://preset.example.com',
        inputSelectors: [{ selector: '#input', method: 'css', priority: 5, failCount: 0 }],
        sendSelectors: [{ selector: '#send', method: 'css', priority: 5, failCount: 0 }],
        responseSelectors: [{ selector: '.reply', method: 'css', priority: 5, failCount: 0 }],
        quotaExhaustedIndicator: 'text=Limit reached',
        toolToggles: [
          { id: 'deepThink', label: '深度思考', selector: 'text=深度思考' },
          { id: 'webSearch', label: '联网搜索', selector: 'text=联网搜索' },
        ],
      }
    }
    return undefined
  },
}))

// ─── Test helpers ─────────────────────────────────────────────────────────────

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'autoai-test-'))
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('SiteStore', () => {
  let dir: string
  let store: SiteStore

  beforeEach(() => {
    dir = tmpDir()
    store = new SiteStore(dir)
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  // ── add() ─────────────────────────────────────────────────────────────────

  it('add() — returns a SiteConfig with a siteId UUID', () => {
    const config = store.add('https://example.com')
    expect(config.siteId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
    expect(config.hostname).toBe('example.com')
  })

  it('add() — stores a new site and list() returns it', () => {
    store.add('https://example.com')
    const list = store.list()
    expect(list).toHaveLength(1)
    expect(list[0]!.hostname).toBe('example.com')
  })

  it('add() — two calls with same URL create two independent records', () => {
    const first = store.add('https://example.com')
    const second = store.add('https://example.com')
    expect(store.list()).toHaveLength(2)
    expect(first.siteId).not.toBe(second.siteId)
  })

  it('add() — throws on unparseable URL', () => {
    expect(() => store.add('not-a-url')).toThrow()
  })

  it('add() — merges preset selectors when available', () => {
    const config = store.add('https://preset.example.com')
    expect(config.label).toBe('Preset Site')
    expect(config.inputSelectors[0]?.selector).toBe('#input')
    expect(config.quotaExhaustedIndicator).toBe('text=Limit reached')
  })

  it('add() — leaves selectors empty when no preset exists', () => {
    const config = store.add('https://no-preset.example.com')
    expect(config.inputSelectors).toHaveLength(0)
    expect(config.sendSelectors).toHaveLength(0)
    expect(config.quotaExhaustedIndicator).toBeUndefined()
  })

  // ── remove() ──────────────────────────────────────────────────────────────

  it('remove() — existing site is deleted from list()', () => {
    const config = store.add('https://example.com')
    store.remove(config.siteId)
    expect(store.list()).toHaveLength(0)
  })

  it('remove() — non-existent siteId is silently ignored', () => {
    expect(() => store.remove('00000000-0000-0000-0000-000000000000')).not.toThrow()
    expect(store.list()).toHaveLength(0)
  })

  it('remove() — removes only the targeted site, not others with same hostname', () => {
    const a = store.add('https://example.com')
    const b = store.add('https://example.com')
    store.remove(a.siteId)
    const list = store.list()
    expect(list).toHaveLength(1)
    expect(list[0]!.siteId).toBe(b.siteId)
  })

  // ── updateSelectors() — calibrated protection ─────────────────────────────

  it('updateSelectors(source=detector) writes selectors when calibrated=false', () => {
    const config = store.add('https://example.com')
    store.updateSelectors(
      config.siteId,
      { inputSelectors: [{ selector: '#new', method: 'css', priority: 3, failCount: 0 }] },
      'detector',
    )
    const updated = store.get(config.siteId)!
    expect(updated.inputSelectors[0]?.selector).toBe('#new')
  })

  it('updateSelectors(source=detector) does NOT overwrite when calibrated=true', () => {
    const config = store.add('https://example.com')
    // Manually calibrate via user write first
    store.updateSelectors(
      config.siteId,
      { inputSelectors: [{ selector: '#user-input', method: 'css', priority: 10, failCount: 0 }] },
      'user',
    )
    // Now detector tries to overwrite
    store.updateSelectors(
      config.siteId,
      { inputSelectors: [{ selector: '#detector-input', method: 'css', priority: 3, failCount: 0 }] },
      'detector',
    )
    const updated = store.get(config.siteId)!
    expect(updated.inputSelectors[0]?.selector).toBe('#user-input')
  })

  it('updateSelectors(source=user) writes selectors and sets calibrated=true', () => {
    const config = store.add('https://example.com')
    store.updateSelectors(
      config.siteId,
      { inputSelectors: [{ selector: '#user-input', method: 'css', priority: 10, failCount: 0 }] },
      'user',
    )
    const updated = store.get(config.siteId)!
    expect(updated.inputSelectors[0]?.selector).toBe('#user-input')
    expect(updated.calibrated).toBe(true)
  })

  it('updateSelectors(source=user) overwrites even when calibrated=true', () => {
    const config = store.add('https://example.com')
    store.updateSelectors(config.siteId, {
      inputSelectors: [{ selector: '#first', method: 'css', priority: 10, failCount: 0 }],
    }, 'user')
    store.updateSelectors(config.siteId, {
      inputSelectors: [{ selector: '#second', method: 'css', priority: 10, failCount: 0 }],
    }, 'user')
    const updated = store.get(config.siteId)!
    expect(updated.inputSelectors[0]?.selector).toBe('#second')
  })

  // ── setQuotaExhausted() ───────────────────────────────────────────────────

  it('setQuotaExhausted(true) sets the flag', () => {
    const config = store.add('https://example.com')
    store.setQuotaExhausted(config.siteId, true)
    expect(store.get(config.siteId)!.quotaExhausted).toBe(true)
  })

  it('setQuotaExhausted(false) clears the flag', () => {
    const config = store.add('https://example.com')
    store.setQuotaExhausted(config.siteId, true)
    store.setQuotaExhausted(config.siteId, false)
    // Should be falsy (undefined or false)
    expect(store.get(config.siteId)!.quotaExhausted).toBeFalsy()
  })

  it('setQuotaExhausted on unknown siteId does not throw', () => {
    expect(() => store.setQuotaExhausted('00000000-0000-0000-0000-000000000000', true)).not.toThrow()
  })

  // ── Persistence ───────────────────────────────────────────────────────────

  it('data survives a new SiteStore instance reading the same directory', () => {
    const config = store.add('https://example.com')
    store.updateSelectors(config.siteId, {
      inputSelectors: [{ selector: '#persisted', method: 'css', priority: 10, failCount: 0 }],
    }, 'user')

    // Construct a fresh instance pointing at the same directory
    const store2 = new SiteStore(dir)
    const reloaded = store2.get(config.siteId)
    expect(reloaded).toBeDefined()
    expect(reloaded!.inputSelectors[0]?.selector).toBe('#persisted')
    expect(reloaded!.calibrated).toBe(true)
  })

  it('backward compat: old records without siteId get a UUID on load', () => {
    const legacyData = [
      {
        hostname: 'legacy.example.com',
        label: 'Legacy',
        url: 'https://legacy.example.com',
        outputType: 'text',
        inputSelectors: [],
        sendSelectors: [],
        responseSelectors: [],
        calibrated: false,
        addedAt: Date.now(),
      },
    ]
    fs.writeFileSync(
      path.join(dir, 'sites.json'),
      JSON.stringify(legacyData),
      'utf-8',
    )
    const store2 = new SiteStore(dir)
    const list = store2.list()
    expect(list).toHaveLength(1)
    expect(list[0]!.siteId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
    expect(list[0]!.hostname).toBe('legacy.example.com')
  })

  it('backward compat: old records with empty selectors get preset selectors injected on load', () => {
    // Simulate a record saved before M7 presets were introduced:
    // hostname matches a known preset, but all selector chains are empty.
    const legacyData = [
      {
        siteId: '00000000-0000-0000-0000-000000000001',
        hostname: 'preset.example.com',
        label: 'Preset Site',
        url: 'https://preset.example.com',
        outputType: 'text',
        inputSelectors: [],
        sendSelectors: [],
        responseSelectors: [],
        calibrated: false,
        addedAt: Date.now(),
      },
    ]
    fs.writeFileSync(path.join(dir, 'sites.json'), JSON.stringify(legacyData), 'utf-8')

    const store2 = new SiteStore(dir)
    const record = store2.get('00000000-0000-0000-0000-000000000001')!
    expect(record).toBeDefined()
    // Preset selectors should have been injected
    expect(record.inputSelectors[0]?.selector).toBe('#input')
    expect(record.sendSelectors[0]?.selector).toBe('#send')
    expect(record.responseSelectors[0]?.selector).toBe('.reply')
    expect(record.quotaExhaustedIndicator).toBe('text=Limit reached')
    // calibrated flag must remain false (preset injection is not user calibration)
    expect(record.calibrated).toBe(false)
  })

  it('backward compat: calibrated records are NOT overwritten by preset injection on load', () => {
    // A user-calibrated record with selectors should be left untouched even if
    // the hostname has a matching preset.
    const legacyData = [
      {
        siteId: '00000000-0000-0000-0000-000000000002',
        hostname: 'preset.example.com',
        label: 'Preset Site',
        url: 'https://preset.example.com',
        outputType: 'text',
        inputSelectors: [{ selector: '#calibrated', method: 'css', priority: 10, failCount: 0 }],
        sendSelectors: [],
        responseSelectors: [],
        calibrated: true,
        addedAt: Date.now(),
      },
    ]
    fs.writeFileSync(path.join(dir, 'sites.json'), JSON.stringify(legacyData), 'utf-8')

    const store2 = new SiteStore(dir)
    const record = store2.get('00000000-0000-0000-0000-000000000002')!
    // User's calibrated selector must not be overwritten by the preset
    expect(record.inputSelectors[0]?.selector).toBe('#calibrated')
    expect(record.calibrated).toBe(true)
  })

  it('backward compat: records with no matching preset keep empty selectors', () => {
    const legacyData = [
      {
        siteId: '00000000-0000-0000-0000-000000000003',
        hostname: 'unknown.example.com',
        label: 'Unknown',
        url: 'https://unknown.example.com',
        outputType: 'text',
        inputSelectors: [],
        sendSelectors: [],
        responseSelectors: [],
        calibrated: false,
        addedAt: Date.now(),
      },
    ]
    fs.writeFileSync(path.join(dir, 'sites.json'), JSON.stringify(legacyData), 'utf-8')

    const store2 = new SiteStore(dir)
    const record = store2.get('00000000-0000-0000-0000-000000000003')!
    expect(record.inputSelectors).toHaveLength(0)
  })

  // ── M12: tool toggles ───────────────────────────────────────────────────────

  it('add() — propagates preset toolToggles', () => {
    const config = store.add('https://preset.example.com')
    expect(config.toolToggles?.map((t) => t.id)).toEqual(['deepThink', 'webSearch'])
    expect(config.activeTools).toBeUndefined()
  })

  it('setToolActive() — adds/removes ids and dedupes; persists across reload', () => {
    const config = store.add('https://preset.example.com')
    expect(store.setToolActive(config.siteId, 'deepThink', true)).toEqual(['deepThink'])
    // idempotent enable
    expect(store.setToolActive(config.siteId, 'deepThink', true)).toEqual(['deepThink'])
    expect(store.setToolActive(config.siteId, 'webSearch', true).sort()).toEqual(['deepThink', 'webSearch'])
    // disabling removes it; empties become undefined for tidy JSON
    expect(store.setToolActive(config.siteId, 'deepThink', false)).toEqual(['webSearch'])

    const reloaded = new SiteStore(dir).get(config.siteId)!
    expect(reloaded.activeTools).toEqual(['webSearch'])
  })

  it('setToolActive() — ignores unknown tool ids', () => {
    const config = store.add('https://preset.example.com')
    expect(store.setToolActive(config.siteId, 'nope', true)).toEqual([])
    expect(store.get(config.siteId)?.activeTools).toBeUndefined()
  })

  it('load() — injects toolToggles into legacy records missing them', () => {
    const legacy = [
      {
        siteId: '00000000-0000-0000-0000-0000000000aa',
        hostname: 'preset.example.com',
        label: 'Legacy',
        url: 'https://preset.example.com',
        outputType: 'text',
        inputSelectors: [{ selector: '#input', method: 'css', priority: 5, failCount: 0 }],
        sendSelectors: [{ selector: '#send', method: 'css', priority: 5, failCount: 0 }],
        responseSelectors: [{ selector: '.reply', method: 'css', priority: 5, failCount: 0 }],
        calibrated: true,
        addedAt: Date.now(),
      },
    ]
    fs.writeFileSync(path.join(dir, 'sites.json'), JSON.stringify(legacy), 'utf-8')
    const record = new SiteStore(dir).get('00000000-0000-0000-0000-0000000000aa')!
    expect(record.toolToggles?.map((t) => t.id)).toEqual(['deepThink', 'webSearch'])
  })
})

// ─── Regression: sanitizeResponseSelectors ───────────────────────────────────

describe('sanitizeResponseSelectors() — regression: over-specific selectors must be cleaned', () => {
  it(
    'removes deep nth-of-type selector but keeps div.markdown.prose',
    () => {
      // Before the fix: a calibration selector like
      // "section:nth-of-type(2) > div > ... > p" would be stored at high
      // priority and match the author-header element ("ChatGPT 说：") before
      // div.markdown.prose could produce the actual reply body.
      // After the fix: sanitizeResponseSelectors() strips selectors with ≥ 3
      // :nth-of-type(/:nth-child( occurrences, so prose selectors win.
      const chain = [
        { selector: 'section:nth-of-type(2) > div:nth-of-type(1) > article > div:nth-child(2) > p', method: 'css' as const, priority: 10, failCount: 0 },
        { selector: 'div.markdown.prose', method: 'css' as const, priority: 5, failCount: 0 },
      ]
      const result = sanitizeResponseSelectors(chain)
      const selectors = result.map((e) => e.selector)
      expect(selectors).not.toContain('section:nth-of-type(2) > div:nth-of-type(1) > article > div:nth-child(2) > p')
      expect(selectors).toContain('div.markdown.prose')
    },
  )

  it(
    'deduplicates prose selector and does not remove a normal non-deep selector',
    () => {
      // Ensures that:
      // 1. Duplicate prose selectors are collapsed to one entry.
      // 2. A normal selector with no nth-* or deep chain is NOT removed.
      const chain = [
        { selector: 'div[class*="prose"]', method: 'css' as const, priority: 5, failCount: 0 },
        { selector: 'div[class*="prose"]', method: 'css' as const, priority: 5, failCount: 0 }, // duplicate
        { selector: 'article[data-testid*="conversation-turn"]', method: 'css' as const, priority: 3, failCount: 0 },
      ]
      const result = sanitizeResponseSelectors(chain)
      const selectors = result.map((e) => e.selector)
      // prose deduped to one
      expect(selectors.filter((s) => s === 'div[class*="prose"]')).toHaveLength(1)
      // normal selector preserved
      expect(selectors).toContain('article[data-testid*="conversation-turn"]')
    },
  )
})
