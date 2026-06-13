/**
 * e2e/pool-rotation.spec.ts
 *
 * Locks the M14 缺口2 "任一账号·自动轮转" chain: a `pool:<hostname>` model id
 * resolves to the hostname's accounts and rotates across them, skipping the
 * exhausted ones and falling through any that hit quota mid-send.
 *
 * Cases:
 *   • already-exhausted account is skipped; a fresh account answers
 *   • an account that hits quota DURING the send is rotated past in one request
 *   • /v1/models exposes a pool group when a hostname has ≥2 accounts
 *
 * IMPORTANT: seed the userData dir BEFORE launchApp().
 */
import { test, expect } from './fixtures/electron-app'
import { seedMockSites } from './helpers/seed-store'
import { startMockServer } from './helpers/mock-site'

const SITE_A = 'aaaaaaaa-0000-0000-0000-0000000000a1'
const SITE_B = 'aaaaaaaa-0000-0000-0000-0000000000b2'
const POOL = 'pool:127.0.0.1'

interface AdapterInfo {
  enabled: boolean
  url: string
}

async function chat(
  baseUrl: string,
  model: string,
  text: string,
): Promise<{
  status: number
  body: {
    choices?: Array<{ message?: { content?: string } }>
    adapter?: { siteId?: string }
    error?: { code?: string }
  }
}> {
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: text }] }),
  })
  return { status: res.status, body: (await res.json()) as never }
}

test('pool: skips an already-exhausted account and answers from a fresh one', async ({
  launchApp,
  userDataDir,
}) => {
  process.env['AUTOAI_ADAPTER_PORT'] = '8801'
  const server = await startMockServer()
  try {
    seedMockSites(userDataDir, [
      { url: server.url, opts: { siteId: SITE_A, label: 'Pool 工作', quotaExhausted: true } },
      { url: server.url, opts: { siteId: SITE_B, label: 'Pool 个人' } },
    ])
    const { page } = await launchApp()
    await page.waitForTimeout(2500)

    const info = (await page.evaluate(
      // @ts-expect-error injected by preload
      () => window.autoAI.adapter.getInfo(),
    )) as AdapterInfo
    expect(info.enabled).toBe(true)

    const { status, body } = await chat(info.url, POOL, 'hello pool')
    expect(status, JSON.stringify(body)).toBe(200)
    expect(body.adapter?.siteId).toBe(SITE_B) // fresh account answered
    expect(body.choices?.[0]?.message?.content ?? '').toContain('hello pool')
  } finally {
    await server.close()
  }
})

test('pool: rotates past an account that hits quota mid-send (one request)', async ({
  launchApp,
  userDataDir,
}) => {
  process.env['AUTOAI_ADAPTER_PORT'] = '8801'
  // A always reports quota; B answers normally. Both are 127.0.0.1.
  const serverA = await startMockServer({ alwaysQuota: true })
  const serverB = await startMockServer()
  try {
    seedMockSites(userDataDir, [
      { url: serverA.url, opts: { siteId: SITE_A, label: 'Pool A', quotaExhaustedIndicator: 'text=QUOTA_LIMIT_HIT' } },
      { url: serverB.url, opts: { siteId: SITE_B, label: 'Pool B' } },
    ])
    const { page } = await launchApp()
    await page.waitForTimeout(2500)

    const info = (await page.evaluate(
      // @ts-expect-error injected by preload
      () => window.autoAI.adapter.getInfo(),
    )) as AdapterInfo
    expect(info.enabled).toBe(true)

    const { status, body } = await chat(info.url, POOL, 'rotate please')
    expect(status, JSON.stringify(body)).toBe(200)
    expect(body.adapter?.siteId).toBe(SITE_B) // rotated to the healthy account
    expect(body.choices?.[0]?.message?.content ?? '').toContain('rotate please')
  } finally {
    await serverA.close()
    await serverB.close()
  }
})

test('pool: /v1/models exposes a pool group for a multi-account hostname', async ({
  launchApp,
  userDataDir,
}) => {
  process.env['AUTOAI_ADAPTER_PORT'] = '8801'
  const server = await startMockServer()
  try {
    seedMockSites(userDataDir, [
      { url: server.url, opts: { siteId: SITE_A, label: 'Pool 工作' } },
      { url: server.url, opts: { siteId: SITE_B, label: 'Pool 个人' } },
    ])
    const { page } = await launchApp()
    await page.waitForTimeout(2500)

    const info = (await page.evaluate(
      // @ts-expect-error injected by preload
      () => window.autoAI.adapter.getInfo(),
    )) as AdapterInfo

    const res = await fetch(`${info.url}/v1/models`)
    const data = (await res.json()) as { data: Array<{ id: string }> }
    const ids = data.data.map((m) => m.id)
    expect(ids).toContain(SITE_A)
    expect(ids).toContain(SITE_B)
    expect(ids).toContain('pool:127.0.0.1') // cross-account group present
  } finally {
    await server.close()
  }
})
