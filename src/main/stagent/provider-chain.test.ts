import { describe, it, expect, afterEach, vi } from 'vitest'
import type { LlmModel } from '@stagent/core'
import {
  LlmHttpError,
  LocalAdapterLlmModel,
  ProviderChainLlmModel,
  QuotaCooldownRegistry,
  isQuotaOrRateLimitError,
  orderDelegatesForTask,
} from './provider-chain'

/** 测试用：可配置「抛错 / 产出文本」的假模型，并记录被调用次数。 */
class FakeModel implements LlmModel {
  readonly id: string
  readonly family: string
  readonly name: string
  readonly structuredOutput: boolean
  calls = 0

  constructor(
    family: string,
    private readonly behavior: { throw?: unknown; chunks?: string[]; structuredOutput?: boolean },
  ) {
    this.family = family
    this.id = `fake:${family}`
    this.name = family
    this.structuredOutput = behavior.structuredOutput ?? true
  }

  async *sendRequest(): AsyncIterable<string> {
    this.calls += 1
    if (this.behavior.throw !== undefined) {
      throw this.behavior.throw
    }
    for (const c of this.behavior.chunks ?? []) {
      yield c
    }
  }
}

async function collect(it: AsyncIterable<string>): Promise<string> {
  let out = ''
  for await (const c of it) out += c
  return out
}

const ac = (): AbortSignal => new AbortController().signal

describe('isQuotaOrRateLimitError', () => {
  it('detects 429/503 via LlmHttpError status', () => {
    expect(isQuotaOrRateLimitError(new LlmHttpError('x', 429))).toBe(true)
    expect(isQuotaOrRateLimitError(new LlmHttpError('x', 503))).toBe(true)
    expect(isQuotaOrRateLimitError(new LlmHttpError('x', 400))).toBe(false)
  })

  it('detects quota/rate-limit keywords in message', () => {
    expect(isQuotaOrRateLimitError(new Error('quota exhausted'))).toBe(true)
    expect(isQuotaOrRateLimitError(new Error('Too Many Requests'))).toBe(true)
    expect(isQuotaOrRateLimitError(new Error('site runtime unhealthy'))).toBe(true)
    expect(isQuotaOrRateLimitError(new Error('bad json'))).toBe(false)
  })
})

describe('QuotaCooldownRegistry', () => {
  it('marks and expires cooldowns by TTL', () => {
    const reg = new QuotaCooldownRegistry(1000)
    reg.markCooldown('direct:x', 0)
    expect(reg.isCooled('direct:x', 500)).toBe(true)
    expect(reg.isCooled('direct:x', 1000)).toBe(false) // expired at/after TTL
    expect(reg.isCooled('local:y', 0)).toBe(false)
  })
})

describe('LocalAdapterLlmModel quota mapping (缺口1)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function drain(model: LlmModel): Promise<string> {
    let out = ''
    for await (const c of model.sendRequest([{ role: 'user', content: 'hi' }], undefined, ac())) {
      out += c
    }
    return out
  }

  it('throws LlmHttpError(429) when the adapter returns 429 (→ chain treats as quota)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 429,
        json: async () => ({ error: { message: 'quota exhausted: site-x', code: 'quota_exhausted' } }),
      })),
    )
    const model = new LocalAdapterLlmModel('http://127.0.0.1:8787', 'site-x', 'X')
    let caught: unknown
    try {
      await drain(model)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(LlmHttpError)
    expect((caught as LlmHttpError).status).toBe(429)
    // The chain uses this to decide cooldown + failover.
    expect(isQuotaOrRateLimitError(caught)).toBe(true)
  })

  it('yields content on a 200 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'hello' } }] }),
      })),
    )
    const model = new LocalAdapterLlmModel('http://127.0.0.1:8787', 'site-x', 'X')
    expect(await drain(model)).toBe('hello')
  })
})

describe('orderDelegatesForTask (缺口3 任务路由 + 降级)', () => {
  const real = new FakeModel('direct:a', { structuredOutput: true })
  const web1 = new FakeModel('local:w1', { structuredOutput: false })
  const web2 = new FakeModel('local:w2', { structuredOutput: false })

  it('keeps configured order for non-structured tasks', () => {
    const got = orderDelegatesForTask([real, web1, web2], undefined)
    expect(got.map((d) => d.family)).toEqual(['direct:a', 'local:w1', 'local:w2'])
  })

  it('demotes non-structured providers to the end for jsonMode tasks (stable)', () => {
    // even if a web AI is configured first, structured task prefers reliable.
    const got = orderDelegatesForTask([web1, real, web2], { jsonMode: true })
    expect(got.map((d) => d.family)).toEqual(['direct:a', 'local:w1', 'local:w2'])
  })

  it('always sinks cooled providers to the very end', () => {
    const reg = new QuotaCooldownRegistry(60_000)
    reg.markCooldown('direct:a')
    const got = orderDelegatesForTask([real, web1], { jsonMode: true }, reg)
    // direct:a is cooled → last, despite being structured-capable.
    expect(got.map((d) => d.family)).toEqual(['local:w1', 'direct:a'])
  })
})

describe('ProviderChainLlmModel task routing', () => {
  it('tries the structured provider first on a jsonMode request', async () => {
    const web = new FakeModel('local:w', { chunks: ['web'], structuredOutput: false })
    const real = new FakeModel('direct:a', { chunks: ['json'], structuredOutput: true })
    // web is listed first, but jsonMode should route to the reliable provider.
    const chain = new ProviderChainLlmModel([web, real])
    const out = await collect(chain.sendRequest([], { jsonMode: true }, ac()))
    expect(out).toBe('json')
    expect(real.calls).toBe(1)
    expect(web.calls).toBe(0)
  })

  it('falls back (degrades) to the web AI when the structured provider fails', async () => {
    const web = new FakeModel('local:w', { chunks: ['web'], structuredOutput: false })
    const real = new FakeModel('direct:a', { throw: new LlmHttpError('rate', 429), structuredOutput: true })
    const chain = new ProviderChainLlmModel([web, real])
    const out = await collect(chain.sendRequest([], { jsonMode: true }, ac()))
    expect(out).toBe('web') // degraded to the only remaining provider
    expect(real.calls).toBe(1)
    expect(web.calls).toBe(1)
  })
})

describe('ProviderChainLlmModel failover', () => {
  it('falls back to next provider when first fails before any chunk', async () => {
    const a = new FakeModel('direct:a', { throw: new Error('boom') })
    const b = new FakeModel('local:b', { chunks: ['hello'] })
    const chain = new ProviderChainLlmModel([a, b])
    expect(await collect(chain.sendRequest([], undefined, ac()))).toBe('hello')
    expect(a.calls).toBe(1)
    expect(b.calls).toBe(1)
  })

  it('cools down a provider that fails with 429 and skips it next time', async () => {
    const reg = new QuotaCooldownRegistry(60_000)
    const a = new FakeModel('direct:a', { throw: new LlmHttpError('rate', 429) })
    const b = new FakeModel('local:b', { chunks: ['ok'] })

    // 第一次：a 撞 429 → 拉黑 → 切到 b
    const chain1 = new ProviderChainLlmModel([a, b], reg)
    expect(await collect(chain1.sendRequest([], undefined, ac()))).toBe('ok')
    expect(a.calls).toBe(1)
    expect(reg.isCooled('direct:a')).toBe(true)

    // 第二次（新实例，共享 reg）：a 在冷却中 → 直接跳过，不再调用 a
    const chain2 = new ProviderChainLlmModel([a, b], reg)
    expect(await collect(chain2.sendRequest([], undefined, ac()))).toBe('ok')
    expect(a.calls).toBe(1) // 未再被调用
    expect(b.calls).toBe(2)
  })

  it('does not cool down on non-quota errors', async () => {
    const reg = new QuotaCooldownRegistry(60_000)
    const a = new FakeModel('direct:a', { throw: new Error('invalid json') })
    const b = new FakeModel('local:b', { chunks: ['x'] })
    const chain = new ProviderChainLlmModel([a, b], reg)
    await collect(chain.sendRequest([], undefined, ac()))
    expect(reg.isCooled('direct:a')).toBe(false)
  })

  it('tries cooled providers as last resort when all are cooled', async () => {
    const reg = new QuotaCooldownRegistry(60_000)
    reg.markCooldown('local:b')
    const b = new FakeModel('local:b', { chunks: ['fallback'] })
    const chain = new ProviderChainLlmModel([b], reg)
    expect(await collect(chain.sendRequest([], undefined, ac()))).toBe('fallback')
    expect(b.calls).toBe(1)
  })
})
