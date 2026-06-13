import { describe, it, expect } from 'vitest'
import {
  parseModelSpec,
  formatModelSpec,
  pickSiteForModel,
  expandSiteModels,
  expandPool,
  formatPoolGroupSpec,
  isPoolGroupSpec,
  parsePoolGroupSpec,
  resolvePoolGroup,
  poolGroupToConcrete,
} from './model-pool'
import type { SiteConfig } from '../site-store'

function site(partial: Partial<SiteConfig>): SiteConfig {
  return {
    siteId: 'site-x',
    hostname: 'example.com',
    label: 'X',
    url: 'https://example.com',
    outputType: 'text',
    inputSelectors: [],
    sendSelectors: [],
    responseSelectors: [],
    calibrated: false,
    addedAt: 1000,
    ...partial,
  }
}

describe('parseModelSpec', () => {
  it('plain base, no suffixes', () => {
    expect(parseModelSpec('site-1')).toEqual({ base: 'site-1', modelId: undefined, tools: [] })
  })

  it('model variant', () => {
    expect(parseModelSpec('site-1::model=pro')).toEqual({ base: 'site-1', modelId: 'pro', tools: [] })
  })

  it('single + multiple tools (deduped, order-preserving)', () => {
    expect(parseModelSpec('site-1::tool=deepThink')).toEqual({ base: 'site-1', modelId: undefined, tools: ['deepThink'] })
    expect(parseModelSpec('site-1::tool=a+b+a')).toEqual({ base: 'site-1', modelId: undefined, tools: ['a', 'b'] })
  })

  it('effort tier', () => {
    expect(parseModelSpec('site-1::effort=high')).toEqual({
      base: 'site-1',
      modelId: undefined,
      effort: 'high',
      tools: [],
    })
  })

  it('model + effort + tools combined', () => {
    expect(parseModelSpec('site-1::model=pro::effort=max::tool=deepThink+webSearch')).toEqual({
      base: 'site-1',
      modelId: 'pro',
      effort: 'max',
      tools: ['deepThink', 'webSearch'],
    })
  })

  it('empty values are ignored', () => {
    expect(parseModelSpec('site-1::model=::effort=::tool=')).toEqual({
      base: 'site-1',
      modelId: undefined,
      effort: undefined,
      tools: [],
    })
  })
})

describe('formatModelSpec', () => {
  it('round-trips through parseModelSpec', () => {
    const spec = formatModelSpec('site-1', 'pro', ['a', 'b'])
    expect(spec).toBe('site-1::model=pro::tool=a+b')
    expect(parseModelSpec(spec)).toEqual({ base: 'site-1', modelId: 'pro', effort: undefined, tools: ['a', 'b'] })
  })

  it('round-trips with effort (order: model · effort · tool)', () => {
    const spec = formatModelSpec('site-1', 'pro', ['a'], 'high')
    expect(spec).toBe('site-1::model=pro::effort=high::tool=a')
    expect(parseModelSpec(spec)).toEqual({ base: 'site-1', modelId: 'pro', effort: 'high', tools: ['a'] })
  })

  it('effort-only spec', () => {
    expect(formatModelSpec('site-1', undefined, [], 'max')).toBe('site-1::effort=max')
  })
})

describe('pickSiteForModel', () => {
  const sites = [
    site({ siteId: 'aaa', hostname: 'gemini.google.com', label: 'Gemini', activeModel: 'g-pro', availableModels: [{ id: 'g-flash', label: 'Flash' }] }),
    site({ siteId: 'bbb', hostname: 'chat.deepseek.com', label: 'DeepSeek' }),
  ]

  it('matches by siteId (with suffixes stripped)', () => {
    expect(pickSiteForModel(sites, 'aaa::model=g-flash::tool=x')?.siteId).toBe('aaa')
  })
  it('matches by activeModel', () => {
    expect(pickSiteForModel(sites, 'g-pro')?.siteId).toBe('aaa')
  })
  it('matches by availableModels id', () => {
    expect(pickSiteForModel(sites, 'g-flash')?.siteId).toBe('aaa')
  })
  it('matches by hostname substring', () => {
    expect(pickSiteForModel(sites, 'deepseek')?.siteId).toBe('bbb')
  })
  it('returns undefined when nothing matches', () => {
    expect(pickSiteForModel(sites, 'nope')).toBeUndefined()
  })
})

describe('expandSiteModels', () => {
  it('emits base + model variants + tool entries', () => {
    const s = site({
      siteId: 'aaa',
      hostname: 'gemini.google.com',
      label: 'Gemini',
      modelSwitcherSelector: 'button',
      availableModels: [
        { id: 'g-flash', label: '3.5 Flash' },
        { id: 'g-pro', label: '3.1 Pro' },
      ],
      toolToggles: [{ id: 'deepThink', label: '深度思考', selector: 'text=深度思考' }],
    })
    const ids = expandSiteModels(s).map((e) => e.id)
    expect(ids).toEqual([
      'aaa', // base (no activeModel → siteId)
      'aaa::model=g-flash',
      'aaa::model=g-pro',
      'aaa::tool=deepThink',
    ])
    const labels = expandSiteModels(s).map((e) => e.label)
    expect(labels).toContain('Gemini · 3.1 Pro')
    expect(labels).toContain('Gemini · 深度思考')
  })

  it('omits model variants when there is no model switcher', () => {
    const s = site({
      siteId: 'bbb',
      label: 'DeepSeek',
      availableModels: [{ id: 'x', label: 'X' }], // present but no switcher
      toolToggles: [{ id: 'webSearch', label: '智能搜索', selector: 'text=智能搜索' }],
    })
    const ids = expandSiteModels(s).map((e) => e.id)
    expect(ids).toEqual(['bbb', 'bbb::tool=webSearch'])
  })

  it('base id uses activeModel when set', () => {
    const s = site({ siteId: 'aaa', activeModel: 'g-pro' })
    expect(expandSiteModels(s)[0]?.id).toBe('g-pro')
  })

  it('emits effort tiers (between model variants and tools)', () => {
    const s = site({
      siteId: 'cl',
      label: 'Claude',
      modelSwitcherSelector: 'button',
      availableModels: [{ id: 'sonnet', label: 'Sonnet 4.6' }],
      effortLevels: [
        { id: 'high', label: 'High' },
        { id: 'max', label: 'Max' },
      ],
      toolToggles: [{ id: 'webSearch', label: 'Web search', selector: 'text=Web search' }],
    })
    const entries = expandSiteModels(s)
    expect(entries.map((e) => e.id)).toEqual([
      'cl',
      'cl::model=sonnet',
      'cl::effort=high',
      'cl::effort=max',
      'cl::tool=webSearch',
    ])
    expect(entries.find((e) => e.id === 'cl::effort=high')?.label).toBe('Claude · 思考强度 High')
  })
})

describe('expandPool', () => {
  it('flattens all sites (no pool groups for single-account hostnames)', () => {
    const sites = [
      site({ siteId: 'aaa', hostname: 'a.com', toolToggles: [{ id: 't', label: 'T', selector: 'text=T' }] }),
      site({ siteId: 'bbb', hostname: 'b.com' }),
    ]
    expect(expandPool(sites).map((e) => e.id)).toEqual(['aaa', 'aaa::tool=t', 'bbb'])
  })

  it('emits cross-account pool groups when a hostname has ≥2 accounts', () => {
    const sites = [
      site({
        siteId: 's1',
        hostname: 'claude.ai',
        label: 'Claude 工作',
        modelSwitcherSelector: 'button',
        availableModels: [{ id: 'sonnet', label: 'Sonnet 4.6' }],
        effortLevels: [{ id: 'max', label: 'Max' }],
        addedAt: 100,
      }),
      site({
        siteId: 's2',
        hostname: 'claude.ai',
        label: 'Claude 个人',
        modelSwitcherSelector: 'button',
        availableModels: [{ id: 'sonnet', label: 'Sonnet 4.6' }],
        effortLevels: [{ id: 'max', label: 'Max' }],
        addedAt: 200,
      }),
    ]
    const ids = expandPool(sites).map((e) => e.id)
    // concrete entries for both accounts, then the pool group entries.
    expect(ids).toContain('pool:claude.ai')
    expect(ids).toContain('pool:claude.ai::model=sonnet')
    expect(ids).toContain('pool:claude.ai::effort=max')
    const poolBase = expandPool(sites).find((e) => e.id === 'pool:claude.ai')
    expect(poolBase?.label).toBe('Claude·任一账号')
    expect(poolBase?.siteId).toBe('') // pool groups are account-agnostic
  })
})

describe('pool group helpers', () => {
  it('formats / detects / parses a pool group id', () => {
    const spec = formatPoolGroupSpec('claude.ai', 'sonnet', ['webSearch'], 'max')
    expect(spec).toBe('pool:claude.ai::model=sonnet::effort=max::tool=webSearch')
    expect(isPoolGroupSpec(spec)).toBe(true)
    expect(isPoolGroupSpec('s1::model=sonnet')).toBe(false)
    expect(parsePoolGroupSpec(spec)).toEqual({
      hostname: 'claude.ai',
      modelId: 'sonnet',
      effort: 'max',
      tools: ['webSearch'],
    })
  })

  it('poolGroupToConcrete rebinds a pool spec onto a concrete account', () => {
    const s = site({ siteId: 's2' })
    expect(poolGroupToConcrete(s, 'pool:claude.ai::model=sonnet::effort=max')).toBe(
      's2::model=sonnet::effort=max',
    )
  })

  describe('resolvePoolGroup', () => {
    const sites = [
      site({ siteId: 's1', hostname: 'claude.ai', modelSwitcherSelector: 'b', availableModels: [{ id: 'sonnet', label: 'S' }], quotaExhausted: true, addedAt: 100 }),
      site({ siteId: 's2', hostname: 'claude.ai', modelSwitcherSelector: 'b', availableModels: [{ id: 'sonnet', label: 'S' }], addedAt: 200 }),
      site({ siteId: 's3', hostname: 'gemini.google.com', addedAt: 300 }),
    ]

    it('matches by hostname and orders non-exhausted first', () => {
      const got = resolvePoolGroup(sites, 'pool:claude.ai')
      expect(got.map((s) => s.siteId)).toEqual(['s2', 's1']) // s2 fresh, s1 exhausted last
    })

    it('filters by required model support', () => {
      const got = resolvePoolGroup(sites, 'pool:claude.ai::model=sonnet')
      expect(got.map((s) => s.siteId).sort()).toEqual(['s1', 's2'])
    })

    it('returns empty when no account supports the variant', () => {
      expect(resolvePoolGroup(sites, 'pool:claude.ai::model=opus')).toEqual([])
    })
  })
})
