/**
 * provider-chain.integration.test.ts — 缺口3 的「真实网络」集成测试。
 *
 * 与 provider-chain.test.ts（FakeModel 单测）互补：本测试用真实 fetch + 两个
 * stub HTTP 服务，贯穿 OpenAiHttpLlmModel（SSE 流式·结构化档）与
 * LocalAdapterLlmModel（非流式·网页降级档），经 ProviderChainLlmModel 验证：
 *   • jsonMode 任务路由到结构化档（即使网页档排在前面）；
 *   • 结构化档 429 时降级到网页档（任务路由 + 降级闭环）。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { LocalAdapterLlmModel, ProviderChainLlmModel } from './provider-chain'
import { OpenAiHttpLlmModel } from './openai-llm'

const servers: Server[] = []

function listen(server: Server): Promise<string> {
  servers.push(server)
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve(`http://127.0.0.1:${port}`)
    })
  })
}

/** OpenAI 兼容 SSE stub：`status` 非 200 时回错误，否则流式吐出 content。 */
function openAiStub(status: number, content: string): Promise<string> {
  const server = createServer((req, res) => {
    if (!req.url?.endsWith('/chat/completions')) {
      res.writeHead(404).end()
      return
    }
    if (status !== 200) {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'rate limit' } }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`)
    res.write('data: [DONE]\n\n')
    res.end()
  })
  return listen(server)
}

/** 本地适配器 stub：非流式 JSON，回 content。 */
function localStub(content: string): Promise<string> {
  const server = createServer((req, res) => {
    if (!req.url?.endsWith('/v1/chat/completions')) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content } }] }))
  })
  return listen(server)
}

async function collect(it: AsyncIterable<string>): Promise<string> {
  let out = ''
  for await (const c of it) out += c
  return out
}

const ac = (): AbortSignal => new AbortController().signal

describe('provider chain — real-network task routing + degradation (缺口3)', () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))))
  })

  it('routes a jsonMode request to the structured API even when the web AI is listed first', async () => {
    const apiUrl = await openAiStub(200, 'JSON-OK')
    const localUrl = await localStub('WEB-OK')

    const web = new LocalAdapterLlmModel(localUrl, 'site::model=x', 'Web AI')
    const real = new OpenAiHttpLlmModel({
      apiKey: 'k',
      baseUrl: `${apiUrl}/v1`,
      model: 'gpt-test',
      maxOutputTokens: 256,
    })
    // web is first in the list; jsonMode should still prefer the structured API.
    const chain = new ProviderChainLlmModel([web, real])

    expect(await collect(chain.sendRequest([], { jsonMode: true }, ac()))).toBe('JSON-OK')
  })

  it('degrades to the web AI when the structured API returns 429', async () => {
    const apiUrl = await openAiStub(429, '')
    const localUrl = await localStub('WEB-OK')

    const web = new LocalAdapterLlmModel(localUrl, 'site::model=x', 'Web AI')
    const real = new OpenAiHttpLlmModel({
      apiKey: 'k',
      baseUrl: `${apiUrl}/v1`,
      model: 'gpt-test',
      maxOutputTokens: 256,
    })
    const chain = new ProviderChainLlmModel([web, real])

    // structured API tried first (jsonMode), hits 429 → degrade to the web AI.
    expect(await collect(chain.sendRequest([], { jsonMode: true }, ac()))).toBe('WEB-OK')
  })
})
