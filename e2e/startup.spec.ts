/**
 * e2e/startup.spec.ts
 *
 * Tests app routing on startup (SPEC §7.1 启动决策树).
 *
 * Bug coverage:
 *  - App must route to ResourcesPage when site-store is empty.
 *  - App must route to ChatPage when site-store has records.
 */
import { test, expect } from './fixtures/electron-app'
import { seedEmpty, seedMockSite } from './helpers/seed-store'
import { startMockServer } from './helpers/mock-site'

// ── A: No sites in store → onboarding (ResourcesPage) ─────────────────────

test('fresh install: shows onboarding screen', async ({ launchApp, userDataDir }) => {
  seedEmpty(userDataDir)
  const { page } = await launchApp()
  await expect(page.getByText('选择你的 AI 助手')).toBeVisible()
})

test('fresh install: shows all preset AI cards', async ({ launchApp, userDataDir }) => {
  seedEmpty(userDataDir)
  const { page } = await launchApp()
  for (const label of ['ChatGPT', 'Claude', 'Gemini', 'DeepSeek', 'Kimi']) {
    await expect(page.getByText(label)).toBeVisible()
  }
  await expect(page.getByText('其他')).toBeVisible()
})

test('fresh install: "跳过" navigates to ChatPage empty state', async ({ launchApp, userDataDir }) => {
  seedEmpty(userDataDir)
  const { page } = await launchApp()
  await page.getByText('跳过').click()
  await expect(page.getByText('还没有可用的 AI')).toBeVisible()
})

// ── B: Store has records → ChatPage ───────────────────────────────────────

test('returning user: goes directly to ChatPage', async ({ launchApp, userDataDir }) => {
  const server = await startMockServer()
  try {
    seedMockSite(userDataDir, server.url)   // seed BEFORE launch
    const { page } = await launchApp()
    // App sees the seeded site → routes to ChatPage, not onboarding
    await expect(page.getByText('选择你的 AI 助手')).not.toBeVisible({ timeout: 8000 })
  } finally {
    await server.close()
  }
})
