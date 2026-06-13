/**
 * e2e/resources-page.spec.ts
 *
 * Tests for the ResourcesPage — both onboarding (mode A) and management (mode B).
 *
 * Bug coverage:
 *  - Site status labels render correctly (text-based, SPEC §7.3)
 *  - Management mode shows all stored sites
 *  - "开始对话" navigates back to ChatPage
 */
import { test, expect } from './fixtures/electron-app'
import { seedEmpty, seedMockSite } from './helpers/seed-store'
import { startMockServer } from './helpers/mock-site'

// ── Mode A: Onboarding ─────────────────────────────────────────────────────

test('onboarding: shows subtitle text', async ({ launchApp, userDataDir }) => {
  seedEmpty(userDataDir)
  const { page } = await launchApp()
  await expect(page.getByText('登录后即可在 autoAI 中统一调用')).toBeVisible()
})

test('onboarding: "其他" opens custom URL dialog', async ({ launchApp, userDataDir }) => {
  seedEmpty(userDataDir)
  const { page } = await launchApp()
  await page.getByText('其他').click()
  await expect(page.getByText('添加自定义网站')).toBeVisible()
  await expect(page.getByPlaceholder('https://example.com')).toBeVisible()
})

test('onboarding: custom URL dialog cancel closes it', async ({ launchApp, userDataDir }) => {
  seedEmpty(userDataDir)
  const { page } = await launchApp()
  await page.getByText('其他').click()
  await page.getByText('取消').click()
  await expect(page.getByText('添加自定义网站')).not.toBeVisible()
})

// ── Mode B: Management ─────────────────────────────────────────────────────

// The ⚙ button is in App.tsx title bar — title="AI 资源设置"
const SETTINGS_BTN = 'button[title="AI 资源设置"]'

test('management: shows stored site label and hostname', async ({ launchApp, userDataDir }) => {
  const server = await startMockServer()
  try {
    seedMockSite(userDataDir, server.url, { label: 'My Mock AI', hostname: '127.0.0.1' })
    const { page } = await launchApp()
    // App starts on ChatPage (sites exist). Click ⚙ to open ResourcesPage.
    await page.locator(SETTINGS_BTN).click()
    await expect(page.getByText('My Mock AI')).toBeVisible()
    await expect(page.getByText('127.0.0.1', { exact: true })).toBeVisible()
  } finally {
    await server.close()
  }
})

test('management: site shows "未登录" or "已连接" status', async ({ launchApp, userDataDir }) => {
  const server = await startMockServer()
  try {
    seedMockSite(userDataDir, server.url, { label: 'My Mock AI' })
    const { page } = await launchApp()
    // Click ⚙ quickly — before or after the 800 ms probe, either status is valid
    await page.locator(SETTINGS_BTN).click()
    await expect(
      page.getByText('未登录').or(page.getByText('已连接')),
    ).toBeVisible({ timeout: 5000 })
  } finally {
    await server.close()
  }
})

test('management: "开始对话" button navigates to ChatPage', async ({ launchApp, userDataDir }) => {
  const server = await startMockServer()
  try {
    seedMockSite(userDataDir, server.url)
    const { page } = await launchApp()
    await page.locator(SETTINGS_BTN).click()
    await page.getByText('开始对话').click()
    // ChatPage should be visible — the ResourcesPage management header is gone
    await expect(page.getByText('AI 资源管理')).not.toBeVisible({ timeout: 5000 })
  } finally {
    await server.close()
  }
})
