/**
 * e2e/quota-failover.spec.ts
 *
 * Locks the M14 缺口1 chain: a web-quota-exhausted account makes the local
 * adapter return HTTP 429 (instead of blocking on the 130s settle timeout or
 * returning a 200 with the limit banner as "text"). 429 is what the provider
 * chain needs to cool the account down and rotate to the next provider.
 *
 * Two cases:
 *   • already-exhausted account (quotaExhausted persisted) → fast 429 with no send
 *   • quota detected DURING a send (page shows the indicator) → 429 after settle
 *
 * IMPORTANT: seed the userData dir BEFORE launchApp().
 */
import { test, expect } from './fixtures/electron-app'
import { seedMockSite } from './helpers/seed-store'
import { startMockServer } from './helpers/mock-site'

const SITE_ID = 'aaaaaaaa-0000-0000-0000-0000000000d1'

interface AdapterInfo {
  enabled: boolean
  url: string
}

async function postRaw(
  baseUrl: string,
  model: string,
  text: string,
): Promise<{ status: number; body: { error?: { code?: string; siteId?: string } } }> {
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: text }] }),
  })
  return { status: res.status, body: (await res.json()) as { error?: { code?: string } } }
}

test('quota: an already-exhausted account fast-fails with 429 (no send)', async ({
  launchApp,
  userDataDir,
}) => {
  process.env['AUTOAI_ADAPTER_PORT'] = '8799'

  const server = await startMockServer()
  try {
    seedMockSite(userDataDir, server.url, {
      siteId: SITE_ID,
      label: 'QuotaBot',
      quotaExhausted: true, // persisted exhausted flag
    })
    const { page } = await launchApp()
    await page.waitForTimeout(2500)

    const info = (await page.evaluate(
      // @ts-expect-error window.autoAI is injected by the preload script
      () => window.autoAI.adapter.getInfo(),
    )) as AdapterInfo
    expect(info.enabled).toBe(true)

    const { status, body } = await postRaw(info.url, SITE_ID, 'hi from e2e')
    expect(status, `body: ${JSON.stringify(body)}`).toBe(429)
    expect(body.error?.code).toBe('quota_exhausted')
    expect(body.error?.siteId).toBe(SITE_ID)
  } finally {
    await server.close()
  }
})

test('quota: exhaustion detected during a send returns 429', async ({
  launchApp,
  userDataDir,
}) => {
  process.env['AUTOAI_ADAPTER_PORT'] = '8799'

  const server = await startMockServer()
  try {
    seedMockSite(userDataDir, server.url, {
      siteId: SITE_ID,
      label: 'QuotaBot',
      // The mock site renders this exact text when the prompt contains __QUOTA__.
      quotaExhaustedIndicator: 'text=QUOTA_LIMIT_HIT',
    })
    const { page } = await launchApp()
    await page.waitForTimeout(2500)

    const info = (await page.evaluate(
      // @ts-expect-error window.autoAI is injected by the preload script
      () => window.autoAI.adapter.getInfo(),
    )) as AdapterInfo
    expect(info.enabled).toBe(true)

    // The prompt triggers the mock's quota banner → response-watcher flags
    // quotaExhausted → reply pipeline notifies the adapter → 429.
    const { status, body } = await postRaw(info.url, SITE_ID, 'please __QUOTA__ now')
    expect(status, `body: ${JSON.stringify(body)}`).toBe(429)
    expect(body.error?.code).toBe('quota_exhausted')
  } finally {
    await server.close()
  }
})
