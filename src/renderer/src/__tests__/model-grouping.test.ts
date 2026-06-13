/**
 * Unit tests for groupModels — folds the flat M13 resource-pool list
 * (site × model variant × tool) into per-site <optgroup> groups.
 */
import { describe, it, expect } from 'vitest'
import { groupModels } from '../stagent/model-grouping'

describe('groupModels', () => {
  it('returns an empty array for no models', () => {
    expect(groupModels([])).toEqual([])
  })

  it('collects non-local families (chain/direct) into a single generic group on top', () => {
    const groups = groupModels([
      { id: 'chain:auto', name: '🔀 自动（真实 API 优先 · 本地降级）' },
      { id: 'direct:gpt-4o', name: 'gpt-4o' },
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].key).toBe('__generic__')
    expect(groups[0].options.map((o) => o.id)).toEqual(['chain:auto', 'direct:gpt-4o'])
    // generic options keep their full descriptive name
    expect(groups[0].options[0].text).toBe('🔀 自动（真实 API 优先 · 本地降级）')
  })

  it('folds a site base + variants + tools under one group, base shown as 默认', () => {
    const groups = groupModels([
      { id: 'local:gemini-site', name: '🌐 Gemini（本地浏览器）' },
      { id: 'local:gemini-site::model=gemini-3-1-pro', name: '🌐 Gemini · 3.1 Pro（本地浏览器）' },
      { id: 'local:gemini-site::tool=deepThink', name: '🌐 Gemini · 深度思考（本地浏览器）' },
    ])
    expect(groups).toHaveLength(1)
    const g = groups[0]
    expect(g.label).toBe('🌐 Gemini')
    expect(g.options).toEqual([
      { id: 'local:gemini-site', text: '默认' },
      { id: 'local:gemini-site::model=gemini-3-1-pro', text: '3.1 Pro' },
      { id: 'local:gemini-site::tool=deepThink', text: '深度思考' },
    ])
  })

  it('groups by the site label even when the base id uses activeModel', () => {
    // base entry id encodes activeModel while variant ids encode siteId — both
    // still share the same display-name prefix, so grouping stays stable.
    const groups = groupModels([
      { id: 'local:gemini-3-5-flash', name: '🌐 Gemini（本地浏览器）' },
      { id: 'local:gemini-site::model=gemini-3-1-pro', name: '🌐 Gemini · 3.1 Pro（本地浏览器）' },
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].options.map((o) => o.id)).toEqual([
      'local:gemini-3-5-flash',
      'local:gemini-site::model=gemini-3-1-pro',
    ])
  })

  it('separates a cross-account pool group (🔁 任一账号) from specific accounts', () => {
    const groups = groupModels([
      { id: 'local:claude-acct-1', name: '🌐 Claude 工作（本地浏览器）' },
      { id: 'local:claude-acct-2', name: '🌐 Claude 个人（本地浏览器）' },
      { id: 'local:pool:claude.ai', name: '🌐 Claude·任一账号（本地浏览器）' },
      { id: 'local:pool:claude.ai::model=sonnet', name: '🌐 Claude·任一账号 · Sonnet 4.6（本地浏览器）' },
    ])
    // three distinct groups: two specific accounts + one rotation group
    expect(groups.map((g) => g.key)).toEqual([
      'site:Claude 工作',
      'site:Claude 个人',
      'pool:Claude·任一账号',
    ])
    const pool = groups.find((g) => g.key === 'pool:Claude·任一账号')!
    expect(pool.label).toBe('🔁 Claude·任一账号') // marked as auto-rotate
    expect(pool.options).toEqual([
      { id: 'local:pool:claude.ai', text: '默认' },
      { id: 'local:pool:claude.ai::model=sonnet', text: 'Sonnet 4.6' },
    ])
  })

  it('keeps multiple sites separate and puts the generic group first', () => {
    const groups = groupModels([
      { id: 'local:deepseek-site', name: '🌐 DeepSeek（本地浏览器）' },
      { id: 'chain:auto', name: '🔀 自动' },
      { id: 'local:deepseek-site::tool=webSearch', name: '🌐 DeepSeek · 智能搜索（本地浏览器）' },
      { id: 'local:claude-site', name: '🌐 Claude（本地浏览器）' },
    ])
    expect(groups.map((g) => g.key)).toEqual(['__generic__', 'site:DeepSeek', 'site:Claude'])
    const ds = groups.find((g) => g.key === 'site:DeepSeek')!
    expect(ds.options).toHaveLength(2)
  })
})
